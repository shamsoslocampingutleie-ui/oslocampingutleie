import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://leieplattform.no",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function err(status: number, msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nights(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

// Only ever redirect back to our own site — a client-supplied
// success_url/cancel_url must not be trusted as-is, or an attacker
// could redirect a paying customer to an external phishing page right
// after a real Stripe checkout completes.
function safeRedirect(url: unknown): string {
  const fallback = "https://leieplattform.no/";
  if (typeof url !== "string") return fallback;
  try {
    const u = new URL(url);
    if (u.origin === "https://leieplattform.no") return url;
  } catch { /* fall through */ }
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err(405, "Method not allowed");
  // No auth on this endpoint at all -- it's the guest (not-logged-in)
  // booking path by design -- so IP-based limiting is the only thing
  // stopping it from being spammed to flood a host's inbox with fake
  // booking-request emails or hammer Stripe checkout-session creation.
  if (!await checkRateLimit(req, 8, 300_000)) return rateLimitResponse(corsHeaders);

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2024-06-20",
  });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "Ugyldig JSON");
  }

  const {
    listing_id, from_date, to_date,
    renter_name, renter_email, renter_phone, renter_address,
    wants_transport, needs_license,
    success_url, cancel_url,
  } = body as Record<string, string | boolean | null>;

  if (!listing_id || !from_date || !to_date || !renter_name || !renter_email || !renter_phone) {
    return err(400, "Fullt navn, e-post, telefon og datoer er påkrevd.");
  }
  if (typeof renter_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(renter_email)) {
    return err(400, "Ugyldig e-postadresse.");
  }
  if (typeof renter_phone !== "string" || renter_phone.replace(/\D/g, "").length < 8) {
    return err(400, "Ugyldig telefonnummer.");
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") || "unknown";
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count: recentCount } = await sb
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("renter_ip", ip)
    .gte("created_at", since);
  if ((recentCount ?? 0) >= 5) return err(429, "For mange forsøk. Prøv igjen om en time.");

  const { data: listing, error: listingErr } = await sb
    .from("listings")
    .select("id,title,price_per_day,cleaning_fee,deposit,deposit_mode,instant_book,status,owner,category")
    .eq("id", listing_id)
    .single();
  if (listingErr || !listing) return err(404, "Annonsen ble ikke funnet.");
  if (listing.status !== "active") return err(400, "Annonsen er ikke lenger tilgjengelig.");

  const { data: conflicts } = await sb
    .from("bookings")
    .select("id")
    .eq("listing_id", listing_id)
    .in("status", ["accepted", "pending"])
    .lt("from_date", to_date)
    .gt("to_date", from_date);
  if (conflicts && conflicts.length > 0) {
    return err(409, "Disse datoene er allerede reservert. Velg andre datoer.");
  }

  let renterId: string | null = null;
  try {
    const { data: profile } = await sb
      .from("profiles")
      .select("id")
      .eq("email", renter_email)
      .maybeSingle();
    if (profile) renterId = profile.id;
  } catch { /* guest booking proceeds without renter link */ }

  const { data: booking, error: bookingErr } = await sb
    .from("bookings")
    .insert({
      listing_id,
      renter: renterId,
      renter_name,
      renter_email,
      renter_phone,
      renter_address: renter_address || "",
      renter_ip: ip,
      from_date,
      to_date,
      status: listing.instant_book ? "pending_payment" : "pending",
      wants_transport: !!wants_transport,
    })
    .select("id")
    .single();

  if (bookingErr || !booking) {
    console.error("Booking insert error:", bookingErr);
    return err(500, "Kunne ikke opprette bestillingen. Prøv igjen.");
  }

  const bookingId = booking.id as string;

  // Non-instant bookings need the host's approval — without this email
  // the host has no way to know a request exists at all until they
  // happen to open the dashboard. Instant-book bookings are covered
  // separately once payment completes (stripe-webhook).
  if (!listing.instant_book) {
    try {
      const hostAuth = await sb.auth.admin.getUserById(listing.owner);
      const hostEmail = hostAuth.data?.user?.email;
      if (hostEmail) {
        await sendEmail(
          hostEmail,
          `Ny leieforespørsel — ${listing.title}`,
          emailLayout(
            "Du har fått en leieforespørsel 🎉",
            `<p><strong>${escapeHtml(renter_name as string)}</strong> ønsker å leie <strong>${escapeHtml(listing.title)}</strong>.</p>
            <div class="info-box">
              <p><strong>Periode:</strong> ${escapeHtml(from_date as string)} → ${escapeHtml(to_date as string)}</p>
              <p><strong>Leietaker:</strong> ${escapeHtml(renter_name as string)}</p>
            </div>
            <p>Logg inn og gå til <strong>Utleier-dashbord</strong> for å godkjenne eller avvise forespørselen.</p>
            <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Se forespørsel →</a>`,
          ),
        );
      }
    } catch (notifyErr) {
      console.error("[guest-checkout] host notification failed:", notifyErr);
    }
  }

  let idUploadUrl: string | null = null;
  let idUploadPath: string | null = null;
  if (needs_license) {
    const path = `${bookingId}/renter_id/${Date.now()}.jpg`;
    const { data: signed } = await sb.storage
      .from("booking-photos")
      .createSignedUploadUrl(path, { upsert: true });
    if (signed?.signedUrl) {
      idUploadUrl = signed.signedUrl;
      idUploadPath = path;
    }
  }

  let stripeUrl: string | null = null;
  if (listing.instant_book) {
    try {
      // fee_waiver_until: while in the future for this host (first year
      // after approval -- see protect_profile_fields()), the host-side 10%
      // is waived. The renter-side 10% service fee is unaffected.
      const { data: hostProfile } = await sb
        .from("profiles")
        .select("fee_waiver_until")
        .eq("id", listing.owner)
        .maybeSingle();
      const hostFeeWaived = !!hostProfile?.fee_waiver_until &&
        new Date(hostProfile.fee_waiver_until) > new Date();

      const n = nights(from_date as string, to_date as string);
      const rent = Number(listing.price_per_day) * n;
      const serviceFee = Math.round(rent * 0.10);
      const cleaningFee = Number(listing.cleaning_fee || 0);
      const deposit = listing.deposit_mode !== "incident" ? Number(listing.deposit || 0) : 0;
      const amountTotal = rent + serviceFee + cleaningFee + deposit;
      // Platform fee = 10% from renter + 10% from host (unless waived) = up to 20% of rent.
      const platformFee = serviceFee + (hostFeeWaived ? 0 : Math.round(rent * 0.10));
      const amountTotalOre = Math.round(amountTotal * 100);
      const platformFeeOre = Math.round(platformFee * 100);

      // The platform always receives the full payment up front, exactly
      // like the logged-in stripe-checkout flow -- no application_fee /
      // transfer_data here. The host's share is only transferred out later
      // by stripe-release-payout, once BOTH parties confirm handover. A
      // Stripe Connect "destination charge" here would pay the host
      // instantly at booking time, defeating that escrow guarantee for
      // every guest booking.
      const stripeSession = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        billing_address_collection: "required",
        customer_email: renter_email as string,
        line_items: [{
          price_data: {
            currency: "nok",
            product_data: { name: listing.title },
            unit_amount: amountTotalOre,
          },
          quantity: 1,
        }],
        payment_intent_data: { metadata: { booking_id: bookingId } },
        metadata: {
          booking_id: bookingId,
          platform_fee_ore: String(platformFeeOre),
        },
        success_url: safeRedirect(success_url),
        cancel_url: safeRedirect(cancel_url),
      });
      stripeUrl = stripeSession.url;
    } catch (stripeErr) {
      console.error("Stripe error:", stripeErr);
    }
  }

  return new Response(JSON.stringify({
    booking_id: bookingId,
    status: listing.instant_book ? "accepted" : "pending",
    stripe_url: stripeUrl,
    id_upload_url: idUploadUrl,
    id_upload_path: idUploadPath,
    instant_book: listing.instant_book,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
