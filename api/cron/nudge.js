// Daily: reminds founders whose application is missing items. Two reminders at most: after 1 day, then 3 days.
// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
import { sql, send, wrap, sendMail, firstName, magicLink, missingItems, MISSING_LABELS, ADMIN_EMAILS } from "../_lib.js";

export default wrap(async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { error: "Unauthorized" });
  const due = await sql`SELECT * FROM brand_applications WHERE status IN ('new','reviewing') AND completed_at IS NULL
    AND ((nudge_count = 0 AND created_at < now() - interval '24 hours') OR (nudge_count = 1 AND nudged_at < now() - interval '48 hours'))
    ORDER BY created_at LIMIT 100`;
  let sent = 0;
  for (const a of due) {
    if (ADMIN_EMAILS.includes(a.email) || /@example\.(com|org)$/i.test(a.email)) continue; // your own test applications
    const missing = missingItems(a);
    if (!missing.length) { await sql`UPDATE brand_applications SET completed_at = now() WHERE id = ${a.id}`; continue; }
    const link = await magicLink(a.user_id, "/account#finish");
    const r = await sendMail({ to: a.email, subject: a.nudge_count === 0 ? `Your application for ${a.store_url} is saved` : `Still interested? ${a.store_url} is one step from review`,
      text: `Hi ${firstName(a.founder_name)},\n\n` +
        (a.nudge_count === 0 ? `Your application for ${a.store_url} is saved, and Kristi and I can review it as soon as it's finished. Still to add:\n` : `Just checking in. We can't review ${a.store_url} until these are added:\n`) +
        missing.map((m) => "- " + MISSING_LABELS[m]).join("\n") +
        `\n\nIt takes a few minutes. The sales report is one download from Shopify: Analytics, then Reports, then Total sales over time or Total sales breakdown, then Export as CSV.\n\nFinish your application: ${link}\n\n` +
        (a.nudge_count === 0 ? "" : "This is the last reminder we'll send. Your application stays saved.\n\n") + `Bobby and Kristi` });
    // Only count a reminder that actually went out, so a failed send is retried tomorrow.
    if (r.ok) { await sql`UPDATE brand_applications SET nudge_count = nudge_count + 1, nudged_at = now() WHERE id = ${a.id}`; sent++; }
  }
  send(res, 200, { ok: true, due: due.length, sent });
}, "GET");
