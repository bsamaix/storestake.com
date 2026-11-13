import { sql, readBody, send, currentUser, wrap, cleanText, APP_STATUSES, sendMail, SITE, firstName } from "./_lib.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return send(res, 403, { error: "Admins only." });
  const b = await readBody(req);
  const id = Math.round(Number(b.id));
  if (!id) return send(res, 400, { error: "Pick an application." });
  const status = APP_STATUSES.includes(b.status) ? b.status : null;
  const note = typeof b.note === "string" ? cleanText(b.note, 4000) : null;
  if (!status && note === null) return send(res, 400, { error: "Nothing to save." });
  if (status === "offer") { const o = await sql`SELECT offer FROM brand_applications WHERE id = ${id}`; if (!o.length || !o[0].offer) return send(res, 400, { error: "Save an offer first; then the status becomes Offer on its own." }); }
  const rows = status
    ? await sql`UPDATE brand_applications SET status = ${status}, status_at = now(), admin_note = COALESCE(${note}, admin_note) WHERE id = ${id} RETURNING id, email, founder_name, store_url, status, admin_note`
    : await sql`UPDATE brand_applications SET admin_note = ${note} WHERE id = ${id} RETURNING id, email, founder_name, store_url, status, admin_note`;
  if (!rows.length) return send(res, 404, { error: "That application no longer exists." });
  const a = rows[0];
  let emailed = null;
  if (b.notify === true && status === "passed") {
    emailed = (await sendMail({ to: a.email, subject: `About ${a.store_url}`,
      text: `Hi ${firstName(a.founder_name)},\n\nThanks for sending ${a.store_url} our way. We're going to pass for now. That's usually about timing, margins, or the size of the ask compared with sales, not about you.\n\nIf the store grows, apply again: ${SITE}/apply\n\nBobby and Kristi` })).ok;
  }
  if (b.notify === true && status === "reviewing") {
    emailed = (await sendMail({ to: a.email, subject: `We're looking at ${a.store_url}`,
      text: `Hi ${firstName(a.founder_name)},\n\nWe're reviewing ${a.store_url} now, along with the sales report you sent. If we need anything else, we'll ask.\n\nWe'll be back to you within a few days.\n\nBobby and Kristi` })).ok;
  }
  send(res, 200, { ok: true, status: a.status, admin_note: a.admin_note, emailed });
});
