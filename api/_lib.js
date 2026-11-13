import { neon } from "@neondatabase/serverless";
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";

// Schema lives in tools/migrate.mjs and is applied before deploys, never on live requests.
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const sql = DB_URL ? neon(DB_URL) : null;

export const SITE = "https://storestake.com";
export const ADMIN_EMAILS = ["bsamaix@gmail.com"]; // notification recipients only; admin role is granted in the database
export const INVESTOR = { name: "Bobby", company: "KB Company LLC" };

function secretKey() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is missing or too short");
  return new TextEncoder().encode(s);
}

// ---------- request helpers ----------
export async function readBody(req) {
  try { if (req.body && typeof req.body === "object") return req.body; } catch { return {}; } // invalid JSON
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
// Vercel's Node helper drains the body and re-exposes it only through req.on('data'), so the async iterator yields nothing. Use events.
export function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
export function redirect(res, to) {
  res.statusCode = 302;
  res.setHeader("Location", to);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown").split(",")[0].trim();
}

export const isEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
export const clean = (s, max = 500) => (typeof s === "string" ? s.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "");
export const cleanText = (s, max = 1000) => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : ""); // multi-line fields
export const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
export const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

// Wraps every endpoint: method check, CSRF guard on POST (JSON only, same-origin), error handling.
export function wrap(handler, method = "POST") {
  return async (req, res) => {
    if (req.method !== method) return send(res, 405, { error: "Method not allowed" });
    if (method === "POST") {
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
        return send(res, 415, { error: "Unsupported request." });
      }
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { const u = new URL(origin); ok = u.protocol === "https:" && u.host === req.headers.host; } catch {}
        if (!ok) return send(res, 403, { error: "Request blocked." });
      }
    }
    try { await handler(req, res); }
    catch (e) {
      console.error(e);
      send(res, 500, { error: "Something went wrong on our side. Please try again in a minute." });
    }
  };
}

// ---------- rate limiting (fixed window, stored in Postgres) ----------
// Returns true when the caller is over the limit.
export async function limited(key, limit, windowSec) {
  const rows = await sql`INSERT INTO rate_limits (key, window_start, hits)
    VALUES (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
    RETURNING hits`;
  if (Math.random() < 0.02) { sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`.catch(() => {}); sql`DELETE FROM shopify_pending WHERE created_at < now() - interval '7 days'`.catch(() => {}); }
  return rows[0].hits > limit;
}
export const TOO_MANY = { error: "Too many attempts. Please wait a few minutes and try again." };

// ---------- sessions ----------
const COOKIE = "__Host-ss_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export async function setSession(res, user) {
  const token = await new SignJWT({ t: "session", uid: user.id, sv: user.session_version || 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", [`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, "__Host-ss_pending=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]);
}
export async function currentUser(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)__Host-ss_session=([^;]+)/);
  if (!m) return null;
  let payload;
  try { ({ payload } = await jwtVerify(m[1], secretKey())); } catch { return null; }
  const rows = await sql`SELECT id, email, name, role, session_version, (email_verified_at IS NOT NULL) AS email_verified
    FROM users WHERE id = ${payload.uid}`;
  const u = rows[0];
  if (!u || payload.t !== "session" || u.session_version !== payload.sv) return null;
  if (u.role === "admin" && (payload.iat || 0) < Math.floor(Date.now() / 1000) - 12 * 3600) return null; // admin sessions last 12 hours
  return u;
}
export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, email_verified: !!u.email_verified });

// Short signed values for OAuth state and similar (not sessions).
export async function signShort(payload, minutes, type) {
  return new SignJWT({ ...payload, t: type }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${minutes}m`).sign(secretKey());
}
export async function verifyShort(token, type) {
  try { const p = (await jwtVerify(String(token || ""), secretKey())).payload; return p.t === type ? p : null; } catch { return null; }
}

// ---------- secrets at rest (Shopify access tokens) ----------
function aesKey(purpose = "shopify") {
  return crypto.createHash("sha256").update(`storestake:${purpose}:` + process.env.AUTH_SECRET).digest();
}
export function encrypt(text, purpose) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", aesKey(purpose), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(blob, purpose) {
  const [iv, tag, enc] = String(blob).split(".").map((s) => Buffer.from(s, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", aesKey(purpose), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------- one-time email tokens (verify email, reset password) ----------
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
export async function createToken(userId, purpose, minutes) {
  const token = crypto.randomBytes(32).toString("base64url");
  await sql`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${purpose}, now() + make_interval(mins => ${minutes}))`;
  return token;
}
export async function consumeToken(token, purpose) {
  if (typeof token !== "string" || token.length < 20) return null;
  const rows = await sql`UPDATE email_tokens SET used_at = now()
    WHERE token_hash = ${hashToken(token)} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id`;
  return rows[0] ? rows[0].user_id : null;
}

// ---------- email (Resend) ----------
const oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ").slice(0, 200);
const FOOTER = `\n\n--\nStoreStake · ${SITE}\nFunding is offered by ${INVESTOR.company} under a written agreement. Nothing in this email is a commitment to fund until that agreement is signed.`;
export async function sendMail({ to, subject, text, replyTo }) {
  if (!process.env.RESEND_API_KEY) { console.warn("RESEND_API_KEY not set; email skipped"); return { ok: false, skipped: true }; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Bobby and Kristi at StoreStake <hello@storestake.com>",
        to, subject: oneLine(subject), text: text + FOOTER,
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    if (!r.ok) console.error("email failed", r.status, await r.text());
    return { ok: r.ok };
  } catch (e) { console.error("email error", e); return { ok: false }; }
}
// Notify Bobby. Test traffic (resend.dev addresses) never pings real inboxes.
export function notifyAdmins(subject, text, about = "") {
  if (/@resend\.dev$/i.test(about)) return Promise.resolve({ ok: true, skipped: true });
  return sendMail({ to: ADMIN_EMAILS, subject, text, replyTo: isEmail(about) ? about : undefined });
}
// One-click sign-in for founders without a password: a one-time link that also proves they own the inbox.
export async function magicLink(userId, next = "/account", days = 7) {
  const t = await createToken(userId, "login", 60 * 24 * days);
  return `${SITE}/api/auth/magic?t=${t}&next=${encodeURIComponent(next)}`;
}
export async function sendVerification(user) {
  const t = await createToken(user.id, "verify", 60 * 24 * 3);
  return sendMail({ to: user.email, subject: "Confirm your email for StoreStake",
    text: `Hi ${firstName(user.name)},\n\nConfirm this is your email address so we can send you updates about your application:\n\n${SITE}/verify?t=${t}\n\nThe link works once and expires in 3 days. If you didn't create a StoreStake account, you can ignore this email.` });
}

// ---------- business rules (the client mirrors these in tools/build_pages.py) ----------
export const ASK_MIN = 2000, ASK_MAX = 25000;
export const MIN_MONTHS = 6, MIN_REVENUE = 3000;
export const VALUATION_MULTIPLE = 2.5;   // a small store is valued at about 2.5x yearly profit
export const DIST_PCT = 50;              // share of each quarter's profit the store pays out to owners; the rest stays in the business
export const STAKE_MIN = 2, STAKE_MAX = 20;
export const APP_STATUSES = ["new", "reviewing", "offer", "accepted", "funded", "passed", "withdrawn"];
export const HELP = ["Paid ads", "Email & SMS", "Conversion rate", "Product & sourcing", "Wholesale & retail", "Operations & cash flow", "Just the money"];

// Example terms for a check against a store's monthly net sales. Every real offer is set by hand in admin.
// Example equity terms: valuation from yearly profit (with a floor of half of yearly sales), the stake a check buys, and the quarterly dividend at today's profit.
export function exampleTerms(check, monthlySales, monthlyProfit) {
  const profit = Math.max(0, Number(monthlyProfit) || 0), sales = Math.max(0, Number(monthlySales) || 0);
  const valuation = Math.round(Math.max(profit * 12 * VALUATION_MULTIPLE, sales * 12 * 0.5, 10000) / 1000) * 1000;
  const raw = +(check / valuation * 100).toFixed(1), over = raw > STAKE_MAX;
  const stake = Math.min(STAKE_MAX, Math.max(STAKE_MIN, raw));
  const quarterly = Math.round(profit * 3 * DIST_PCT / 100 * stake / 100);
  return { valuation, stake, raw, over, max_check: Math.floor(valuation * STAKE_MAX / 100 / 500) * 500, quarterly, dist: DIST_PCT, founder_keeps: +(100 - stake).toFixed(1) };
}

// What the store keeps each month, from the founder's own numbers.
// What a founder still has to add before an application is complete. Same list on their account page, your desk, and the reminders.
export const MISSING_LABELS = { report: "Shopify sales report", basics: "Monthly costs (ads, product, other)", story: "What the money does" };
export function missingItems(a) {
  const out = [];
  if (a.report_status !== "received") out.push("report");
  const monthsKnown = a.months_selling != null || (a.report && a.report.months_count > 0) || a.report_months > 0;
  if (!monthsKnown || a.ad_spend == null || a.cogs_pct == null || a.fixed_costs == null) out.push("basics");
  if (!a.use_of_funds || String(a.use_of_funds).trim().length < 10) out.push("story");
  return out;
}
// "Meets the bar" is only decided once there are numbers to decide it on.
export function meetsBar(a) {
  const months = a.months_selling != null ? a.months_selling : a.report && a.report.months_count ? a.report.months_count : null;
  if (a.revenue_exact == null || months == null) return null;
  const e = unitEconomics(a);
  return months >= MIN_MONTHS && a.revenue_exact >= MIN_REVENUE && a.ask_amount <= a.revenue_exact * 2 && (a.ad_spend == null || a.cogs_pct == null || e.contribution > 0);
}
export function unitEconomics(a) {
  const sales = Number(a.revenue_exact) || 0, cogs = sales * (Number(a.cogs_pct) || 0) / 100;
  const ads = Number(a.ad_spend) || 0, fixed = Number(a.fixed_costs) || 0;
  const contribution = sales - cogs - ads, profit = contribution - fixed;
  return { sales, cogs: Math.round(cogs), ads, fixed, contribution: Math.round(contribution), profit: Math.round(profit),
    margin: sales ? +((contribution / sales) * 100).toFixed(1) : null, roas: ads ? +(sales / ads).toFixed(2) : null };
}
