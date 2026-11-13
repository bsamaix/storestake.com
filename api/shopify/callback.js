// Shopify sends the merchant back here after they approve read-only access.
import { sql, redirect, currentUser, wrap, verifyShort, signShort, encrypt, notifyAdmins, SITE, money } from "../_lib.js";
import { configured, validShop, verifyQueryHmac, syncConnection } from "./_shopify.js";

export default wrap(async (req, res) => {
  const fail = (why) => redirect(res, "/account?shopify=" + encodeURIComponent(why));
  if (!configured()) return fail("not-configured");
  const q = Object.fromEntries(new URL(req.url, "https://x").searchParams);
  const shop = String(q.shop || "").toLowerCase();
  if (!validShop(shop) || !verifyQueryHmac(q)) return fail("bad-signature");
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)__Host-ss_shopify=([^;]+)/);
  const state = m ? await verifyShort(m[1], "state") : null;
  res.setHeader("Set-Cookie", "__Host-ss_shopify=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  if (!state || state.shop !== shop || m[1] !== q.state) return fail("expired");
  const user = state.uid ? await currentUser(req) : null;
  if (state.uid && (!user || user.id !== state.uid)) return fail("signed-out");

  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, code: q.code, expiring: 1 })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return fail("token");

  // Shopify now issues expiring offline tokens (about an hour) with a ~90-day refresh token; _shopify.js refreshes before each sync.
  const exp = new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000), rexp = j.refresh_token_expires_in ? new Date(Date.now() + Number(j.refresh_token_expires_in) * 1000) : null;
  // Install started from Shopify (no StoreStake account yet): park the token, prove possession with a cookie, continue on the account page.
  if (!state.uid) {
    await sql`INSERT INTO shopify_pending (shop, token_enc, refresh_enc, expires_at, refresh_expires_at, scopes)
      VALUES (${shop}, ${encrypt(j.access_token)}, ${j.refresh_token ? encrypt(j.refresh_token) : null}, ${exp}, ${rexp}, ${j.scope || ""})
      ON CONFLICT (shop) DO UPDATE SET token_enc = EXCLUDED.token_enc, refresh_enc = EXCLUDED.refresh_enc, expires_at = EXCLUDED.expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at, scopes = EXCLUDED.scopes, created_at = now()`;
    const claim = await signShort({ shop }, 60 * 24 * 7, "claim");
    res.setHeader("Set-Cookie", [`__Host-ss_shopify=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, `__Host-ss_pending=${claim}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`]);
    return redirect(res, "/account?shop=" + encodeURIComponent(shop));
  }
  const rows = await sql`INSERT INTO shopify_connections (application_id, user_id, shop, token_enc, refresh_enc, expires_at, refresh_expires_at, scopes)
    VALUES (${state.app}, ${user.id}, ${shop}, ${encrypt(j.access_token)}, ${j.refresh_token ? encrypt(j.refresh_token) : null}, ${exp}, ${rexp}, ${j.scope || ""})
    ON CONFLICT (application_id) DO UPDATE SET shop = EXCLUDED.shop, token_enc = EXCLUDED.token_enc, refresh_enc = EXCLUDED.refresh_enc, expires_at = EXCLUDED.expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at, scopes = EXCLUDED.scopes, installed_at = now(), sync_error = NULL
    RETURNING *`;
  // app/uninstalled and the compliance webhooks are declared in shopify/shopify.app.toml, so nothing to register here.
  let metrics = null;
  try { metrics = await syncConnection(rows[0]); }
  catch (e) { await sql`UPDATE shopify_connections SET sync_error = ${String(e.message).slice(0, 300)} WHERE id = ${rows[0].id}`; }
  const app = (await sql`SELECT store_url FROM brand_applications WHERE id = ${state.app}`)[0];
  await notifyAdmins(`Shopify connected: ${app?.store_url || shop}`,
    `${user.name} <${user.email}> connected ${shop}.\n` + (metrics ? `Net sales ${money(metrics.net_sales)} over ${metrics.window_days} days (${money(metrics.monthly_avg)}/mo), ${metrics.orders} orders, AOV ${money(metrics.aov)}.` : "The first sync failed; open admin to retry.") + `\n\n${SITE}/admin#app-${state.app}`, user.email).catch(() => {});
  redirect(res, "/account?shopify=connected");
}, "GET");
