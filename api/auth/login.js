import bcrypt from "bcryptjs";
import { sql, readBody, send, setSession, clean, wrap, limited, TOO_MANY, clientIp, publicUser, notifyAdmins } from "../_lib.js";

// Compared against when the email doesn't exist, so response time doesn't reveal which accounts exist.
const DUMMY_HASH = "$2a$12$ziVivBho7p9oziNujtcymOH8nBv0ui2.NErGfS0t29aBfBQBohGQq";

export default wrap(async (req, res) => {
  const b = await readBody(req);
  const email = clean(b.email, 254).toLowerCase();
  const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
  const ip = clientIp(req);
  // Tight limit per ip+email; the email-only counter only counts failures (below), so junk requests can't lock a real user out.
  if (await limited(`login-ip:${ip}`, 60, 600) || await limited(`login-ipemail:${ip}:${email}`, 10, 600)) return send(res, 429, TOO_MANY);
  const failRows = await sql`SELECT coalesce(sum(hits),0)::int AS n FROM rate_limits WHERE key = ${"login-fail:" + email} AND window_start > now() - interval '1 hour'`;
  if (failRows[0].n >= 30) return send(res, 429, TOO_MANY);
  const rows = await sql`SELECT id, email, name, role, password_hash, session_version,
      (email_verified_at IS NOT NULL) AS email_verified FROM users WHERE email = ${email}`;
  const u = rows[0];
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) { await limited(`login-fail:${email}`, 1e9, 3600); return send(res, 401, { error: "That email and password don't match. Check them and try again." }); }
  await setSession(res, u);
  if (u.role === "admin") await notifyAdmins("Deal desk sign-in", `Your StoreStake admin account just signed in from ${ip}. If that wasn't you, reset your password now: https://storestake.com/forgot`);
  send(res, 200, { user: publicUser(u) });
});
