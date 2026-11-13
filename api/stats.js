// Admin-only analytics: traffic, sources and the application funnel for the last N days.
import { sql, send, currentUser, wrap } from "./_lib.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return send(res, 403, { error: "This page is for the StoreStake owner only." });
  const q = new URL(req.url, "https://x").searchParams;
  const days = Math.min(365, Math.max(1, parseInt(q.get("days") || "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400000);
  const prev = new Date(since.getTime() - days * 86400000);

  const [totals, before, daily, pages, refs, sources, countries, devices, funnel, apps, appsBySource, recentApps] = await Promise.all([
    sql`SELECT count(*) FILTER (WHERE event IS NULL)::int AS views, count(DISTINCT vid)::int AS visitors,
               count(DISTINCT vid) FILTER (WHERE path = '/' AND event IS NULL)::int AS home_visitors
        FROM hits WHERE ts >= ${since}`,
    sql`SELECT count(*) FILTER (WHERE event IS NULL)::int AS views, count(DISTINCT vid)::int AS visitors
        FROM hits WHERE ts >= ${prev} AND ts < ${since}`,
    sql`SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, count(*) FILTER (WHERE event IS NULL)::int AS views, count(DISTINCT vid)::int AS visitors,
               count(DISTINCT vid) FILTER (WHERE event = 'apply_submit')::int AS applications
        FROM hits WHERE ts >= ${since} GROUP BY 1 ORDER BY 1`,
    sql`SELECT path, count(*)::int AS views, count(DISTINCT vid)::int AS visitors FROM hits WHERE ts >= ${since} AND event IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    sql`SELECT coalesce(ref_host, 'direct / none') AS ref, count(DISTINCT vid)::int AS visitors FROM hits WHERE ts >= ${since} AND event IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    sql`SELECT coalesce(source, '(untagged)') AS source, coalesce(campaign, '') AS campaign, count(DISTINCT vid)::int AS visitors,
               count(DISTINCT vid) FILTER (WHERE event = 'apply_click')::int AS apply_clicks,
               count(DISTINCT vid) FILTER (WHERE event = 'apply_submit')::int AS applications
        FROM hits WHERE ts >= ${since} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
    sql`SELECT coalesce(country, '??') AS country, count(DISTINCT vid)::int AS visitors FROM hits WHERE ts >= ${since} AND event IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    sql`SELECT coalesce(device, 'unknown') AS device, count(DISTINCT vid)::int AS visitors FROM hits WHERE ts >= ${since} AND event IS NULL GROUP BY 1 ORDER BY 2 DESC`,
    sql`SELECT event, count(DISTINCT vid)::int AS visitors FROM hits WHERE ts >= ${since} AND event IS NOT NULL GROUP BY 1`,
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE meets)::int AS qualified,
               count(*) FILTER (WHERE status = 'offer')::int AS offers, count(*) FILTER (WHERE status = 'funded')::int AS funded,
               (SELECT count(*) FROM shopify_connections WHERE installed_at >= ${since})::int AS connected,
               (SELECT count(*) FROM users WHERE created_at >= ${since} AND role <> 'admin')::int AS accounts,
               (SELECT count(*) FROM users WHERE created_at >= ${since} AND role <> 'admin' AND email_verified_at IS NOT NULL)::int AS verified
        FROM brand_applications WHERE created_at >= ${since}`,
    sql`SELECT coalesce(nullif(source, ''), 'direct') AS source, count(*)::int AS applications, count(*) FILTER (WHERE meets)::int AS qualified, round(avg(ask_amount))::int AS avg_ask
        FROM brand_applications WHERE created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    sql`SELECT id, store_url, ask_amount, revenue_exact, status, meets, source, created_at FROM brand_applications ORDER BY created_at DESC LIMIT 8`
  ]);
  const ev = Object.fromEntries(funnel.map((r) => [r.event, r.visitors]));
  send(res, 200, {
    days, since: since.toISOString(),
    totals: totals[0], before: before[0], daily, pages, refs, sources, countries, devices,
    funnel: { visitors: totals[0].visitors, calc_touched: ev.calc_touched || 0, apply_click: ev.apply_click || 0, apply_focus: ev.apply_focus || 0, apply_lead: ev.apply_lead || 0, apply_start: ev.apply_start || 0, apply_step3: ev.apply_step3 || 0, signup: ev.signup || 0, apply_submit: ev.apply_submit || 0, shopify_connect: ev.shopify_connect || 0, finish_open: ev.finish_open || 0, finish_report: ev.finish_report || 0, finish_done: ev.finish_done || 0, video_play: ev.video_play || 0 },
    apps: apps[0], appsBySource, recentApps
  });
}, "GET");
