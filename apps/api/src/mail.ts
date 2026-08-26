import nodemailer from 'nodemailer';
import { config } from './config.js';

export type MailResult = { messageId: string; previewUrl?: string };
export async function sendMail(input: { to: string; subject: string; body: string; from: string }): Promise<MailResult> {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) {
    return { messageId: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`, previewUrl: `http://localhost:4000/dev-preview/${encodeURIComponent(input.to)}` };
  }
  const transporter = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } });
  const info = await transporter.sendMail({ from: `${config.SMTP_FROM_NAME} <${input.from}>`, to: input.to, subject: input.subject, text: input.body });
  return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || undefined };
}
