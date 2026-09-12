import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err(405, "Method not allowed");

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
      const { data: host } = await sb
        .from("profiles")
        .select("stripe_account_id,stripe_charges_enabled")
        .eq("id", listing.owner)
        .single();

      const n = nights(from_date as string, to_date as string);
      const rent = Number(listing.price_per_day) * n;
      const serviceFee = Math.round(rent * 0.10);
      const cleaningFee = Number(listing.cleaning_fee || 0);
      const deposit = listing.deposit_mode !== "incident" ? Number(listing.deposit || 0) : 0;
      const amountTotal = rent + serviceFee + cleaningFee + deposit;
      const platformFee = serviceFee + Math.round(rent * 0.10);
      const hasConnected = !!host?.stripe_account_id && !!host?.stripe_charges_enabled;
      const amountTotalOre = Math.round(amountTotal * 100);
      const platformFeeOre = hasConnected ? Math.round(platformFee * 100) : amountTotalOre;

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
        payment_intent_data: {
          metadata: { booking_id: bookingId },
          ...(hasConnected ? {
            application_fee_amount: platformFeeOre,
            transfer_data: { destination: host!.stripe_account_id },
          } : {}),
        },
        metadata: {
          booking_id: bookingId,
          platform_fee_ore: String(platformFeeOre),
        },
        success_url: (success_url as string) || "https://leieplattform.no/",
        cancel_url: (cancel_url as string) || "https://leieplattform.no/",
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
