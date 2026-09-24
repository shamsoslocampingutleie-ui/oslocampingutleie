// Emails the admin the instant someone submits a host application.
//
// Why this exists: submitHostApplication() (see src/app.html) sets
// host_approved=false and tells the applicant "vanligvis innen 24 timer"
// (usually within 24 hours), but nothing ever told the admin an
// application had arrived -- the only signal was a small red dot on the
// "Utleiere" tab, visible only if/when an admin happens to open /admin.
// A host who has just gone through signup + application, ready to list
// and start earning, is the most primed they will ever be; every hour
// spent waiting unnoticed is an hour they can cool off, find another
// platform, or just forget. This closes that gap without changing the
// approval flow itself -- an admin still has to click "Godkjenn".
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "kundeservice@oslocampingutleie.no";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // The host_approved !== false check below already stops this being
  // spammed once a decision is made, but while still pending a caller
  // could otherwise loop this and flood ADMIN_EMAIL repeatedly.
  if (!await checkRateLimit(req, 5, 60_000)) return rateLimitResponse(corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trust only that the caller is who they say they are -- look up
    // their own name/email server-side rather than accepting it from
    // the request body, so this can't be used to send arbitrary mail.
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email, host_approved")
      .eq("id", userData.user.id)
      .single();

    // Only notify for an actual pending application, so this can't be
    // spammed by repeated calls once already approved/rejected.
    if (profile?.host_approved !== false) {
      return new Response(JSON.stringify({ ok: true, skipped: "not pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = profile?.full_name || profile?.email || userData.user.email || "Ukjent bruker";
    const email = profile?.email || userData.user.email || "";

    await sendEmail(
      ADMIN_EMAIL,
      `Ny utleiersøknad: ${name}`,
      emailLayout(
        "Ny utleiersøknad venter 🏠",
        `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) har søkt om å bli utleier.</p>
        <p>Søknaden lover svar «vanligvis innen 24 timer» — godkjenn eller avslå så raskt du kan for best konvertering.</p>
        <a href="https://leieplattform.no/app.html#admin" class="btn">Gå til Utleiere i admin →</a>`,
      ),
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-host-application]", err);
    // Never let a notification failure block the application itself.
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
