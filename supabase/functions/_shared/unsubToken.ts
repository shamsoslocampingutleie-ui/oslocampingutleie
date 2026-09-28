// One-way, unguessable unsubscribe tokens for marketing email links.
// A raw user id in the URL would let anyone flip a KNOWN OTHER user's
// marketing_consent to false just by guessing/copying their id (low
// harm, but still a forgeable link with someone else's identity in a
// public URL -- not acceptable for something that writes to their
// account). HMAC-signs the id with SUPABASE_SERVICE_ROLE_KEY, which is
// already a secret every edge function has and nothing new to
// provision/forget -- the token can only be produced by server code
// that already has that key, and can't be reversed to find other
// users' ids or forged for a different id.
async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function unsubToken(userId: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return (await hmacHex(secret, userId)).slice(0, 32);
}

export async function verifyUnsubToken(userId: string, token: string): Promise<boolean> {
  if (!userId || !token) return false;
  const expected = await unsubToken(userId);
  // Constant-time-ish compare -- length check first (cheap, safe to
  // short-circuit), then a manual char compare instead of `===` so a
  // timing side-channel can't help narrow down a correct token.
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

export function unsubUrl(base: string, userId: string, token: string): string {
  return `${base}/functions/v1/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}
