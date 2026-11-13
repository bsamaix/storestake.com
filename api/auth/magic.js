// GET /api/auth/magic?t=...&next=/account#report — one-time sign-in link from a StoreStake email.
import { sql, wrap, limited, TOO_MANY, clientIp, consumeToken, setSession, redirect, send } from "../_lib.js";

export default wrap(async (req, res) => {
  if (await limited(`magic:${clientIp(req)}`, 20, 900)) return send(res, 429, TOO_MANY);
  const q = new URL(req.url, "https://x").searchParams;
  const next = /^\/(account|apply)(#[\w-]+)?$/.test(q.get("next") || "") ? q.get("next") : "/account";
  const userId = await consumeToken(q.get("t"), "login");
  if (!userId) return redirect(res, "/login?expired=1&next=" + encodeURIComponent(next));
  const u = await sql`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${userId} AND role <> 'admin'
    RETURNING id, email, name, role, session_version`;
  if (!u.length) return redirect(res, "/login?next=" + encodeURIComponent(next));
  await setSession(res, u[0]);
  redirect(res, next);
}, "GET");
