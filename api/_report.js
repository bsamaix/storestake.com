// Reads a Shopify sales CSV export ("Total sales over time" or the newer "Total sales breakdown") and rolls it up to calendar months.
// Shared by the server (authoritative) and the apply page (live preview); build_pages.py inlines it for the browser.
// Accepts daily, weekly or monthly rows, quoted or unquoted cells, "$1,234.56" or "-12.30" numbers.

export const REPORT_MAX_BYTES = 1024 * 1024;   // per file
export const REPORT_MAX_FILES = 2;

function splitCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const KEY = (h) => String(h || "").toLowerCase().replace(/^﻿/, "").replace(/[^a-z]/g, "");
const COLS = {
  period: ["month", "day", "week", "date", "period", "orderdate", "monthofyear"],
  orders: ["orders", "ordercount", "totalorders"],
  gross: ["grosssales"],
  discounts: ["discounts"],
  returns: ["returns", "salesreversals"],
  net: ["netsales"],
  shipping: ["shipping", "shippingcharges"],
  taxes: ["taxes"],
  total: ["totalsales", "sales"],
};
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function toMonth(v) {
  const s = String(v || "").trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/))) return mk(+m[1], +m[2]);                 // 2025-01-01, 2025-01
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return mk(yr(+m[3]), +m[1]);            // 1/31/2025 (US)
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(?:\d{1,2},?\s+)?(\d{4})/))) return MON[m[1].slice(0, 3).toLowerCase()] ? mk(+m[2], MON[m[1].slice(0, 3).toLowerCase()]) : null; // Jan 2025, January 5, 2025
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/))) return MON[m[2].slice(0, 3).toLowerCase()] ? mk(+m[3], MON[m[2].slice(0, 3).toLowerCase()]) : null; // 5 Jan 2025
  return null;
}
const yr = (y) => (y < 100 ? 2000 + y : y);
const mk = (y, mo) => (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 ? `${y}-${String(mo).padStart(2, "0")}` : null);
function num(v) {
  let s = String(v == null ? "" : v).trim();
  if (!s || s === "-" || s === "—") return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[^0-9.]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

// Returns { ok, error?, months: [{month, orders, gross, discounts, returns, net, shipping, taxes, total}], grain, columns }
export function parseShopifySales(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "That file is empty." };
  if (/\u0000/.test(text)) return { ok: false, error: "That isn't a CSV file. Export the report as CSV from Shopify and upload that." };
  const rows = splitCsv(text);
  if (rows.length < 2) return { ok: false, error: "That file has no data rows. Check the date range in Shopify and export again." };
  // The header is the first row that names a date column and net sales.
  let hi = rows.findIndex((r) => r.some((c) => COLS.period.includes(KEY(c))) && r.some((c) => COLS.net.includes(KEY(c)) || COLS.total.includes(KEY(c))));
  if (hi < 0) return { ok: false, error: "This doesn't look like a Shopify sales report. In Shopify, open Analytics, then Reports, then Total sales over time (or Total sales breakdown), and export that." };
  const head = rows[hi].map(KEY), idx = {};
  for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h));
  if (idx.net < 0 && idx.gross < 0) return { ok: false, error: "The file is missing a Net sales column. Export Total sales over time (or Total sales breakdown) from Shopify Analytics, then Reports." };
  const grainKey = head[idx.period];
  const by = {};
  let bad = 0;
  for (const r of rows.slice(hi + 1)) {
    const month = toMonth(r[idx.period]);
    if (!month) { if (/total|summary/i.test(r[idx.period] || "")) continue; bad++; continue; }
    const g = (k) => (idx[k] >= 0 ? num(r[idx[k]]) : 0);
    const rec = { orders: g("orders"), gross: g("gross"), discounts: g("discounts"), returns: g("returns"), net: idx.net >= 0 ? g("net") : g("gross") + g("discounts") + g("returns"), shipping: g("shipping"), taxes: g("taxes"), total: g("total") };
    if (Object.values(rec).some((x) => Number.isNaN(x))) { bad++; continue; }
    const m = (by[month] = by[month] || { month, orders: 0, gross: 0, discounts: 0, returns: 0, net: 0, shipping: 0, taxes: 0, total: 0 });
    for (const k of Object.keys(rec)) m[k] += rec[k];
  }
  const months = Object.values(by).sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v])));
  // Some exports have no order count; keep it unknown rather than zero.
  if (idx.orders < 0) for (const m of months) m.orders = null;
  if (!months.length) return { ok: false, error: "We couldn't read any dates in that file. Export the report as CSV, grouped by month, and upload it without editing." };
  if (bad > Math.max(3, months.length)) return { ok: false, error: "Too many rows in that file couldn't be read. Upload the CSV straight from Shopify without editing it." };
  return { ok: true, months, grain: grainKey === "month" || grainKey === "monthofyear" ? "month" : grainKey === "week" ? "week" : "day", columns: rows[hi] };
}

// Merge months from one or more parsed files; a later file wins for a month present in both.
export function mergeMonths(list) {
  const by = {};
  for (const months of list) for (const m of months) by[m.month] = m;
  return Object.values(by).sort((a, b) => a.month.localeCompare(b.month));
}

const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
function addMonths(m, n) { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return ym(d); }

// The parameters we ask for: the whole of last calendar year plus this year to date, by month.
export function requiredRange(now = new Date()) {
  const y = now.getUTCFullYear();
  return { from: `${y - 1}-01`, through: addMonths(ym(now), -1), current: ym(now), fromLabel: `January 1, ${y - 1}` };
}

// Everything the deal desk shows, computed from the months. The current (partial) month counts toward YTD only.
export function summarize(months, now = new Date()) {
  const R = requiredRange(now), byM = Object.fromEntries(months.map((m) => [m.month, m]));
  const complete = months.filter((m) => m.month <= R.through);
  const last = complete.length ? complete[complete.length - 1].month : null;
  const sum = (list, k) => Math.round(list.reduce((s, m) => s + (m[k] || 0), 0));
  const range = (a, b) => { const out = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; };
  const ttmMonths = last ? range(addMonths(last, -11), last) : [];
  const ttm = ttmMonths.map((m) => byM[m]).filter(Boolean);
  const y = now.getUTCFullYear();
  const ytdThrough = R.through.startsWith(String(y)) ? R.through : null;
  const ytd = ytdThrough ? range(`${y}-01`, ytdThrough).map((m) => byM[m]).filter(Boolean) : [];
  const ytdPrev = ytdThrough ? range(`${y - 1}-01`, `${y - 1}-${ytdThrough.slice(5)}`).map((m) => byM[m]).filter(Boolean) : [];
  const last3 = complete.slice(-3), prev3 = complete.slice(-6, -3);
  const avg = (list) => (list.length ? Math.round(sum(list, "net") / list.length) : 0);
  const best = complete.reduce((b, m) => (!b || m.net > b.net ? m : b), null);
  const gaps = complete.length ? range(complete[0].month, last).filter((m) => !byM[m]) : [];
  const hasOrders = months.some((m) => m.orders != null);
  const ttmGross = sum(ttm, "gross"), ttmOrders = hasOrders ? sum(ttm, "orders") : null;
  const flags = [];
  if (!last) flags.push("No complete months in the report.");
  else if (last < R.through) flags.push(`Report ends ${last}; we asked through ${R.through}.`);
  if (complete.length && complete[0].month > R.from) flags.push(`Starts ${complete[0].month}, after ${R.from}. A newer store, or a shorter date range.`);
  if (gaps.length) flags.push(`No sales in ${gaps.length} month${gaps.length > 1 ? "s" : ""}: ${gaps.join(", ")}.`);
  if (prev3.length === 3 && avg(last3) < avg(prev3) * 0.85) flags.push("Net sales are down more than 15% over the last three months.");
  return {
    months, first: months.length ? months[0].month : null, last, current: byM[R.current] || null,
    months_count: complete.length, ttm_net: sum(ttm, "net"), ttm_months: ttm.length, ttm_orders: ttmOrders,
    aov: ttmOrders ? Math.round(sum(ttm, "net") / ttmOrders) : null,
    discount_rate: ttmGross ? +(-sum(ttm, "discounts") / ttmGross * 100).toFixed(1) : null,
    return_rate: ttmGross ? +(-sum(ttm, "returns") / ttmGross * 100).toFixed(1) : null,
    ytd_net: sum(ytd, "net") + Math.round(byM[R.current] && R.current.startsWith(String(y)) ? byM[R.current].net : 0),
    ytd_through: ytdThrough, ytd_complete_net: sum(ytd, "net"), ytd_prev_net: sum(ytdPrev, "net"),
    yoy_pct: ytdPrev.length && sum(ytdPrev, "net") > 0 ? Math.round((sum(ytd, "net") / sum(ytdPrev, "net") - 1) * 100) : null,
    avg3: avg(last3), avg3_prev: avg(prev3), trend_pct: prev3.length === 3 && avg(prev3) ? Math.round((avg(last3) / avg(prev3) - 1) * 100) : null,
    best: best ? { month: best.month, net: Math.round(best.net) } : null,
    flags, required: R,
  };
}
