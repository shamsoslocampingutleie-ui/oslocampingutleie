import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function checkRateLimit(
  req: Request,
  limit = 10,
  windowMs = 60_000,
): Promise<boolean> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const windowSec = Math.floor(windowMs / 1000);
  const windowKey = Math.floor(Date.now() / windowMs);
  // Scope the counter per function: without the function name every
  // edge function shared one counter per IP, so e.g. a burst of chat
  // notifications could lock the same user out of a 5/min checkout.
  const fn = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const key = `${fn}:${ip}:${windowKey}`;

  const { data, error } = await supabase.rpc("increment_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_ttl_seconds: windowSec,
  });

  if (error) {
    // If the RPC doesn't exist yet, fail open (don't block requests)
    console.warn("[rateLimit] RPC not available, failing open:", error.message);
    return true;
  }

  return data === true;
}

export function rateLimitResponse(
  corsHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Retry-After": "60",
    },
  });
}
