import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout } from "../_shared/email.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    const { hostUserId, messageText, senderName, senderRole } = await req.json();

    if (senderRole === "admin") {
      // Admin sendte melding → varsle utleieren
      const { data: hostUser } = await supabase.auth.admin.getUserById(hostUserId);
      const hostEmail = hostUser?.user?.email;
      if (hostEmail) {
        await sendEmail(
          hostEmail,
          "Ny melding fra Oslo Camping Utleie",
          emailLayout(
            "Du har fått en melding 📬",
            `<p>Du har mottatt en direktemelding fra <strong>Oslo Camping Utleie</strong>:</p>
            <div class="info-box">
              <p style="font-style:italic">"${messageText}"</p>
            </div>
            <p>Logg inn for å svare direkte i meldingssystemet.</p>
            <a href="https://oslocampingutleie.no" class="btn">Gå til Meldinger →</a>`,
          ),
        );
      }
    } else {
      // Utleier svarte → varsle alle admin-brukere
      const { data: admins } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "admin");

      for (const admin of admins ?? []) {
        const { data: adminUser } = await supabase.auth.admin.getUserById(admin.id);
        const adminEmail = adminUser?.user?.email;
        if (adminEmail) {
          await sendEmail(
            adminEmail,
            `Svar fra ${senderName} — Oslo Camping Utleie`,
            emailLayout(
              "Ny melding fra utleier 📬",
              `<p><strong>${senderName}</strong> har svart på din direktemelding:</p>
              <div class="info-box">
                <p style="font-style:italic">"${messageText}"</p>
              </div>
              <a href="https://oslocampingutleie.no" class="btn">Gå til Admin → Meldinger</a>`,
            ),
          );
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-direct-message]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
