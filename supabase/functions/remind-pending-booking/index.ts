// Cron job (daily): email a host who has a booking request sitting in
// 'pending' with no response. Found during a "smertefritt utleie"
// (frictionless rental) pass: the platform already reminds hosts about
// an unfinished Stripe setup and an upcoming handover, but nothing ever
// reminded a host who simply hasn't looked at a pending request --
// the single most common way a renter is left hanging with no recourse
// on a two-sided marketplace. A renter sends a request, the host
// doesn't happen to check the app or see one email, and the booking
// just sits there indefinitely with nothing nudging the host back in.
//
// Deliberately reminder-only, not auto-decline/auto-expire: killing a
// booking the host was about to accept just because a clock ran out
// would trade one bad experience for a worse one. This only ever adds
// a second (and periodically repeated) nudge to the host; the renter's
// own cancel button (already in renderRenter()) remains their way out
// if they'd rather stop waiting.
//
// Invoked only by pg_cron with a service_role bearer, like the other
// cron jobs in this project -- see 20260926090000_stripe_connect_reminder_cron.sql
// for why the actual cron.schedule() call isn't committed as a migration:
//
//   select cron.schedule('remind-pending-booking', '0 9 * * *',
//     $$select net.http_post(url:='https://<project>.supabase.co/functions/v1/remind-pending-booking',
//       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
//       body:='{}'::jsonb) as request_id$$);
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// First nudge a day after the request came in -- give a host a
// realistic chance to just answer it normally first. Then repeat every
// 2 days for as long as it's still sitting unanswered, so it doesn't
// silently drop off the host's radar after one missed email.
const GRACE_HOURS = 24;
const REMIND_EVERY_DAYS = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { data: pending } = await supabase
      .from("bookings")
      .select("id, listing_id, renter_name, from_date, to_date, created_at, host_reminder_sent_at")
      .eq("status", "pending")
      .lt("created_at", new Date(Date.now() - GRACE_HOURS * 3600_000).toISOString());

    const due = (pending ?? []).filter((b) => {
      if (!b.host_reminder_sent_at) return true;
      return new Date(b.host_reminder_sent_at) < new Date(Date.now() - REMIND_EVERY_DAYS * 86400_000);
    });
    if (!due.length) {
      return new Response(JSON.stringify({ ok: true, emailed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listingIds = [...new Set(due.map((b) => b.listing_id))];
    const { data: listings } = await supabase
      .from("listings")
      .select("id, title, owner")
      .in("id", listingIds);
    const listingById = new Map((listings ?? []).map((l) => [l.id, l]));

    const ownerIds = [...new Set((listings ?? []).map((l) => l.owner))];
    // Per-owner lookup, not auth.admin.listUsers() -- that only returns
    // one paginated page by default and would silently miss owners once
    // the user base outgrows it. This set is small (only hosts with a
    // currently-pending, currently-unanswered request), so N lookups is
    // the same pattern already used elsewhere (admin-resolve-deposit,
    // notify-host-application) for exactly this reason.
    const emailById = new Map<string, string | undefined>();
    for (const id of ownerIds) {
      const { data } = await supabase.auth.admin.getUserById(id);
      if (data?.user?.email) emailById.set(id, data.user.email);
    }
    const { data: ownerProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ownerIds);
    const nameById = new Map((ownerProfiles ?? []).map((p) => [p.id, p.full_name]));

    let emailed = 0;
    for (const b of due) {
      const listing = listingById.get(b.listing_id);
      if (!listing) continue;
      const hostEmail = emailById.get(listing.owner);
      if (!hostEmail) continue;

      const firstName = (nameById.get(listing.owner) || "").split(" ")[0] || "der";
      const waitingHours = Math.round((Date.now() - new Date(b.created_at).getTime()) / 3600_000);
      const waitingTxt = waitingHours >= 48
        ? Math.round(waitingHours / 24) + " dager"
        : waitingHours + " timer";

      await sendEmail(
        hostEmail,
        `Ubesvart forespørsel — ${listing.title}`,
        emailLayout(
          "En leietaker venter fortsatt på svar",
          `<p>Hei ${escapeHtml(firstName)},</p>
          <p><strong>${escapeHtml(b.renter_name || "En leietaker")}</strong> har ventet i ${waitingTxt} på svar på forespørselen om å leie <strong>${escapeHtml(listing.title)}</strong> (${b.from_date} → ${b.to_date}).</p>
          <div class="info-box"><p>Rask respons betyr mer for om leietakere velger annonsen din igjen senere. Godta eller avslå så snart du kan.</p></div>
          <a href="https://leieplattform.no/utleier" class="btn">Svar på forespørselen →</a>`,
        ),
      );
      await supabase
        .from("bookings")
        .update({ host_reminder_sent_at: new Date().toISOString() })
        .eq("id", b.id);
      emailed++;
    }

    return new Response(JSON.stringify({ ok: true, emailed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[remind-pending-booking]", err);
    try {
      await supabase.from("error_logs").insert({
        message: "[remind-pending-booking] Unhandled failure",
        stack: String(err).slice(0, 4000),
        url: "edge-function:remind-pending-booking",
        user_agent: "server",
      });
    } catch { /* never let logging the failure become its own unhandled failure */ }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
