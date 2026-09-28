// Shared by delete-account (self-service) and admin-delete-user (admin
// action). Extracted from delete-account's original implementation
// after finding admin-delete-user did something genuinely dangerous:
// a REAL supabase.auth.admin.deleteUser(userId) hard delete, no soft
// flag. profiles.id -> auth.users.id, listings.owner -> profiles.id
// and bookings.renter -> profiles.id are all ON DELETE CASCADE, so
// that hard delete would have silently destroyed every listing the
// user ever hosted and every booking they ever made -- including
// completed, paid ones -- and, critically, this isn't only that
// user's data to erase: it also destroys the OTHER party's booking/
// transaction history for every one of those bookings, and violates
// this platform's own privacy policy (Norwegian bookkeeping law
// requires 5 years' retention on transaction records). Exactly the
// failure mode delete-account was carefully built to avoid for
// self-service deletion -- admin-delete-user, built separately, never
// got that same reasoning applied. An admin clicking "Slett" on a
// problematic host's account (the actual, intended use case) would
// have corrupted every renter's booking history with that host along
// the way.
//
// Anonymizes in place instead: keeps the profile row and its id (every
// FK stays intact), deletes only the privacy-sensitive bits with no
// bookkeeping value (ID/license images), pauses their listings, and
// soft-deletes the auth user (shouldSoftDelete=true marks it deleted/
// unusable for login without triggering the cascade).
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function anonymizeAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string; blockedCount?: number }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (profile?.role === "admin") {
    return { ok: false, error: "Adminkontoer kan ikke slettes. Fjern admin-rollen først." };
  }

  // Block if anything is still "live": an unresolved booking (as
  // renter, or as host via a listing they own) -- either not yet in a
  // final state, or paid but the payout hasn't been released yet.
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
    return {
      ok: false,
      error: "Denne brukeren har en eller flere aktive bookinger (som leietaker eller utleier) som ikke er ferdig gjort opp ennå.",
      blockedCount: blocking.length,
    };
  }

  // Delete privacy-sensitive documents that have no bookkeeping value --
  // best-effort, never blocks the rest of deletion on a storage hiccup.
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

  // Soft delete: GoTrue marks the auth user deleted/unusable for login
  // without removing the row, so the ON DELETE CASCADE on profiles.id
  // never fires.
  const { error: delErr } = await supabase.auth.admin.deleteUser(userId, true);
  if (delErr) {
    console.error("[anonymizeAccount] soft delete failed", delErr);
    return { ok: false, error: "Kontoen ble anonymisert, men avlogging feilet." };
  }

  return { ok: true };
}
