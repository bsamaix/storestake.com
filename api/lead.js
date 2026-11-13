// Step 1 of the application: store + email, saved the moment the founder taps Next.
import { sql, readBody, send, isEmail, clean, wrap, limited, TOO_MANY, clientIp, notifyAdmins, SITE } from "./_lib.js";

export default wrap(async (req, res) => {
  if (await limited(`lead:${clientIp(req)}`, 10, 600)) return send(res, 429, TOO_MANY);
  const b = await readBody(req);
  const email = clean(b.email, 254).toLowerCase();
  const store = clean(b.store, 200).replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  if (!isEmail(email)) return send(res, 400, { error: "Enter a valid email address." });
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(\/[\w\-./]*)?$/i.test(store)) return send(res, 400, { error: "Enter your store's web address, like yourbrand.com." });
  const rows = await sql`INSERT INTO leads (email, store_url, source) VALUES (${email}, ${store}, ${clean(b.source, 200) || null})
    ON CONFLICT (email, store_url) DO UPDATE SET updated_at = now()
    RETURNING (xmax = 0) AS fresh`;
  const exists = (await sql`SELECT 1 FROM users WHERE email = ${email}`).length > 0;
  // Only Bobby is emailed here, never the address typed in, so the form can't be used to email strangers.
  if (rows[0].fresh) await notifyAdmins(`Started an application: ${store}`,
    `${email} entered https://${store} on step 1 of the application.\nSource: ${clean(b.source, 200) || "direct"}\n\nIf no application follows, this is someone worth a short personal email.\n\n${SITE}/stats`, email);
  send(res, 200, { ok: true, exists });
});
