// Shopify read-only connection: OAuth helpers and the sales sync.
// Needs SHOPIFY_API_KEY and SHOPIFY_API_SECRET from a Partner app whose redirect URL is SITE + /api/shopify/callback.
import crypto from "node:crypto";
import { sql, decrypt, encrypt, SITE } from "../_lib.js";

export const API_VERSION = "2025-07";
export const SCOPES = "read_orders,read_customers";
export const configured = () => !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
export const REDIRECT = `${SITE}/api/shopify/callback`;
export const validShop = (s) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(s || ""));

// Query-string HMAC Shopify sends on the OAuth callback.
export function verifyQueryHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest).sort().map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`).join("&");
  const digest = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(msg).digest("hex");
  return digest.length === String(hmac).length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(hmac)));
}
// Body HMAC on webhooks.
export function verifyWebhook(raw, header) {
  const digest = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(raw).digest("base64");
  const h = String(header || "");
  return digest.length === h.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(h));
}

export async function graphql(shop, token, query, variables = {}) {
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error("Shopify said: " + (j.errors ? JSON.stringify(j.errors).slice(0, 300) : r.status));
  return j.data;
}

const ORDERS = `query($cursor: String, $q: String) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { id createdAt test cancelledAt displayFinancialStatus
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      customer { id } }
  } }`;
const SHOP = `{ shop { name myshopifyDomain currencyCode createdAt primaryDomain { host } plan { displayName } } }`;

// Returns a live access token, refreshing it when it is about to expire.
async function liveToken(conn) {
  const fresh = conn.expires_at && new Date(conn.expires_at) - Date.now() > 120000;
  if (fresh || !conn.refresh_enc) return decrypt(conn.token_enc);
  if (conn.refresh_expires_at && new Date(conn.refresh_expires_at) < Date.now()) throw new Error("The Shopify connection expired. Ask the founder to connect the store again.");
  const r = await fetch(`https://${conn.shop}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, grant_type: "refresh_token", refresh_token: decrypt(conn.refresh_enc) })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Couldn't refresh the Shopify connection. Ask the founder to connect the store again.");
  const exp = new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000), rexp = j.refresh_token_expires_in ? new Date(Date.now() + Number(j.refresh_token_expires_in) * 1000) : conn.refresh_expires_at;
  // Only overwrite if nobody else refreshed in the meantime (refresh tokens rotate).
  const updated = await sql`UPDATE shopify_connections SET token_enc = ${encrypt(j.access_token)}, refresh_enc = ${j.refresh_token ? encrypt(j.refresh_token) : conn.refresh_enc}, expires_at = ${exp}, refresh_expires_at = ${rexp} WHERE id = ${conn.id} AND token_enc = ${conn.token_enc} RETURNING id`;
  if (!updated.length) { const fresh = (await sql`SELECT token_enc FROM shopify_connections WHERE id = ${conn.id}`)[0]; return fresh ? decrypt(fresh.token_enc) : j.access_token; }
  return j.access_token;
}

// Pulls up to a year of orders (Shopify gives unapproved apps the last 60 days) and summarises them.
export async function syncConnection(conn) {
  const token = await liveToken(conn);
  const since = new Date(Date.now() - 365 * 86400000);
  const shopInfo = (await graphql(conn.shop, token, SHOP)).shop;
  // Development stores only have test orders, so keep them there; on real stores test orders never count.
  const devStore = /development|partner|staff|trial/i.test(shopInfo.plan?.displayName || "");
  const orders = [];
  let cursor = null;
  for (let page = 0; page < 16; page++) {
    const d = await graphql(conn.shop, token, ORDERS, { cursor, q: `created_at:>=${since.toISOString().slice(0, 10)} -status:cancelled` });
    orders.push(...d.orders.nodes.filter((o) => (devStore || !o.test) && !o.cancelledAt && !/VOIDED|REFUNDED$/.test(o.displayFinancialStatus || "")));
    if (!d.orders.pageInfo.hasNextPage) break;
    cursor = d.orders.pageInfo.endCursor;
  }
  const months = {}, customers = {};
  let total = 0, currency = shopInfo.currencyCode, first = null, last = null;
  for (const o of orders) {
    const amt = Number(o.currentSubtotalPriceSet?.shopMoney?.amount || 0);
    const m = o.createdAt.slice(0, 7);
    months[m] = months[m] || { sales: 0, orders: 0 };
    months[m].sales += amt; months[m].orders += 1; total += amt;
    if (o.customer?.id) customers[o.customer.id] = (customers[o.customer.id] || 0) + 1;
    if (!first || o.createdAt < first) first = o.createdAt;
    if (!last || o.createdAt > last) last = o.createdAt;
  }
  const keys = Object.keys(months).sort();
  const series = keys.map((k) => ({ month: k, sales: Math.round(months[k].sales), orders: months[k].orders }));
  const days = first ? Math.max(1, (Date.now() - new Date(first)) / 86400000) : 0;
  const repeatOrders = Object.values(customers).filter((n) => n > 1).reduce((s, n) => s + n, 0);
  const metrics = {
    shop_name: shopInfo.name, domain: shopInfo.primaryDomain?.host, plan: shopInfo.plan?.displayName, shop_created: shopInfo.createdAt, currency, dev_store: devStore,
    orders: orders.length, net_sales: Math.round(total), window_days: Math.round(days), from: first, to: last,
    monthly_avg: days ? Math.round(total / days * 30.4) : 0,
    aov: orders.length ? Math.round(total / orders.length) : 0,
    repeat_rate: orders.length ? +(repeatOrders / orders.length).toFixed(3) : null,
    series
  };
  await sql`UPDATE shopify_connections SET metrics = ${JSON.stringify(metrics)}, last_sync_at = now(), sync_error = NULL WHERE id = ${conn.id}`;
  return metrics;
}
