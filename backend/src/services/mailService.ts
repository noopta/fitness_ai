// Single email sender used by every transactional flow (verification OTP,
// onboarding, password reset later, etc.). Mirrors the SendGrid+Gmail
// fallback pattern that already lives in routes/waitlist.ts so we get the
// same behaviour without bolting another copy onto every caller.
//
// Returns `{ sent: true }` on success and `{ sent: false, reason }` when the
// configuration is missing — callers are expected to surface that to the
// user as "couldn't send code, try again" rather than a 500.

import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

const FROM = process.env.EMAIL_FROM || 'team@airthreads.ai';

let useSendGrid = false;
if (process.env.SENDGRID_API_KEY) {
  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    useSendGrid = true;
  } catch {
    useSendGrid = false;
  }
}

let gmailTransport: nodemailer.Transporter | null = null;
if (!useSendGrid && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
  try {
    gmailTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
      tls: { rejectUnauthorized: false },
    });
  } catch {
    gmailTransport = null;
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  // Optional plain-text body. If omitted we strip HTML tags from `html`.
  text?: string;
  from?: string;
}

export interface SendEmailResult {
  sent: boolean;
  provider: 'sendgrid' | 'gmail' | null;
  reason?: string;
}

export async function sendEmail({ to, subject, html, text, from }: SendEmailInput): Promise<SendEmailResult> {
  const fromAddr = from || FROM;
  const plain = text ?? html.replace(/<[^>]*>/g, '');

  if (useSendGrid) {
    try {
      await sgMail.send({ to, from: fromAddr, subject, html, text: plain });
      return { sent: true, provider: 'sendgrid' };
    } catch (err: any) {
      // SendGrid errors carry useful body info — surface it for logs but
      // don't throw, so the caller can degrade gracefully.
      console.error('[mail] SendGrid send failed:', err?.response?.body ?? err?.message ?? err);
      return { sent: false, provider: 'sendgrid', reason: err?.message ?? 'SendGrid error' };
    }
  }

  if (gmailTransport) {
    try {
      await gmailTransport.sendMail({ from: `"Axiom Team" <${fromAddr}>`, to, subject, html, text: plain });
      return { sent: true, provider: 'gmail' };
    } catch (err: any) {
      console.error('[mail] Gmail send failed:', err?.message ?? err);
      return { sent: false, provider: 'gmail', reason: err?.message ?? 'Gmail SMTP error' };
    }
  }

  return { sent: false, provider: null, reason: 'No email provider configured' };
}

export function isMailConfigured(): boolean {
  return useSendGrid || gmailTransport !== null;
}
