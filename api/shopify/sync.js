// Re-pulls sales for one connection. Founders can refresh their own; admins any.
import { sql, readBody, send, currentUser, wrap, limited } from "../_lib.js";
import { syncConnection } from "./_shopify.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: "Sign in first." });
  const b = await readBody(req);
  const appId = Math.round(Number(b.app));
  if (await limited(`sync:${user.id}`, 10, 3600)) return send(res, 429, { error: "Sales were refreshed recently. Try again in an hour." });
  const rows = user.role === "admin"
    ? await sql`SELECT * FROM shopify_connections WHERE application_id = ${appId}`
    : await sql`SELECT * FROM shopify_connections WHERE application_id = ${appId} AND user_id = ${user.id}`;
  if (!rows.length) return send(res, 404, { error: "No Shopify connection for that application." });
  try { send(res, 200, { ok: true, metrics: await syncConnection(rows[0]) }); }
  catch (e) {
    await sql`UPDATE shopify_connections SET sync_error = ${String(e.message).slice(0, 300)} WHERE id = ${rows[0].id}`;
    send(res, 502, { error: "Couldn't read sales from Shopify. If you uninstalled StoreStake from your store, connect it again." });
  }
});
