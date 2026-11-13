// The short application: store, amount, name and consent are required. Everything else can follow from the account page.
import { ingestReports, storeReportFiles } from "./_ingest.js";
import { sql, readBody, send, currentUser, clean, cleanText, wrap, sendMail, notifyAdmins, SITE, limited, firstName, money, magicLink,
  ASK_MIN, ASK_MAX, HELP, unitEconomics, exampleTerms, missingItems, meetsBar, MISSING_LABELS } from "./_lib.js";

const num = (v, max) => { if (v === "" || v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : NaN; };

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: "Create an account or sign in first." });
  const b = await readBody(req);
  const store = clean(b.store, 200).replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  const ask = num(b.ask, 10000000);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(\/[\w\-./]*)?$/i.test(store)) return send(res, 400, { error: "Enter your store's web address, like yourbrand.com." });
  if (!(ask >= ASK_MIN && ask <= ASK_MAX)) return send(res, 400, { error: `Ask for between ${money(ASK_MIN)} and ${money(ASK_MAX)}.` });
  if (b.owner !== true) return send(res, 400, { error: "Confirm that you own the store and agree to the Terms." });

  // Optional now, finishable later.
  const months = num(b.months, 600), ads = num(b.ads, 5000000), fixed = num(b.fixed, 5000000), typed = num(b.revenue, 5000000), typedBest = num(b.best, 10000000);
  const cogs = b.cogs === "" || b.cogs == null ? null : Number(b.cogs);
  if ([months, ads, fixed, typed, typedBest].some(Number.isNaN)) return send(res, 400, { error: "One of the numbers isn't valid. Use whole dollars, or leave it blank." });
  if (cogs != null && !(cogs >= 0 && cogs <= 95)) return send(res, 400, { error: "Product and shipping cost should be between 0 and 95 percent of sales, or blank." });
  const use = cleanText(b.use, 1000), stuck = cleanText(b.stuck, 1000), category = clean(b.category, 40);
  const help = Array.isArray(b.help) ? b.help.filter((h) => HELP.includes(h)).slice(0, HELP.length) : [];

  let ing = null;
  if (Array.isArray(b.reports) && b.reports.length) { ing = ingestReports(b.reports); if (ing.error) return send(res, 400, { error: ing.error }); }
  const revenue = ing ? ing.revenue : typed, best = ing ? ing.best : typedBest;

  if (await limited(`apply:${user.id}`, 3, 86400)) return send(res, 429, { error: "You've sent several applications today. Check your account for the ones you've sent, or try again tomorrow." });
  const draft = { report_status: ing ? "received" : "pending", months_selling: months, ad_spend: ads, cogs_pct: cogs, fixed_costs: fixed, use_of_funds: use, revenue_exact: revenue, ask_amount: ask };
  const missing = missingItems(draft), meets = meetsBar(draft);
  const rows = await sql`INSERT INTO brand_applications
    (user_id, email, founder_name, store_url, category, months_selling, revenue_exact, stated_revenue, best_month, ad_spend, cogs_pct, fixed_costs, ask_amount, use_of_funds, stuck, help, sole_owner, wants_advisor, meets, source, status_at, report, report_status, completed_at)
    VALUES (${user.id}, ${user.email}, ${user.name}, ${store}, ${category || null}, ${months}, ${revenue}, ${typed}, ${best}, ${ads}, ${cogs}, ${fixed}, ${ask}, ${use || null}, ${stuck || null}, ${JSON.stringify(help)}, true,
      ${help.length > 0 && !(help.length === 1 && help[0] === "Just the money")}, ${meets}, ${clean(b.source, 200) || null}, now(), ${ing ? JSON.stringify(ing.report) : null}, ${draft.report_status}, ${missing.length ? null : new Date().toISOString()})
    RETURNING id`;
  const id = rows[0].id;
  if (ing) await storeReportFiles(id, ing.parsed);

  const r = ing && ing.report, econ = unitEconomics(draft);
  const link = await magicLink(user.id, missing.length ? "/account#finish" : "/account");
  const jobs = [notifyAdmins(`New application: ${store} asking ${money(ask)}${missing.length ? ` (still to add: ${missing.map((m) => MISSING_LABELS[m].toLowerCase()).join(", ")})` : ""}`,
    `${user.name} <${user.email}>\nStore: https://${store}\nAsk: ${money(ask)}\n` +
    (r ? `\nShopify report: ${money(r.ttm_net)} last 12 months · ${money(revenue)}/mo last 3 months · YTD ${r.yoy_pct == null ? "n/a" : (r.yoy_pct > 0 ? "+" : "") + r.yoy_pct + "% vs last year"}${r.flags.length ? "\nFlags: " + r.flags.join(" ") : ""}\n` : typed != null ? `\nSays sales are about ${money(typed)}/mo (no report yet)\n` : "\nNo sales numbers yet\n") +
    (ads != null && cogs != null && fixed != null ? `Ads ${money(ads)}/mo · Landed cost ${cogs}% · Other ${money(fixed)}/mo · Left over ${money(econ.profit)}/mo\n` : "") +
    (use ? `\nFor: ${use}\n` : "") + (stuck ? `Stuck on: ${stuck}\n` : "") + (help.length ? `Wants help with: ${help.join(", ")}\n` : "") +
    (missing.length ? `\nStill to add: ${missing.map((m) => MISSING_LABELS[m]).join(", ")}. They'll get reminders after 1 and 3 days.\n` : "") +
    `Source: ${clean(b.source, 200) || "direct"}\n\nReview: ${SITE}/admin#app-${id}`, user.email)];
  // One email to the founder, with a one-click sign-in link (most founders here never set a password).
  jobs.push(sendMail({ to: user.email,
    subject: missing.length ? `One more step for ${store}` : `Got it: your application for ${store}`,
    text: `Hi ${firstName(user.name)},\n\nThanks for applying. Kristi and I read every application ourselves.\n\n` +
      (missing.length
        ? `Your application is saved. To finish it, add:\n${missing.map((m) => "- " + MISSING_LABELS[m]).join("\n")}\n\nIt takes a few minutes, and the sales report is one download from Shopify (Analytics, then Reports, then Total sales over time or Total sales breakdown, then Export as CSV).\n\nFinish your application: ${link}\n\n`
        : `We have everything we need, including your Shopify sales report. We'll reply within a few business days with an offer, a question, or a straight no.\n\nYour application: ${link}\n\n`) +
      `The link signs you in and works once for 7 days. If you didn't apply on StoreStake, you can ignore this email.\n\nBobby and Kristi` }));
  await Promise.all(jobs);
  send(res, 200, { ok: true, id, meets, missing, emailVerified: !!user.email_verified });
});
