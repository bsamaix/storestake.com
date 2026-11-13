// Attaches a Shopify-initiated install (parked in shopify_pending) to one of the founder's applications.
import { sql, readBody, send, currentUser, wrap, verifyShort, notifyAdmins, SITE, money } from "../_lib.js";
import { syncConnection } from "./_shopify.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: "Sign in first." });
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)__Host-ss_pending=([^;]+)/);
  const claim = m ? await verifyShort(m[1], "claim") : null;
  if (!claim) return send(res, 400, { error: "This connection has expired. Start again from your Shopify admin or connect from this page." });
  const b = await readBody(req);
  const appId = Math.round(Number(b.app));
  const own = await sql`SELECT id, store_url FROM brand_applications WHERE id = ${appId} AND user_id = ${user.id}`;
  if (!own.length) return send(res, 404, { error: "That application isn't on your account." });
  const p = (await sql`DELETE FROM shopify_pending WHERE shop = ${claim.shop} RETURNING *`)[0];
  if (!p) return send(res, 410, { error: "That store's connection was already used or removed. Connect again from this page." });
  const rows = await sql`INSERT INTO shopify_connections (application_id, user_id, shop, token_enc, refresh_enc, expires_at, refresh_expires_at, scopes)
    VALUES (${appId}, ${user.id}, ${p.shop}, ${p.token_enc}, ${p.refresh_enc}, ${p.expires_at}, ${p.refresh_expires_at}, ${p.scopes})
    ON CONFLICT (application_id) DO UPDATE SET shop = EXCLUDED.shop, token_enc = EXCLUDED.token_enc, refresh_enc = EXCLUDED.refresh_enc, expires_at = EXCLUDED.expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at, scopes = EXCLUDED.scopes, installed_at = now(), sync_error = NULL
    RETURNING *`;
  res.setHeader("Set-Cookie", "__Host-ss_pending=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  let metrics = null;
  try { metrics = await syncConnection(rows[0]); }
  catch (e) { await sql`UPDATE shopify_connections SET sync_error = ${String(e.message).slice(0, 300)} WHERE id = ${rows[0].id}`; }
  await notifyAdmins(`Shopify connected: ${own[0].store_url}`, `${user.name} <${user.email}> connected ${p.shop}.\n` + (metrics ? `Net sales ${money(metrics.net_sales)} over ${metrics.window_days} days (${money(metrics.monthly_avg)}/mo), ${metrics.orders} orders.` : "First sync failed; retry from admin.") + `\n\n${SITE}/admin#app-${appId}`, user.email).catch(() => {});
  send(res, 200, { ok: true, metrics });
});
