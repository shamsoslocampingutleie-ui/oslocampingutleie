import Stripe from "npm:stripe@17";
import Anthropic from "npm:@anthropic-ai/sdk";
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
  // booking-request emails, hammer Stripe checkout-session creation, or
  // burn Anthropic API budget on the ID check below.
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
    id_image_base64, id_image_content_type,
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
  // ID-opplasting er ALLTID påkrevd for en gjeste-booking (som alltid er
  // direktebooking -- ikke-innloggede kan ikke sende forespørsler, se
  // sendRequest() sin login-gate) -- uavhengig av hva utleier har valgt
  // under "Legitimasjonssjekk" på annonsen. Det valget avgjør kun om
  // utleier I TILLEGG dobbeltsjekker fysisk ved oppmøte; det fjerner
  // aldri den digitale kontrollen her. Se også notify at ingen booking
  // (og ingen betaling) skal opprettes før dette er verifisert.
  if (typeof id_image_base64 !== "string" || id_image_base64.length < 100) {
    return err(400, "Du må laste opp et bilde av gyldig legitimasjon for å booke.");
  }
  if (id_image_base64.length > 20_000_000) {
    return err(400, "Bildet er for stort.");
  }
  const contentType = typeof id_image_content_type === "string" && id_image_content_type.startsWith("image/")
    ? id_image_content_type
    : "image/jpeg";

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

  // Same check as stripe-checkout (the logged-in flow), added there
  // after finding live that 4 of 7 approved hosts had never connected
  // Stripe at all -- without this, a guest's payment goes through in
  // full but the host's share can never actually be transferred out
  // (stripe-release-payout only pays a connected account), so it sits
  // in the platform's balance permanently. Checked before the paid AI
  // verification call below so a doomed booking doesn't burn that cost.
  const { data: hostProfileForCheck } = await sb
    .from("profiles")
    .select("role, stripe_account_id, stripe_charges_enabled")
    .eq("id", listing.owner)
    .maybeSingle();
  const hostHasConnect = !!hostProfileForCheck?.stripe_account_id;
  if (!hostHasConnect && hostProfileForCheck?.role !== "admin") {
    return err(400, "Utleieren har ikke koblet til Stripe for utbetalinger ennå. Kontakt utleier.");
  }
  if (hostHasConnect && !hostProfileForCheck?.stripe_charges_enabled) {
    return err(400, "Utleieren har ikke fullført Stripe-oppsettet sitt ennå. Kontakt utleier.");
  }

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

  // --- Legitimasjonskontroll (AI + navnesammenligning) -----------------
  // Kjøres FØR bookingen i det hele tatt opprettes: en gjeste-booking er
  // alltid en direktebooking (betaling skjer med en gang), så brukerens
  // eget krav -- "ved umiddelbar booking uten ventetid, går bookingen kun
  // gjennom hvis legitimasjonen blir godkjent" -- betyr her et strengt,
  // deterministisk ja/nei uten en "venter på manuell gjennomgang"-mellomting
  // (i motsetning til den innloggede flyten, der en forespørsel uten
  // umiddelbar betaling kan vente på admin). Samme vurderingslogikk som
  // verify-license (identisk prompt/kriterier), duplisert her fordi den
  // funksjonen krever et innlogget Supabase-brukertoken denne gjesten ikke
  // har.
  let aiResult: { verified: boolean; reason: string; extractedName: string | null; nameMatches: boolean | null; confidence: string | null } | null = null;
  try {
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
    const docType = needs_license ? "license" : "identity";
    const nameInstruction = `\n\nPersonen som booker har oppgitt navnet "${(renter_name as string).replace(/[\n\r"]/g, " ")}". Les navnet som står skrevet på dokumentet, og vurder om det rimelig samsvarer med det oppgitte navnet (små forskjeller i stavemåte, mellomnavn, rekkefølge på for-/etternavn er OK — men et tydelig annet navn er IKKE en match).`;
    const prompt = docType === "identity"
      ? `Du er et dokumentverifiseringssystem. Analyser dette bildet og avgjør om det er et gyldig identitetsdokument.

Godkjente dokumenter:
- Nasjonalt ID-kort (fra hvilket som helst land)
- Pass
- Offisielt brev eller dokument som inneholder personens fulle navn og adresse (bankbrev, offentlig brev, fakturaer fra offentlige etater)
- Oppholdstillatelse eller annet offentlig ID-dokument

IKKE godkjent: bilder av personer, selfies, tilfeldige bilder, kvitteringer, uoffisielle dokumenter.${nameInstruction}

Svar KUN med gyldig JSON:
{
  "isValid": true or false,
  "confidence": "high", "medium", or "low",
  "reason": "én setning på norsk",
  "extractedName": "navnet slik det står på dokumentet, eller null hvis ikke lesbart",
  "nameMatches": true, false, or null
}`
      : `Du er et dokumentverifiseringssystem. Analyser dette bildet og avgjør om det er et gyldig europeisk førerkort (EU/EØS + Storbritannia, Sveits m.fl.).${nameInstruction}

Svar KUN med gyldig JSON:
{
  "isValid": true or false,
  "confidence": "high", "medium", or "low",
  "reason": "én setning på norsk",
  "extractedName": "navnet slik det står på dokumentet, eller null hvis ikke lesbart",
  "nameMatches": true, false, or null
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: id_image_base64 as string } },
          { type: "text", text: prompt },
        ],
      }],
    });
    const rawText = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const braceMatch = rawText.match(/\{[\s\S]*\}/);
    const candidates = [rawText, fenceMatch?.[1], braceMatch?.[0]].filter(Boolean) as string[];
    let parsed: Record<string, unknown> | undefined;
    for (const candidate of candidates) {
      try { parsed = JSON.parse(candidate); break; } catch { /* try next */ }
    }
    if (!parsed) {
      console.error("[guest-checkout] could not parse AI response:", rawText);
      return err(500, "Kunne ikke kontrollere legitimasjonen. Prøv igjen, eller logg inn for å booke.");
    }
    const nameOk = parsed.nameMatches !== false;
    aiResult = {
      verified: parsed.isValid === true && (parsed.confidence === "high" || parsed.confidence === "medium") && nameOk,
      reason: (parsed.reason as string) || "",
      extractedName: (parsed.extractedName as string) || null,
      nameMatches: (parsed.nameMatches as boolean | null) ?? null,
      confidence: (parsed.confidence as string) || null,
    };
  } catch (aiErr) {
    console.error("[guest-checkout] AI verification failed:", aiErr);
    return err(500, "Kunne ikke kontrollere legitimasjonen akkurat nå. Prøv igjen om litt, eller logg inn for å booke.");
  }

  if (!aiResult.verified) {
    const msg = aiResult.nameMatches === false
      ? "Navnet på dokumentet stemmer ikke overens med navnet du oppga. Sørg for at det er ditt eget dokument, eller logg inn og prøv på nytt."
      : "Vi kunne ikke bekrefte legitimasjonen automatisk. Last opp et tydeligere bilde av et gyldig ID-dokument, eller logg inn og prøv på nytt.";
    return err(400, msg);
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

  // Store the already-verified ID image server-side (service role, so no
  // RLS/schema issues like the old client-side post-hoc insert had) and
  // record the AI result for admin visibility in the samme oppslag som
  // det innloggede løpet.
  try {
    const ext = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg";
    const path = `${bookingId}/renter_id/${Date.now()}.${ext}`;
    const bytes = Uint8Array.from(atob(id_image_base64 as string), (c) => c.charCodeAt(0));
    const { error: upErr } = await sb.storage.from("booking-photos").upload(path, bytes, { contentType, upsert: true });
    if (!upErr) {
      const { data: pu } = sb.storage.from("booking-photos").getPublicUrl(path);
      if (pu?.publicUrl) {
        await sb.from("booking_documents").insert({
          booking_id: bookingId,
          user_id: renterId,
          type: "drivers_license",
          url: pu.publicUrl,
          note: `AI-verifisert ✓ (${aiResult.confidence ?? "?"})${aiResult.extractedName ? " — navn på dokument: " + aiResult.extractedName : ""}`,
          // Retention (masterprompt section 11 -- don't keep ID docs
          // longer than necessary): same 14-days-after-rental-end window
          // as the logged-in flow, picked up by auto-clean-errors' daily
          // sweep. Without this, delete_after stayed null forever and
          // the sweep's `.not("delete_after","is",null)` filter never
          // matched a single row.
          delete_after: new Date(new Date(to_date as string).getTime() + 14 * 86400000).toISOString(),
        });
      }
    } else {
      console.error("[guest-checkout] ID storage upload failed:", upErr);
    }
  } catch (storeErr) {
    console.error("[guest-checkout] ID storage step failed:", storeErr);
  }

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
          // See 20260925200000_deposit_held_not_paid_to_host.sql -- kept
          // out of the host's payout, refunded to the renter later.
          deposit_ore: String(Math.round(deposit * 100)),
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
    instant_book: listing.instant_book,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
