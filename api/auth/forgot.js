import { sql, readBody, send, isEmail, clean, wrap, limited, TOO_MANY, clientIp, createToken, sendMail, firstName, SITE } from "../_lib.js";

export default wrap(async (req, res) => {
  const b = await readBody(req);
  const email = clean(b.email, 254).toLowerCase();
  if (!isEmail(email)) return send(res, 400, { error: "Enter the email address on your account." });
  if (await limited(`forgot-ip:${clientIp(req)}`, 5, 900) || await limited(`forgot-email:${email}`, 3, 900)) {
    return send(res, 429, TOO_MANY);
  }
  const rows = await sql`SELECT id, name FROM users WHERE email = ${email}`;
  if (rows.length) {
    const t = await createToken(rows[0].id, "reset", 60);
    const r = await sendMail({ to: email, subject: "Reset your StoreStake password",
      text: `Hi ${firstName(rows[0].name)},\n\nUse this link to set a new password. It works once and expires in 1 hour:\n\n${SITE}/reset?t=${t}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.` });
    if (!r.ok) console.error("reset email failed for user", rows[0].id); // same response either way, so existence can't be probed
  }
  // Same answer whether or not the account exists, so emails can't be probed.
  send(res, 200, { ok: true });
});
