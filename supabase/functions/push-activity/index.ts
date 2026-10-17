// TASC Connect · push-activity
// Called by a Supabase Database Webhook each time a row is added to activity_log.
// Turns it into a short notification and sends it to every admin phone that asked for that kind.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   VAPID_PRIVATE_KEY  the private key JSON you were sent privately (never put it in GitHub)
//   HOOK_SECRET        any long random text; the webhook sends it in the x-hook-secret header
//   PUSH_CONTACT       optional, e.g. mailto:you@gmail.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { buildPushHTTPRequest } from "npm:@pushforge/builder@2.0.5";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWK = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SECRET = Deno.env.get("HOOK_SECRET") ?? "";
const CONTACT = Deno.env.get("PUSH_CONTACT") ?? "mailto:admin@example.com";

const db = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

Deno.serve(async (req) => {
  if (!SECRET || req.headers.get("x-hook-secret") !== SECRET) return new Response("forbidden", { status: 403 });
  const hook = await req.json().catch(() => null);
  const id = hook?.record?.id;
  if (hook?.type !== "INSERT" || !id) return new Response("ignored");

  const p = await (await db("rpc/push_payload", { method: "POST", body: JSON.stringify({ p_id: id }) })).json();
  if (!p?.kind) return new Response("no payload");

  // Admin phones that want this kind; not the phone of whoever did it
  const q = `push_subscriptions?select=endpoint,keys,gmail&kinds=cs.{${p.kind}}` +
    (p.actor_gmail ? `&gmail=neq.${encodeURIComponent(p.actor_gmail)}` : "");
  const subs: { endpoint: string; keys: { p256dh: string; auth: string }; gmail: string }[] = await (await db(q)).json();
  if (!Array.isArray(subs) || !subs.length) return new Response("no subscribers");

  const results = await Promise.allSettled(subs.map(async (s) => {
    const { endpoint, headers, body } = await buildPushHTTPRequest({
      privateJWK: JWK,
      subscription: { endpoint: s.endpoint, keys: s.keys },
      message: {
        payload: { title: p.title, body: p.body, url: p.url, tag: p.tag },
        adminContact: CONTACT,
        options: { ttl: 6 * 60 * 60, urgency: p.kind === "alerts" ? "high" : "normal" },
      },
    });
    const r = await fetch(endpoint, { method: "POST", headers, body });
    // 404 / 410: that phone uninstalled the app or turned notifications off; forget it
    if (r.status === 404 || r.status === 410) {
      await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" });
    }
    return r.status;
  }));
  return new Response(JSON.stringify(results.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason)))),
    { headers: { "Content-Type": "application/json" } });
});
