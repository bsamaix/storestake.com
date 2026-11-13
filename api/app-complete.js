// The founder finishes an application from their account page: report upload, store basics, or what the money does.
import { ingestReports, storeReportFiles } from "./_ingest.js";
import { sql, readBody, send, currentUser, clean, cleanText, wrap, notifyAdmins, SITE, money, limited, missingItems, meetsBar, MISSING_LABELS } from "./_lib.js";

const num = (v, max) => { if (v === "" || v == null) return undefined; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : NaN; };

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: "Sign in to finish your application." });
  if (await limited(`complete:${user.id}`, 40, 3600)) return send(res, 429, { error: "Too many saves in a short time. Wait a few minutes and try again." });
  const b = await readBody(req);
  const rows = await sql`SELECT * FROM brand_applications WHERE id = ${Number(b.id) || 0} AND user_id = ${user.id}`;
  const a = rows[0];
  if (!a) return send(res, 404, { error: "We couldn't find that application on your account." });
  if (["passed", "withdrawn", "funded"].includes(a.status)) return send(res, 400, { error: "This application is closed." });
  const before = missingItems(a), up = {};

  if (b.part === "report") {
    const ing = ingestReports(b.reports);
    if (ing.error) return send(res, 400, { error: ing.error });
    await storeReportFiles(a.id, ing.parsed);
    Object.assign(up, { report: ing.report, report_status: "received", revenue_exact: ing.revenue, best_month: ing.best });
  } else if (b.part === "basics") {
    const months = num(b.months, 600), ads = num(b.ads, 5000000), fixed = num(b.fixed, 5000000), cogs = b.cogs === "" || b.cogs == null ? undefined : Number(b.cogs);
    const monthsKnown = a.months_selling != null || (a.report && a.report.months_count > 0);
    if ([ads, fixed].some((x) => x === undefined || Number.isNaN(x)) || cogs === undefined || Number.isNaN(months) || (months === undefined && !monthsKnown)) return send(res, 400, { error: "Fill in ad spend, product cost and other costs. Zero is fine." });
    if (!(cogs >= 0 && cogs <= 95)) return send(res, 400, { error: "Product and shipping cost should be between 0 and 95 percent of sales." });
    Object.assign(up, { months_selling: months === undefined ? a.months_selling : months, ad_spend: ads, cogs_pct: cogs, fixed_costs: fixed, category: clean(b.category, 40) || a.category });
  } else if (b.part === "story") {
    const use = cleanText(b.use, 1000), stuck = cleanText(b.stuck, 1000);
    if (use.length < 10) return send(res, 400, { error: "Say what the money does, in a sentence or two." });
    Object.assign(up, { use_of_funds: use, stuck: stuck || a.stuck });
  } else return send(res, 400, { error: "Nothing to save." });

  const next = { ...a, ...up }, missing = missingItems(next), meets = meetsBar(next);
  const done = !missing.length && before.length > 0;
  await sql`UPDATE brand_applications SET
      report = ${up.report !== undefined ? JSON.stringify(up.report) : a.report == null ? null : JSON.stringify(a.report)}, report_status = ${next.report_status},
      revenue_exact = ${next.revenue_exact}, best_month = ${next.best_month}, months_selling = ${next.months_selling}, ad_spend = ${next.ad_spend},
      cogs_pct = ${next.cogs_pct}, fixed_costs = ${next.fixed_costs}, category = ${next.category}, use_of_funds = ${next.use_of_funds}, stuck = ${next.stuck},
      meets = ${meets}, completed_at = ${done ? new Date().toISOString() : a.completed_at}
    WHERE id = ${a.id}`;
  if (done) await notifyAdmins(`Application complete: ${a.store_url} asking ${money(a.ask_amount)}`,
    `${a.founder_name} finished their application.${next.report ? `\nShopify report: ${money(next.report.ttm_net)} last 12 months · ${money(next.revenue_exact)}/mo last 3 months` : ""}\n\nReview: ${SITE}/admin#app-${a.id}`, a.email);
  else if (b.part === "report") await notifyAdmins(`Sales report uploaded: ${a.store_url}`, `${a.founder_name} uploaded their Shopify report.${missing.length ? `\nStill to add: ${missing.map((m) => MISSING_LABELS[m]).join(", ")}.` : ""}\n\n${SITE}/admin#app-${a.id}`, a.email);
  send(res, 200, { ok: true, missing, complete: !missing.length, report: up.report ? { ttm_net: up.report.ttm_net, months_count: up.report.months_count, avg3: up.report.avg3 } : undefined });
});
