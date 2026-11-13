import bcrypt from "bcryptjs";
import { sql, readBody, send, setSession, wrap, limited, TOO_MANY, clientIp, consumeToken, publicUser } from "../_lib.js";

export default wrap(async (req, res) => {
  if (await limited(`reset:${clientIp(req)}`, 10, 900)) return send(res, 429, TOO_MANY);
  const b = await readBody(req);
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < 10) return send(res, 400, { error: "Use a password with at least 10 characters." });
  if (password.length > 200) return send(res, 400, { error: "That password is too long." });
  const userId = await consumeToken(b.token, "reset");
  if (!userId) return send(res, 400, { error: "This reset link has expired or was already used. Request a new one." });
  const pw = await bcrypt.hash(password, 12);
  // Bumping session_version signs out every other device. Following the emailed link also proves the inbox.
  const u = await sql`UPDATE users SET password_hash = ${pw}, session_version = session_version + 1,
      email_verified_at = COALESCE(email_verified_at, now())
    WHERE id = ${userId} RETURNING id, email, name, role, session_version, true AS email_verified`;
  await setSession(res, u[0]);
  send(res, 200, { user: publicUser(u[0]) });
});
