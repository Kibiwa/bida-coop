// api/send-email.js
// BIDA Co-operative — Gmail sender (Vercel Serverless Function)
// Handles: member OTP login codes + HTML reminder emails + PDF attachments
//
// Required Vercel env vars:
//   GMAIL_USER         = bidacooperative@gmail.com
//   GMAIL_APP_PASSWORD = xxxx xxxx xxxx xxxx  (16-char Google App Password)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, subject, text, html, attachment } = req.body || {};

  if (!to || !subject || !text) {
    return res.status(400).json({ error: "Missing fields: to, subject, text" });
  }

  const GMAIL_USER         = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.error("[send-email] GMAIL_USER or GMAIL_APP_PASSWORD not set.");
    return res.status(503).json({ error: "Email not configured." });
  }

  try {
    const nodemailer = await import("nodemailer");

    const transporter = nodemailer.default.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    });

    const mailOptions = {
      from:    `"Bida Multi-Purpose Co-operative" <${GMAIL_USER}>`,
      to:      to,
      subject: subject,
      text:    text,
    };

    // HTML version (renders beautifully in email clients)
    if (html) {
      mailOptions.html = html;
    }

    // PDF attachment (for savings/loan statement reminders)
    if (attachment?.content && attachment?.filename) {
      mailOptions.attachments = [{
        filename:    attachment.filename,
        content:     Buffer.from(attachment.content, "base64"),
        contentType: "application/pdf",
      }];
    }

    await transporter.sendMail(mailOptions);
    console.log("[send-email] Sent to:", to, "| Subject:", subject);
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error("[send-email] Gmail error:", e.message);
    return res.status(500).json({ error: "Email send failed: " + e.message });
  }
}
