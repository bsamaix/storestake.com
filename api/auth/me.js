import { sql, send, currentUser, wrap, publicUser, unitEconomics, verifyShort, missingItems } from "../_lib.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 200, { user: null });
  const apps = await sql`SELECT a.id, a.store_url, a.ask_amount, a.revenue_exact, a.ad_spend, a.cogs_pct, a.fixed_costs, a.months_selling, a.category, a.use_of_funds, a.stuck, a.report_status, a.completed_at, a.status, a.meets, a.offer, a.created_at, a.status_at, (a.report->>'ttm_net')::int AS report_ttm, (a.report->>'months_count')::int AS report_months,
      c.shop, c.last_sync_at, c.sync_error, c.metrics
    FROM brand_applications a LEFT JOIN shopify_connections c ON c.application_id = a.id
    WHERE a.user_id = ${user.id} ORDER BY a.created_at DESC`;
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)__Host-ss_pending=([^;]+)/);
  const claim = m ? await verifyShort(m[1], "claim") : null;
  let pending = null;
  if (claim && (await sql`SELECT 1 FROM shopify_pending WHERE shop = ${claim.shop}`).length) pending = claim.shop;
  send(res, 200, { user: { ...publicUser(user), pending_shop: pending, applications: apps.map((a) => ({ ...a, econ: unitEconomics(a), missing: missingItems(a) })) } });
}, "GET");
