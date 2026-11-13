// Shopify webhooks: app uninstalled and the mandatory privacy topics. Verified by body HMAC.
import { sql, readRaw, send } from "../_lib.js";
import { verifyWebhook } from "./_shopify.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const raw = await readRaw(req);
  if (!process.env.SHOPIFY_API_SECRET || !verifyWebhook(raw, req.headers["x-shopify-hmac-sha256"])) return send(res, 401, { error: "Bad signature" });
  const topic = String(req.headers["x-shopify-topic"] || ""), shop = String(req.headers["x-shopify-shop-domain"] || "").toLowerCase();
  try {
    if (topic === "app/uninstalled" || topic === "shop/redact") { await sql`DELETE FROM shopify_connections WHERE shop = ${shop}`; await sql`DELETE FROM shopify_pending WHERE shop = ${shop}`; }
    // customers/data_request and customers/redact: we store no customer records, only aggregate counts.
  } catch (e) { console.error(e); }
  send(res, 200, { ok: true });
}
