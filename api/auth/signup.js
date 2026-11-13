import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { sql, readBody, send, setSession, isEmail, clean, wrap, limited, TOO_MANY, clientIp, sendVerification, publicUser, createToken, sendMail, firstName, SITE } from "../_lib.js";

export default wrap(async (req, res) => {
  if (await limited(`signup:${clientIp(req)}`, 5, 600)) return send(res, 429, TOO_MANY);
  const b = await readBody(req);
  const email = clean(b.email, 254).toLowerCase();
  const name = clean(b.name, 80);
  // The application creates accounts without a password; the founder sets one from the emailed link.
  const passwordless = b.passwordless === true;
  const password = passwordless ? randomBytes(32).toString("hex") : (typeof b.password === "string" ? b.password : "");
  if (!name) return send(res, 400, { error: "Enter your name." });
  if (!isEmail(email)) return send(res, 400, { error: "Enter a valid email address." });
  if (password.length < 10) return send(res, 400, { error: "Use a password with at least 10 characters." });
  if (password.length > 200) return send(res, 400, { error: "That password is too long." });
  if (b.agree !== true) return send(res, 400, { error: "Agree to the Terms and Privacy Policy to create an account." });
  const hash = await bcrypt.hash(password, 12);
  const role = "brand"; // admin is never granted here
  const rows = await sql`INSERT INTO users (email, name, password_hash, role, source)
    VALUES (${email}, ${name}, ${hash}, ${role}, ${clean(b.source, 200) || null})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, name, role, session_version`;
  if (!rows.length) return send(res, 409, { error: "An account with this email already exists. Sign in instead." });
  const u = rows[0];
  await setSession(res, u);
  if (passwordless && b.quiet === true) { /* the application endpoint sends the one email this founder needs */ }
  else if (passwordless) {
    const t = await createToken(u.id, "reset", 60 * 24 * 7);
    await sendMail({ to: u.email, subject: "Confirm your email and set a password for StoreStake",
      text: `Hi ${firstName(u.name)},\n\nThanks for applying. This link confirms your email and lets you set a password, so you can see your offer and connect Shopify from any device:\n\n${SITE}/reset?t=${t}\n\nThe link works once and expires in 7 days. If you didn't apply on StoreStake, you can ignore this email.\n\nBobby and Kristi` });
  } else await sendVerification(u);
  send(res, 200, { user: publicUser({ ...u, email_verified: false }) });
});
