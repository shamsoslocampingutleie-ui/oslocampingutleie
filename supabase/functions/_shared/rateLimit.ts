const store = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(
  req: Request,
  limit = 10,
  windowMs = 60_000,
): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const now = Date.now();
  const entry = store.get(ip);
  if (!entry || now > entry.reset) {
    store.set(ip, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  });
}
