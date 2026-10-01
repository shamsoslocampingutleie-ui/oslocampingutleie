// Public contact form submission -- /kontakt (src/app.html) only ever
// offered live chat, a phone number, or social media; contact_requests
// (correct RLS, admin-only read) has existed since
// 20260926130000_demand_signals_and_track_contact_requests.sql but
// nothing ever wrote to it or notified anyone when a row landed --
// same "half-built, no follow-through" gap as demand_signals had.
// Some visitors genuinely don't want a live chat or a phone call (off
// hours, prefer writing things out, etc.) -- this is that async path,
// built the same way every other public form in this project is:
// rate-limited by IP, inserts a row, emails admin so it's actually seen.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // Fully public, no auth -- same reason campaign-submit rate-limits by
  // IP: nothing else stops a burst of junk contact_requests rows or an
  // ADMIN_EMAIL flood from a scripted caller.
  if (!await checkRateLimit(req, 5, 300_000)) return rateLimitResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim().slice(0, 200);
    const email = String(body.email ?? "").trim().slice(0, 320);
    const phone = String(body.phone ?? "").trim().slice(0, 40);
    const subject = String(body.subject ?? "").trim().slice(0, 200);
    const message = String(body.message ?? "").trim().slice(0, 4000);

    if (!name || name.length < 2) {
      return new Response(JSON.stringify({ error: "Fyll inn et gyldig navn." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return new Response(JSON.stringify({ error: "Fyll inn en gyldig e-postadresse." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!message || message.length < 5) {
      return new Response(JSON.stringify({ error: "Skriv en melding (minst 5 tegn)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Best-effort: link to an existing profile if the caller happens to
    // be logged in, purely so admin can see account context -- never
    // required, this form must work for a logged-out visitor too.
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = userData?.user?.id ?? null;
    }

    const { error: insertError } = await supabase.from("contact_requests").insert({
      name,
      email,
      phone,
      subject,
      message,
      user_id: userId,
    });
    if (insertError) {
      console.error("[contact-submit] insert error:", insertError);
      return new Response(JSON.stringify({ error: "Noe gikk galt. Prøv igjen." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (ADMIN_EMAIL) {
      await sendEmail(
        ADMIN_EMAIL,
        `Ny henvendelse: ${name}${subject ? " — " + subject : ""}`,
        emailLayout(
          "Ny henvendelse fra kontaktskjemaet 📬",
          `<div class="info-box">
            <p><strong>Navn:</strong> ${escapeHtml(name)}</p>
            <p><strong>E-post:</strong> ${escapeHtml(email)}</p>
            ${phone ? `<p><strong>Telefon:</strong> ${escapeHtml(phone)}</p>` : ""}
            ${subject ? `<p><strong>Emne:</strong> ${escapeHtml(subject)}</p>` : ""}
          </div>
          <p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
        ),
      ).catch((e) => console.warn("[contact-submit] admin email failed:", e));
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[contact-submit]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
