import { sql, readBody, send, wrap, limited, TOO_MANY, clientIp, consumeToken } from "../_lib.js";

export default wrap(async (req, res) => {
  if (await limited(`verify:${clientIp(req)}`, 20, 900)) return send(res, 429, TOO_MANY);
  const b = await readBody(req);
  const userId = await consumeToken(b.token, "verify");
  if (!userId) return send(res, 400, { error: "This link has expired or was already used. Sign in and we'll send a new one." });
  await sql`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${userId}`;
  send(res, 200, { ok: true });
});
