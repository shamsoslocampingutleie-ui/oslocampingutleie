import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { sendWebPush } from "../_shared/webpush.ts";

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

    // senderRole is client-supplied — never trust it for authorization.
    // Verify the caller's actual role/identity server-side before sending
    // an email that claims to be "from Leieplattform" or from a named host.
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", userData.user.id)
      .single();
    const callerIsAdmin = callerProfile?.role === "admin";

    if (senderRole === "admin") {
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Admin sendte melding → varsle utleieren
      const { data: hostUser } = await supabase.auth.admin.getUserById(hostUserId);
      const hostEmail = hostUser?.user?.email;
      if (hostEmail) {
        await sendEmail(
          hostEmail,
          "Ny melding fra Leieplattform",
          emailLayout(
            "Du har fått en melding 📬",
            `<p>Du har mottatt en direktemelding fra <strong>Leieplattform</strong>:</p>
            <div class="info-box">
              <p style="font-style:italic">"${escapeHtml(messageText)}"</p>
            </div>
            <p>Logg inn for å svare direkte i meldingssystemet.</p>
            <a href="https://leieplattform.no" class="btn">Gå til Meldinger →</a>`,
          ),
        );
      }
    } else {
      // Utleier svarte → verify the caller is actually the host being represented
      if (userData.user.id !== hostUserId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const safeSenderName = escapeHtml(senderName || callerProfile?.full_name || "Utleier");
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
            `Svar fra ${safeSenderName} — Leieplattform`,
            emailLayout(
              "Ny melding fra utleier 📬",
              `<p><strong>${safeSenderName}</strong> har svart på din direktemelding:</p>
              <div class="info-box">
                <p style="font-style:italic">"${escapeHtml(messageText)}"</p>
              </div>
              <a href="https://leieplattform.no" class="btn">Gå til Admin → Meldinger</a>`,
            ),
          );
        }

        // Push notification (lock-screen alert on devices that opted in)
        const { data: subs } = await supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("user_id", admin.id);
        if (subs && subs.length > 0) {
          const goneIds: string[] = [];
          await Promise.all(subs.map(async (sub) => {
            const result = await sendWebPush(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              {
                title: `Ny melding fra ${safeSenderName}`,
                body: String(messageText).slice(0, 140),
                url: "/",
                tag: "lp-admin-chat",
              },
            );
            if (result === "gone") goneIds.push(sub.id);
          }));
          if (goneIds.length > 0) {
            await supabase.from("push_subscriptions").delete().in("id", goneIds);
          }
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
