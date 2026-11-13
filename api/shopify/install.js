// Starts the read-only Shopify connection for one of the signed-in founder's applications.
// GET /api/shopify/install?app=ID&shop=brand.myshopify.com
import { sql, send, redirect, currentUser, wrap, signShort } from "../_lib.js";
import { configured, validShop, SCOPES, REDIRECT } from "./_shopify.js";

export default wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return redirect(res, "/login?next=/account");
  if (!configured()) return send(res, 503, { error: "Shopify connections aren't switched on yet. We'll email you when they are." });
  const q = new URL(req.url, "https://x").searchParams;
  const shop = String(q.get("shop") || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const appId = Math.round(Number(q.get("app")));
  if (!validShop(shop)) return send(res, 400, { error: "Enter your store's myshopify.com address, like brand.myshopify.com." });
  const own = await sql`SELECT id FROM brand_applications WHERE id = ${appId} AND user_id = ${user.id}`;
  if (!own.length) return send(res, 404, { error: "That application isn't on your account." });
  const state = await signShort({ uid: user.id, app: appId, shop }, 15, "state");
  res.setHeader("Set-Cookie", `__Host-ss_shopify=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
  const url = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(process.env.SHOPIFY_API_KEY)}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${encodeURIComponent(state)}`;
  redirect(res, url);
}, "GET");
