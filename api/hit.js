// First-party analytics beacon. Cookieless: a visitor id is a daily hash of IP + user agent + secret,
// so nobody can be followed across days and no personal data is stored.
import crypto from "node:crypto";
import { sql, readBody, send, wrap, clean, limited } from "./_lib.js";

const EVENTS = new Set(["calc_touched", "apply_click", "apply_focus", "apply_lead", "apply_start", "apply_report", "apply_step3", "apply_submit", "finish_open", "finish_report", "finish_done", "signup", "shopify_connect", "video_play"]);
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|curl|wget|python|monitor|pingdom|uptime/i;

export default wrap(async (req, res) => {
  const ua = String(req.headers["user-agent"] || "");
  if (!ua || BOT.test(ua)) return send(res, 200, { ok: true });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (await limited(`hit:${ip}`, 120, 60)) return send(res, 200, { ok: true });
  const b = await readBody(req);

  let path = clean(b.p, 200);
  if (!path.startsWith("/")) path = "/";
  path = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const event = EVENTS.has(b.e) ? b.e : null;

  let refHost = null;
  try { const u = new URL(String(b.r || "")); if (u.host && u.host !== req.headers.host) refHost = u.host.replace(/^www\./, "").slice(0, 100); } catch {}
  // Campaign tags come from the "ss_src" value site.js keeps for the session, so an ad click credits every page after it.
  const src = new URLSearchParams(clean(b.s, 300));
  const source = clean(src.get("utm_source") || src.get("ref") || "", 60) || null;
  const medium = clean(src.get("utm_medium") || "", 60) || null;
  const campaign = clean(src.get("utm_campaign") || "", 80) || null;

  const device = /ipad|tablet/i.test(ua) ? "tablet" : /mobi|android|iphone/i.test(ua) ? "mobile" : "desktop";
  const country = clean(req.headers["x-vercel-ip-country"], 2).toUpperCase() || null;
  const day = new Date().toISOString().slice(0, 10);
  const vid = crypto.createHash("sha256").update(`${day}|${ip}|${ua}|${process.env.AUTH_SECRET}`).digest("base64url").slice(0, 24);

  await sql`INSERT INTO hits (vid, path, event, ref_host, source, medium, campaign, device, country)
    VALUES (${vid}, ${path}, ${event}, ${refHost}, ${source}, ${medium}, ${campaign}, ${device}, ${country})`;
  send(res, 200, { ok: true });
});
