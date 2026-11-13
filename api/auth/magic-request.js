// "Email me a sign-in link": founders who applied with the short form never set a password.
import { sql, readBody, send, isEmail, clean, wrap, limited, TOO_MANY, clientIp, sendMail, firstName, magicLink } from "../_lib.js";

export default wrap(async (req, res) => {
  const b = await readBody(req);
  const email = clean(b.email, 254).toLowerCase();
  if (!isEmail(email)) return send(res, 400, { error: "Enter the email you applied with." });
  if (await limited(`magicreq-ip:${clientIp(req)}`, 5, 900) || await limited(`magicreq-email:${email}`, 3, 900)) return send(res, 429, TOO_MANY);
  const rows = await sql`SELECT id, name, role FROM users WHERE email = ${email}`;
  if (rows.length && rows[0].role !== "admin") {
    const next = /^\/(account|apply)(#[a-z-]+)?$/.test(String(b.next || "")) ? b.next : "/account";
    const link = await magicLink(rows[0].id, next, 1);
    const r = await sendMail({ to: email, subject: "Your StoreStake sign-in link",
      text: `Hi ${firstName(rows[0].name)},\n\nHere's your link to sign in to StoreStake:\n\n${link}\n\nIt works once and expires in 24 hours. If you didn't ask for this, you can ignore this email.\n\nBobby and Kristi` });
    if (!r.ok) console.error("sign-in link email failed for user", rows[0].id);
  }
  // Same answer whether or not the account exists, so emails can't be probed.
  send(res, 200, { ok: true });
});
