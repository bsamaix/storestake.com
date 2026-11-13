// Saves an equity offer on an application and, optionally, emails it to the founder.
import { sql, readBody, send, currentUser, wrap, clean, cleanText, sendMail, SITE, firstName, money, INVESTOR, DIST_PCT, unitEconomics } from "./_lib.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return send(res, 403, { error: "Admins only." });
  const b = await readBody(req);
  const id = Math.round(Number(b.id));
  const amount = Math.round(Number(b.amount)), stake = Number(b.stake), valuation = Math.round(Number(b.valuation));
  const dist = b.dist === "" || b.dist == null ? DIST_PCT : Number(b.dist);
  const message = cleanText(b.message, 3000);
  if (!id) return send(res, 400, { error: "Pick an application." });
  if (!(amount >= 500 && amount <= 250000)) return send(res, 400, { error: "Enter the check amount." });
  if (!(stake > 0 && stake <= 49)) return send(res, 400, { error: "Enter the stake as a percentage, under 50." });
  if (!(valuation > amount)) return send(res, 400, { error: "Enter the valuation; it has to be more than the check." });
  if (!(dist >= 0 && dist <= 100)) return send(res, 400, { error: "Enter the share of profit paid out each quarter, 0 to 100." });
  const offer = { amount, stake, valuation, dist, message, sent_at: b.notify === true ? new Date().toISOString() : null, by: user.email };
  const rows = await sql`UPDATE brand_applications SET offer = ${JSON.stringify(offer)}, status = 'offer', status_at = now() WHERE id = ${id} AND status NOT IN ('funded', 'accepted')
    RETURNING id, email, founder_name, store_url, revenue_exact, cogs_pct, ad_spend, fixed_costs`;
  if (!rows.length) return send(res, 409, { error: "That application is already accepted or funded; close it first if you really want to re-offer." });
  const a = rows[0];
  let emailed = null;
  if (b.notify === true) {
    const q = Math.round(Math.max(0, unitEconomics(a).profit) * 3 * dist / 100 * stake / 100);
    emailed = (await sendMail({ to: a.email, subject: `An offer for ${a.store_url}`,
      text: `Hi ${firstName(a.founder_name)},\n\nKristi and I would like to buy into ${a.store_url}. Here's the offer:\n\n` +
        `We put in: ${money(amount)}\nFor: a ${stake}% stake, which values the store at ${money(valuation)}\nYou keep: ${+(100 - stake).toFixed(1)}% and full control\nEach quarter: the store pays ${dist}% of its profit out to owners, in proportion to ownership; the rest stays in the business\n` +
        `At your current numbers that's about ${money(q)} a quarter to us, and ${money(Math.round(q * (100 - stake) / stake))} to you.\n\n` +
        (message ? message + "\n\n" : "") +
        `If you're in, say so on your account page and we'll send the agreement from ${INVESTOR.company} for all of us to sign. Nothing is final until it's signed.\n\n${SITE}/account\n\nBobby and Kristi` })).ok;
  }
  send(res, 200, { ok: true, offer, emailed });
});
