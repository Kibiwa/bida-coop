// api/send-email.js - Gmail version
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { to, subject, text, attachment } = req.body || {};
  
  if (!to || !subject) {
    return res.status(400).json({ error: "Missing to or subject" });
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;

  if (!user || !pass) {
    return res.status(500).json({ error: "Gmail credentials not configured" });
  }

  // Create transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  // HTML email template
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0d2a5e, #1565c0); padding: 20px; text-align: center;">
        <h2 style="color: #fff; margin: 0;">BIDA</h2>
        <p style="color: #90caf9; margin: 5px 0 0;">Multi-Purpose Co-operative Society</p>
      </div>
      <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none;">
        <pre style="font-family: Arial; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${(text || subject).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      </div>
      <div style="text-align: center; padding: 10px; font-size: 11px; color: #999;">
        Bida Multi-Purpose Co-operative Society · bidacooperative@gmail.com
      </div>
    </div>
  `;

  const mailOptions = {
    from: `"Bida Co-operative" <${user}>`,
    to: to,
    subject: subject,
    text: text || subject,
    html: htmlBody,
  };

  // Add PDF attachment if provided
  if (attachment?.content && attachment?.filename) {
    let base64Data = attachment.content;
    if (base64Data.includes(',')) {
      base64Data = base64Data.split(',')[1];
    }
    
    mailOptions.attachments = [{
      filename: attachment.filename,
      content: Buffer.from(base64Data, 'base64'),
    }];
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.messageId);
    return res.status(200).json({ 
      ok: true, 
      id: info.messageId,
      message: "Email sent successfully"
    });
  } catch (error) {
    console.error("Gmail error:", error);
    return res.status(500).json({ 
      error: error.message,
      details: "Check Gmail app password and 2FA settings"
    });
  }
}
