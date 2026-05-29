import "server-only";
import { Resend } from "resend";

type EmailUser = { email: string; name?: string };

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
const resend = apiKey ? new Resend(apiKey) : null;

async function send(to: string, subject: string, html: string, text: string) {
  if (!resend) {
    console.log(`[email] (RESEND_API_KEY unset) to=${to} subject="${subject}"\n${text}`);
    return;
  }
  const { error } = await resend.emails.send({ from, to, subject, html, text });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

export async function sendVerificationEmail({ user, url }: { user: EmailUser; url: string }) {
  const subject = "Verify your finmon email";
  const text = `Click to verify your email: ${url}`;
  const html = `<p>Welcome to finmon${user.name ? `, ${escapeHtml(user.name)}` : ""}.</p>
<p><a href="${url}">Verify your email</a></p>
<p>Or paste this link: ${url}</p>`;
  await send(user.email, subject, html, text);
}

export async function sendPasswordResetEmail({ user, url }: { user: EmailUser; url: string }) {
  const subject = "Reset your finmon password";
  const text = `Click to reset your password: ${url}`;
  const html = `<p>A password reset was requested for your finmon account.</p>
<p><a href="${url}">Reset your password</a></p>
<p>Or paste this link: ${url}</p>
<p>If you didn't request this, ignore this email.</p>`;
  await send(user.email, subject, html, text);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
