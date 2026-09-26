// Self-service account deletion. Found missing during a master-prompt
// review (§26, "sletting av konto"): the only path was "contact an
// admin in chat", who deletes manually on request.
//
// This does NOT hard-delete the profile row or call
// supabase.auth.admin.deleteUser() with a real (cascading) delete.
// profiles.id -> auth.users.id is ON DELETE CASCADE, and
// listings.owner / bookings.renter -> profiles.id are ALSO ON DELETE
// CASCADE -- a real delete would silently destroy every listing this
// person ever hosted and every booking they ever made, including
// completed, paid ones. That would both violate this platform's own
// privacy policy (transaction data kept 5 years for Norwegian
// bookkeeping law) and strand the OTHER party's booking history for a
// transaction that isn't only this user's to erase.
//
// Instead: anonymize the profile in place (keep the row and its id, so
// every FK stays intact), delete only the privacy-sensitive bits that
// have no bookkeeping value (ID/license images), pause their listings,
// and soft-delete the auth user (shouldSoftDelete=true marks it
// deleted/unusable for login without triggering the cascade, since the
// row is never actually removed).
//
// bookings.renter_name / reviews.reviewer_name are already snapshotted
// text columns (not live joins to profiles), so historical booking and
// review displays are unaffected by this -- exactly the right behavior
// for a financial record that has to show what was true at the time.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (!await checkRateLimit(req, 5, 300_000)) return rateLimitResponse(corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Always the caller's own account -- never accept a client-supplied
    // target id for a destructive action like this.
    const userId = userData.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role === "admin") {
      return new Response(
        JSON.stringify({ error: "Adminkontoer kan ikke slettes selv. Kontakt en annen administrator." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Block if anything is still "live": an unresolved booking (as
    // renter, or as host via a listing they own) -- either not yet in
    // a final state, or paid but the payout hasn't been released yet.
    const { data: ownedListings } = await supabase
      .from("listings")
      .select("id")
      .eq("owner", userId);
    const listingIds = (ownedListings ?? []).map((l) => l.id);

    const orParts = [`renter.eq.${userId}`];
    if (listingIds.length) orParts.push(`listing_id.in.(${listingIds.join(",")})`);
    const { data: liveBookings } = await supabase
      .from("bookings")
      .select("id, status, paid, payout_released")
      .or(orParts.join(","));

    const blocking = (liveBookings ?? []).filter((b) =>
      !["completed", "declined", "cancelled"].includes(b.status) ||
      (b.paid && !b.payout_released)
    );
    if (blocking.length > 0) {
      return new Response(
        JSON.stringify({
          error:
            "Du har en eller flere aktive bookinger (som leietaker eller utleier) som ikke er ferdig gjort opp ennå. Fullfør eller avslutt disse først, kontakt oss i chatten hvis du trenger hjelp.",
          blockedCount: blocking.length,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Delete privacy-sensitive documents that have no bookkeeping value
    // -- best-effort, never blocks the rest of deletion on a storage
    // hiccup.
    try {
      const { data: files } = await supabase.storage
        .from("drivers-license")
        .list(userId);
      if (files?.length) {
        await supabase.storage
          .from("drivers-license")
          .remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch { /* best-effort */ }

    // Anonymize -- keep the row and its id so every FK (listings,
    // bookings, reviews, referred_by, ...) stays intact.
    await supabase.from("profiles").update({
      full_name: "Slettet bruker",
      email: `slettet+${userId}@leieplattform.no`,
      phone: null,
      address: null,
      avatar_url: null,
      bio: null,
      company_name: null,
      org_number: null,
      org_verified: false,
      drivers_license_front: null,
      drivers_license_back: null,
      drivers_license_verified: false,
      host_id_doc_url: null,
      host_id_status: "none",
      suspended: true,
    }).eq("id", userId);

    if (listingIds.length) {
      await supabase.from("listings").update({ status: "paused" }).eq("owner", userId);
    }

    // Soft delete: GoTrue marks the auth user deleted/unusable for
    // login without removing the row, so the ON DELETE CASCADE on
    // profiles.id never fires.
    const { error: delErr } = await supabase.auth.admin.deleteUser(userId, true);
    if (delErr) {
      console.error("[delete-account] soft delete failed", delErr);
      return new Response(
        JSON.stringify({ error: "Kontoen ble anonymisert, men avlogging feilet. Kontakt oss i chatten." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[delete-account]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
