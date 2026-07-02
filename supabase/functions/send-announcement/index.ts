import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout } from "../_shared/email.ts";

Deno.serve(async (req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  const users = (data?.users ?? []).filter(
    (u) => u.email && u.email !== "kundeservice@oslocampingutleie.no" && !u.is_anonymous,
  );

  const results: { email: string; ok: boolean }[] = [];

  for (const u of users) {
    const email = u.email!;
    const name = (u.user_metadata?.full_name as string) ?? email.split("@")[0];
    const firstName = name.split(" ")[0] || "Hei";

    const html = emailLayout("Viktig oppdatering fra Leieplattform", `
      <p>Hei ${firstName},</p>

      <p>Vi har gjort noen viktige forbedringer på Leieplattform som du bør vite om:</p>

      <div class="info-box">
        <p><strong>🔐 Nytt innloggingssystem</strong><br>
        Vi har byttet fra e-postlenker til e-post og passord. Du har allerede fått en egen e-post med lenke for å sette opp ditt passord.</p>
      </div>

      <div class="info-box">
        <p><strong>💬 Meldingssystem</strong><br>
        Du kan nå svare på meldinger direkte via innboksen din på leieplattform.no.</p>
      </div>

      <div class="info-box">
        <p><strong>✅ Bedre sikkerhet</strong><br>
        Forbedret betalingsflyt, sikrere bildelagring og raskere støtte.</p>
      </div>

      <p>Har du ikke satt passord ennå, klikk her:</p>
      <a class="btn" href="https://leieplattform.no">Gå til Leieplattform →</a>
      <p style="font-size:13px;color:#888">Velg «Logg inn» → «Glemt passord?» og skriv inn e-postadressen din.</p>

      <p>Har du spørsmål? Svar på denne e-posten eller kontakt oss på
      <a href="mailto:kundeservice@oslocampingutleie.no" style="color:#14512e">kundeservice@oslocampingutleie.no</a>.</p>

      <p>Med vennlig hilsen,<br><strong>Leieplattform</strong></p>
    `);

    try {
      await sendEmail(email, "Viktig oppdatering – nytt innloggingssystem på Leieplattform", html);
      results.push({ email, ok: true });
    } catch (e) {
      console.error("[send-announcement]", email, e);
      results.push({ email, ok: false });
    }

    // Small delay to avoid Resend rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).map((r) => r.email);

  return new Response(JSON.stringify({ sent, failed, total: users.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
