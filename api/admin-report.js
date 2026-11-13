// Owner-only download of an uploaded Shopify report. GET /api/admin-report?id=<file id>
import { sql, currentUser, decrypt, wrap, send } from "./_lib.js";

// Cells that a spreadsheet would treat as a formula are prefixed with a quote, so opening the file can't run anything.
// A leading minus followed by a digit is a negative number and is left alone.
const safe = (text) => text.replace(/(^|,|\n)(\s*"?)([=+@\t\r]|-(?![\d.]))/g, "$1$2'$3");

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return send(res, 403, { error: "This file is for the StoreStake owner only." });
  const id = Number(new URL(req.url, "https://x").searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: "Missing file id." });
  const rows = await sql`SELECT filename, data_enc FROM application_reports WHERE id = ${id}`;
  if (!rows.length) return send(res, 404, { error: "File not found." });
  const name = rows[0].filename.replace(/[^\w .()-]/g, "_");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(safe(decrypt(rows[0].data_enc, "reports")));
}, "GET");
