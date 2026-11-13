// The app URL Shopify opens from a merchant's admin (?shop=...&hmac=...). Starts read-only authorization immediately.
import { redirect, send, wrap, signShort } from "../_lib.js";
import { configured, validShop, verifyQueryHmac, SCOPES, REDIRECT } from "./_shopify.js";

export default wrap(async (req, res) => {
  const q = Object.fromEntries(new URL(req.url, "https://x").searchParams);
  const shop = String(q.shop || "").toLowerCase();
  if (!shop) return redirect(res, "/");
  if (!validShop(shop)) return send(res, 400, { error: "That isn't a myshopify.com address." });
  if (!configured()) return redirect(res, "/account?shopify=not-configured");
  if (q.hmac && !verifyQueryHmac(q)) return send(res, 400, { error: "Bad signature." });
  // Always start authorization (Shopify auto-approves an already-installed app), so this URL reveals nothing about who has applied.
  const state = await signShort({ uid: null, app: null, shop }, 15, "state");
  res.setHeader("Set-Cookie", `__Host-ss_shopify=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
  redirect(res, `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(process.env.SHOPIFY_API_KEY)}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${encodeURIComponent(state)}`);
}, "GET");
