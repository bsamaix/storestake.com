import { send, currentUser, wrap, limited, TOO_MANY, sendVerification } from "../_lib.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: "Sign in first." });
  if (user.email_verified) return send(res, 200, { ok: true, already: true });
  if (await limited(`reverify:${user.id}`, 3, 3600)) return send(res, 429, TOO_MANY);
  const r = await sendVerification(user);
  if (!r.ok) return send(res, 502, { error: "We couldn't send the email just now. Try again in a minute." });
  send(res, 200, { ok: true });
});
