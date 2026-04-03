// api/send-email.js
// ─────────────────────────────────────────────────────────────────
// Vercel Serverless Function — Email sender for BIDA Co-operative
//
// SETUP:
//   1. Copy this file to /api/send-email.js in your project root
//   2. Go to Vercel → Your Project → Settings → Environment Variables
//   3. Add ONE of the provider configs below (Resend is easiest)
//   4. Redeploy — the yellow "Dev mode" OTP box disappears automatically
//
// SUPPORTED PROVIDERS (pick one):
//   A) Resend        — free tier, 100 emails/day — RECOMMENDED
//   B) SendGrid      — if you already have an account
//   C) Gmail SMTP    — via nodemailer (needs App Password)
//
// REQUEST FORMAT (from the app):
//   POST /api/send-email
//   { to, subject, text, attachment?: { content: base64, filename } }
//
// RESPONSE:
//   200 { ok: true }
//   4xx/5xx { error: "..." }
// ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, subject, text, attachment } = req.body || {};

  if (!to || !subject || !text) {
    return res.status(400).json({ error: "Missing required fields: to, subject, text" });
  }

  // ── PROVIDER A: Resend (recommended — free, easiest setup) ──────
  // Env vars needed: RESEND_API_KEY, EMAIL_FROM
  //
  // 1. Sign up at https://resend.com (free)
  // 2. Verify your sending domain (or use onboarding@resend.dev for testing)
  // 3. Create an API key under Settings → API Keys
  // 4. Add to Vercel env: RESEND_API_KEY=re_xxxxxxxxx
  //                       EMAIL_FROM=noreply@yourdomain.com
  //    (or: EMAIL_FROM=BIDA Cooperative <noreply@yourdomain.com>)

  if (process.env.RESEND_API_KEY) {
    try {
      const body = {
        from:    process.env.EMAIL_FROM || "BIDA Cooperative <noreply@bidacooperative.com>",
        to:      [to],
        subject: subject,
        text:    text,
      };

      // Add PDF attachment if present (for member statements)
      if (attachment?.content && attachment?.filename) {
        body.attachments = [{
          filename: attachment.filename,
          content:  attachment.content,   // base64 string
        }];
      }

      const r = await fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: {
          "Authorization": "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await r.json();
      if (!r.ok) throw new Error(data.message || JSON.stringify(data));
      return res.status(200).json({ ok: true, id: data.id });

    } catch (e) {
      console.error("[send-email] Resend error:", e.message);
      return res.status(500).json({ error: "Email send failed: " + e.message });
    }
  }


  // ── PROVIDER B: SendGrid ─────────────────────────────────────────
  // Env vars needed: SENDGRID_API_KEY, EMAIL_FROM
  //
  // 1. Sign up at https://sendgrid.com
  // 2. Create an API key (Settings → API Keys → Full Access)
  // 3. Verify your sender identity (Settings → Sender Authentication)
  // 4. Add to Vercel env: SENDGRID_API_KEY=SG.xxxxxxxxxx
  //                       EMAIL_FROM=noreply@yourdomain.com

  if (process.env.SENDGRID_API_KEY) {
    try {
      const body = {
        personalizations: [{ to: [{ email: to }] }],
        from:    { email: process.env.EMAIL_FROM || "noreply@bidacooperative.com", name: "BIDA Cooperative" },
        subject: subject,
        content: [{ type: "text/plain", value: text }],
      };

      if (attachment?.content && attachment?.filename) {
        body.attachments = [{
          content:     attachment.content,
          filename:    attachment.filename,
          type:        "application/pdf",
          disposition: "attachment",
        }];
      }

      const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method:  "POST",
        headers: {
          "Authorization": "Bearer " + process.env.SENDGRID_API_KEY,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const err = await r.text();
        throw new Error("SendGrid error " + r.status + ": " + err);
      }
      return res.status(200).json({ ok: true });

    } catch (e) {
      console.error("[send-email] SendGrid error:", e.message);
      return res.status(500).json({ error: "Email send failed: " + e.message });
    }
  }


  // ── PROVIDER C: Gmail via nodemailer ─────────────────────────────
  // Env vars needed: GMAIL_USER, GMAIL_APP_PASSWORD
  //
  // 1. Enable 2FA on your Gmail account
  // 2. Go to Google Account → Security → App Passwords
  // 3. Create a password for "Mail" on "Other device: BIDA App"
  // 4. Add to Vercel env: GMAIL_USER=bidacooperative@gmail.com
  //                       GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      const mailOptions = {
        from:    `"BIDA Cooperative" <${process.env.GMAIL_USER}>`,
        to:      to,
        subject: subject,
        text:    text,
      };

      if (attachment?.content && attachment?.filename) {
        mailOptions.attachments = [{
          filename: attachment.filename,
          content:  Buffer.from(attachment.content, "base64"),
          contentType: "application/pdf",
        }];
      }

      await transporter.sendMail(mailOptions);
      return res.status(200).json({ ok: true });

    } catch (e) {
      console.error("[send-email] Gmail error:", e.message);
      return res.status(500).json({ error: "Email send failed: " + e.message });
    }
  }


  // ── No provider configured ───────────────────────────────────────
  // If none of the env vars are set, return 503 so the app
  // falls back to showing the dev code on screen (dev mode only).
  console.warn("[send-email] No email provider configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or GMAIL_USER.");
  return res.status(503).json({
    error: "Email provider not configured. Add RESEND_API_KEY to Vercel environment variables.",
  });
}
