// Sends a Web Push notification to all push subscriptions for a given user.
// Called fire-and-forget from other Edge Functions after insertNotification().
//
// Auth: accepts service-role Bearer OR valid Supabase JWT.
// Body: { userId: string, title: string, body: string, url?: string }
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
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
    // Accept service-role key OR valid user JWT
    const auth = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!auth.includes(serviceKey)) {
      const { error } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
      if (error) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { userId, title, body, url } = await req.json();
    if (!userId || !title || !body) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapidConfigured = !!(
      Deno.env.get("VAPID_PUBLIC_KEY") && Deno.env.get("VAPID_PRIVATE_KEY")
    );

    if (!vapidConfigured) {
      console.warn("[send-push] VAPID keys not configured — push disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Supabase secrets.");
      return new Response(
        JSON.stringify({ sent: 0, removed: 0, vapid_configured: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, removed: 0, vapid_configured: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const goneIds: string[] = [];
    let sent = 0;

    await Promise.all(subs.map(async (sub) => {
      const result = await sendWebPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        { title, body, url: url ?? "/", tag: "lp-notif" },
      );
      if (result === "ok") sent++;
      if (result === "gone") goneIds.push(sub.id);
    }));

    // Remove expired/unsubscribed endpoints
    if (goneIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", goneIds);
    }

    return new Response(
      JSON.stringify({ sent, removed: goneIds.length, vapid_configured: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[send-push] error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
