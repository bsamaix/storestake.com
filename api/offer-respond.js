// The founder accepts or declines Bobby's offer from their account page.
import { sql, readBody, send, currentUser, wrap, notifyAdmins, SITE, money } from "./_lib.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: "Sign in first." });
  const b = await readBody(req);
  const id = Math.round(Number(b.id));
  const answer = b.answer === "accept" ? "accepted" : b.answer === "decline" ? "withdrawn" : null;
  if (!id || !answer) return send(res, 400, { error: "Choose accept or decline." });
  const rows = await sql`UPDATE brand_applications SET status = ${answer}, status_at = now()
    WHERE id = ${id} AND user_id = ${user.id} AND status = 'offer' RETURNING store_url, offer`;
  if (!rows.length) return send(res, 404, { error: "There's no open offer on that application." });
  const a = rows[0], o = a.offer || {};
  await notifyAdmins(`${answer === "accepted" ? "ACCEPTED" : "Declined"}: ${a.store_url} (${money(o.amount)} for ${o.stake}% at ${money(o.valuation)})`,
    `${user.name} <${user.email}> ${answer === "accepted" ? "accepted your offer. Send the agreement." : "declined your offer."}\n\n${SITE}/admin#app-${id}`, user.email);
  send(res, 200, { ok: true, status: answer });
});
