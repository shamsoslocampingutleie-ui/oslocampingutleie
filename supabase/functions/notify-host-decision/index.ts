// Emails a host applicant when admin approves or rejects their
// application. The apply modal explicitly promises "Du får e-post når
// den er godkjent" (you'll get an email once approved) — nothing ever
// sent that email; approveHost()/rejectHost() only updated the DB row.
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

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId, approved } = await req.json();
    if (!userId || typeof approved !== "boolean") {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const applicantAuth = await supabase.auth.admin.getUserById(userId);
    const applicantEmail = applicantAuth.data?.user?.email;
    if (applicantEmail) {
      await sendEmail(
        applicantEmail,
        approved ? "Du er godkjent som utleier! 🎉" : "Om søknaden din som utleier",
        approved
          ? emailLayout(
            "Godkjent som utleier 🎉",
            `<p>Bra nytt! Søknaden din om å bli utleier på Leieplattform er godkjent.</p>
            <p>Du kan nå legge ut annonser og begynne å tjene penger på utstyret ditt.</p>
            <a href="https://leieplattform.no" class="btn">Legg ut din første annonse →</a>`,
          )
          : emailLayout(
            "Søknaden din ble ikke godkjent",
            `<p>Vi har sett gjennom søknaden din om å bli utleier på Leieplattform, og kan dessverre ikke godkjenne den slik den står nå.</p>
            <p>Har du spørsmål om hvorfor, eller ønsker å søke på nytt, kan du kontakte oss i chatten på leieplattform.no.</p>
            <a href="https://leieplattform.no" class="btn">Gå til leieplattform.no →</a>`,
          ),
      );
    }

    return new Response(JSON.stringify({ ok: true, emailed: !!applicantEmail }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-host-decision]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
