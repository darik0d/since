import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { one, query } from "./db";
import { publicBase } from "./env";

// Pilot accounts: email magic links, no passwords. The session is a signed cookie
// ("<uid>.<exp>.<sig>", HMAC-SHA256 with APP_SECRET) that middleware verifies without a DB call
// and passes on as the x-since-user request header.

export const SESSION_COOKIE = "since_session";
const SESSION_DAYS = 30;
const LINK_MINUTES = 30;

export type User = {
  id: number; email: string; is_admin: boolean; tg_token: string; inbox_token: string;
  granola_key_enc: string | null; max_watches: number; created_at: string;
};

const secret = () => {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("APP_SECRET is not set");
  return s;
};
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function signSession(userId: number): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = `${userId}.${exp}`;
  return { value: `${body}.${b64url(createHmac("sha256", secret()).update(body).digest())}`, maxAge: SESSION_DAYS * 86400 };
}

export const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(e);

/** The owner (user 1) gets their real email from ADMIN_EMAIL (or the first INVESTOR_EMAILS entry). */
export async function ensureOwner() {
  const email = normEmail(process.env.ADMIN_EMAIL || (process.env.INVESTOR_EMAILS ?? "").split(",")[0] || "");
  if (!email) return;
  await query("UPDATE users SET email = $1 WHERE id = 1 AND email = 'owner@since.local' AND NOT EXISTS (SELECT 1 FROM users WHERE email = $1)", [email]);
}

/** Create a one-time link and email it. Returns the link only when mail can't be sent (local dev). */
export async function requestLogin(rawEmail: string): Promise<{ sent: boolean; devLink?: string }> {
  const email = normEmail(rawEmail);
  if (!validEmail(email)) throw new Error("Enter a valid email address");
  const recent = await one<{ n: number }>("SELECT COUNT(*) AS n FROM login_tokens WHERE email = $1 AND created_at > now() - interval '15 minutes'", [email]);
  if ((recent?.n ?? 0) >= 5) throw new Error("Too many sign-in links requested. Try again in a few minutes.");
  const token = b64url(randomBytes(24));
  await query("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)", [
    createHash("sha256").update(token).digest("hex"), email, String(LINK_MINUTES),
  ]);
  const link = `${publicBase()}/api/auth/verify?token=${token}`;
  if (!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)) return { sent: false, devLink: link };
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT || 465);
  const tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await tx.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Your Since sign-in link",
    text: `Sign in to Since:\n\n${link}\n\nThe link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;max-width:480px">
      <p>Sign in to <b>Since</b>:</p>
      <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">Sign in</a></p>
      <p style="color:#6b7280;font-size:13px">The link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.</p></div>`,
  });
  return { sent: true };
}

/** Consume a link: returns the user (created on first sign-in). */
export async function verifyLogin(token: string): Promise<User | null> {
  const row = await one<{ email: string }>(
    `UPDATE login_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email`,
    [createHash("sha256").update(token).digest("hex")],
  );
  if (!row) return null;
  return (await one<User>(
    `INSERT INTO users (email, last_login_at) VALUES ($1, now())
     ON CONFLICT (email) DO UPDATE SET last_login_at = now() RETURNING *`,
    [row.email],
  )) ?? null;
}

/** The signed-in user's id (set by middleware), or null. */
export async function currentUserId(): Promise<number | null> {
  const v = (await headers()).get("x-since-user");
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function currentUser(): Promise<User | null> {
  const id = await currentUserId();
  return id ? ((await one<User>("SELECT * FROM users WHERE id = $1", [id])) ?? null) : null;
}

/** For API routes: the user or a thrown 401. */
export class Unauthorized extends Error {}
export async function requireUserId(): Promise<number> {
  const id = await currentUserId();
  if (!id) throw new Unauthorized("sign in first");
  return id;
}

export async function userById(id: number) {
  return one<User>("SELECT * FROM users WHERE id = $1", [id]);
}

/** Owner of a startup (for background jobs: alerts, Granola, Cala). */
export async function startupOwner(startupId: number) {
  return one<User>("SELECT u.* FROM users u JOIN startups s ON s.user_id = u.id WHERE s.id = $1", [startupId]);
}

export const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
