// /api/state?k=thoughts   GET  -> whatever the bot last published
// /api/state?k=thoughts   POST -> store it, requires the shared secret
//
// Uses the KV REST API directly rather than @vercel/kv, so the site stays a
// zero-build static deploy with no package.json.
//
// Vercel env needed: KV_REST_API_URL, KV_REST_API_TOKEN, CARK_PUBLISH_SECRET

const KEYS = {
  thoughts: "cark:thoughts",
  trades: "cark:trades",
  presence: "cark:presence",
};

const MAX_BODY = 400 * 1024;

function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kv(path, init) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      ...(init && init.headers),
    },
  });
  if (!res.ok) throw new Error(`kv ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

export default async function handler(req, res) {
  const key = KEYS[String((req.query && req.query.k) || "thoughts")];
  if (!key) return res.status(400).json({ error: "unknown key" });

  if (!kvConfigured()) {
    // no store wired up yet. the pages fall back to their committed json.
    return res.status(503).json({ error: "no store configured" });
  }

  if (req.method === "GET") {
    try {
      const out = await kv(`get/${encodeURIComponent(key)}`);
      if (!out || out.result == null) return res.status(404).json({ error: "empty" });
      res.setHeader("Cache-Control",
        key === KEYS.presence
          ? "public, max-age=15, stale-while-revalidate=60"
          : "public, max-age=30, stale-while-revalidate=300");
      return res.status(200).json(JSON.parse(out.result));
    } catch (err) {
      console.error("state read failed:", err.message);
      return res.status(502).json({ error: "could not read" });
    }
  }

  if (req.method === "POST") {
    const secret = process.env.CARK_PUBLISH_SECRET;
    if (!secret) return res.status(503).json({ error: "publishing is not configured" });
    if (req.headers["x-cark-key"] !== secret) {
      return res.status(401).json({ error: "no" });
    }

    let payload;
    try {
      payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (!payload || payload.length > MAX_BODY) throw new Error("bad size");
      JSON.parse(payload);
    } catch {
      return res.status(400).json({ error: "body must be json under 400kb" });
    }

    try {
      await kv(`set/${encodeURIComponent(key)}`, { method: "POST", body: payload });
      return res.status(200).json({ ok: true, key, bytes: payload.length });
    } catch (err) {
      console.error("state write failed:", err.message);
      return res.status(502).json({ error: "could not write" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "get or post" });
}
