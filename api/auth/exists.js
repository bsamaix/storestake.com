// Tells the application form whether an email already has an account, so the founder can sign in before filling three steps.
// Sign-up already reveals this on conflict, so it adds no new information; rate-limited all the same.
import { sql, readBody, send, wrap, clean, isEmail, limited, TOO_MANY, clientIp } from "../_lib.js";

export default wrap(async (req, res) => {
  if (await limited(`exists:${clientIp(req)}`, 10, 600)) return send(res, 429, TOO_MANY);
  const email = clean((await readBody(req)).email, 254).toLowerCase();
  if (!isEmail(email)) return send(res, 200, { exists: false });
  const rows = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  send(res, 200, { exists: rows.length > 0 });
});
