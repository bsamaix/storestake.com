import { sql, send, currentUser, wrap, unitEconomics, exampleTerms, missingItems } from "./_lib.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return send(res, 403, { error: "This page is for the StoreStake owner only." });
  const [apps, counts] = await Promise.all([
    sql`SELECT a.*, u.email_verified_at IS NOT NULL AS verified,
          c.shop, c.installed_at, c.last_sync_at, c.sync_error, c.metrics
        FROM brand_applications a JOIN users u ON u.id = a.user_id
        LEFT JOIN shopify_connections c ON c.application_id = a.id
        ORDER BY a.created_at DESC LIMIT 1000`,
    sql`SELECT (SELECT count(*) FROM brand_applications)::int AS applications,
               (SELECT count(*) FROM brand_applications WHERE status IN ('new','reviewing'))::int AS open,
               (SELECT count(*) FROM brand_applications WHERE status = 'offer')::int AS offers,
               (SELECT count(*) FROM brand_applications WHERE status = 'funded')::int AS funded,
               (SELECT coalesce(sum((offer->>'amount')::int),0) FROM brand_applications WHERE status = 'funded')::int AS deployed,
               (SELECT count(*) FROM shopify_connections)::int AS connected,
               (SELECT count(*) FROM users)::int AS accounts`
  ]);
  const files = await sql`SELECT id, application_id, filename, bytes, created_at FROM application_reports ORDER BY id`;
  const byApp = {};
  for (const f of files) (byApp[f.application_id] = byApp[f.application_id] || []).push(f);
  const applications = apps.map((a) => ({ ...a, missing: missingItems(a), report_files: byApp[a.id] || [], econ: unitEconomics(a), profit_known: a.ad_spend != null && a.cogs_pct != null && a.fixed_costs != null, example: exampleTerms(a.ask_amount, a.revenue_exact || 0, a.ad_spend != null && a.cogs_pct != null && a.fixed_costs != null ? unitEconomics(a).profit : 0) }));
  send(res, 200, { applications, counts: counts[0] });
}, "GET");
