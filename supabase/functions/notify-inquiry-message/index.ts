// Notifies the other party in a pre-booking "Spør utleier" inquiry
// thread (booking_id = 'inquiry:<listingId>:<renterId>') by email and,
// if they've enabled it, web push. Mirrors notify-direct-message, but
// for listing questions rather than admin support chat — these threads
// have no real bookings row to look anything up from.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { sendWebPush } from "../_shared/webpush.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function pushTo(userId: string, title: string, body: string) {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs || subs.length === 0) return;
  const goneIds: string[] = [];
  await Promise.all(subs.map(async (sub) => {
    const result = await sendWebPush(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      { title, body, url: "/", tag: "lp-inquiry" },
    );
    if (result === "gone") goneIds.push(sub.id);
  }));
  if (goneIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", goneIds);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!(await checkRateLimit(req, 20, 60_000))) return rateLimitResponse(corsHeaders);

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
    const callerId = userData.user.id;

    const { listingId, renterId, messageText } = await req.json();
    if (!listingId || !renterId || !messageText) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: listing } = await supabase
      .from("listings")
      .select("title, owner")
      .eq("id", listingId)
      .single();
    if (!listing) {
      return new Response(JSON.stringify({ error: "Listing not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine role from the caller's real identity — never trust a
    // client-supplied role for who gets notified.
    const isHostSender = callerId === listing.owner;
    const isRenterSender = callerId === renterId;
    if (!isHostSender && !isRenterSender) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: senderProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", callerId)
      .single();
    const senderName = escapeHtml(senderProfile?.full_name || (isHostSender ? "Utleier" : "En bruker"));

    const recipientId = isHostSender ? renterId : listing.owner;
    const recipientAuth = await supabase.auth.admin.getUserById(recipientId);
    const recipientEmail = recipientAuth.data?.user?.email;

    const title = isHostSender
      ? `${senderName} har svart på spørsmålet ditt`
      : `Nytt spørsmål om «${listing.title}»`;

    if (recipientEmail) {
      await sendEmail(
        recipientEmail,
        `${title} — Leieplattform`,
        emailLayout(
          isHostSender ? "Utleier har svart 📬" : "Du har fått et spørsmål 📬",
          `<p><strong>${senderName}</strong> skrev om <strong>${escapeHtml(listing.title)}</strong>:</p>
          <div class="info-box">
            <p style="font-style:italic">"${escapeHtml(String(messageText).slice(0, 300))}"</p>
          </div>
          <a href="https://leieplattform.no" class="btn">Svar på leieplattform.no →</a>`,
        ),
      );
    }

    await pushTo(recipientId, title, String(messageText).slice(0, 140));

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-inquiry-message]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
