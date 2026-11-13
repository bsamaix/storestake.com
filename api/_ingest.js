// Server-side handling of uploaded Shopify reports, shared by the application and the later upload from the account page.
import crypto from "node:crypto";
import { parseShopifySales, mergeMonths, summarize, REPORT_MAX_BYTES, REPORT_MAX_FILES } from "./_report.js";
import { sql, clean, encrypt } from "./_lib.js";

// Returns { error } or { parsed, report, revenue, best }. Anything the browser computed is ignored.
export function ingestReports(files) {
  if (!Array.isArray(files) || !files.length) return { error: "Upload your Shopify sales report (CSV)." };
  if (files.length > REPORT_MAX_FILES) return { error: `Upload at most ${REPORT_MAX_FILES} report files.` };
  const parsed = [], seen = new Set();
  for (const f of files) {
    const name = clean(f && f.name, 120).replace(/[^\w .()-]/g, "_") || "report.csv";
    const text = f && typeof f.text === "string" ? f.text : "";
    if (!/\.csv$/i.test(name)) return { error: `${name} isn't a CSV. Export the report from Shopify as CSV.` };
    if (Buffer.byteLength(text, "utf8") > REPORT_MAX_BYTES) return { error: `${name} is over 1 MB. Export the Total sales report, not an orders export.` };
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    if (seen.has(hash)) continue; // the same file added twice
    seen.add(hash);
    const p = parseShopifySales(text);
    if (!p.ok) return { error: `${name}: ${p.error}` };
    parsed.push({ name, text, months: p.months });
  }
  const report = summarize(mergeMonths(parsed.map((p) => p.months)));
  if (!report.last) return { error: `The report has no complete months yet. Set the date range to start ${report.required.fromLabel} and export again.` };
  const [y, m] = report.required.through.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)), lastOk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (report.last < lastOk) return { error: `That report ends in ${report.last}. Set the end date to today and export again.` };
  const complete = report.months.filter((x) => x.month <= report.required.through);
  const revenue = report.avg3 || Math.round(complete.reduce((s, x) => s + x.net, 0) / Math.max(1, complete.length));
  return { parsed, report, revenue, best: report.best ? report.best.net : null };
}

// Original files, encrypted at rest with their own key; only the owner's admin account can download them. A new upload replaces the old.
export async function storeReportFiles(applicationId, parsed) {
  await sql`DELETE FROM application_reports WHERE application_id = ${applicationId}`;
  for (const p of parsed) {
    await sql`INSERT INTO application_reports (application_id, filename, bytes, sha256, data_enc)
      VALUES (${applicationId}, ${p.name}, ${Buffer.byteLength(p.text, "utf8")}, ${crypto.createHash("sha256").update(p.text).digest("hex")}, ${encrypt(p.text, "reports")})`;
  }
}
