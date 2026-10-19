type Bucket = { count: number; expiresAt: number };
const buckets = new Map<string, Bucket>();

export function authRateLimit(request: Request, action: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const key = `${action}:${address}`;
  const now = Date.now();
  for (const [bucketKey, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(bucketKey);
  if (buckets.size > 2_000) buckets.clear();
  const current = buckets.get(key);
  if (!current || current.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}
