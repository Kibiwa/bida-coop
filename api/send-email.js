// ============================================================
// api/send-email.js  —  drop this into your project's /api/ folder
// Uses Resend (free: 3,000 emails/month, no credit card needed)
//
// REQUIRED Vercel Environment Variables:
//   RESEND_API_KEY  →  from resend.com dashboard → API Keys
//   FROM_EMAIL      →  onboarding@resend.dev (works immediately, no domain)
//                      OR your own domain once verified e.g. noreply@bidacoop.ug
//   FROM_NAME       →  Bida Multi-Purpose Co-operative Society
// ============================================================

export default async function handler(req, res) {
  // CORS for browser requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, subject, text, html, attachment } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: "Missing: to, subject" });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "RESEND_API_KEY not set in Vercel environment variables. Go to Vercel → Project → Settings → Environment Variables."
    });
  }

  const fromEmail = process.env.FROM_EMAIL || "onboarding@resend.dev";
  const fromName  = process.env.FROM_NAME  || "Bida Co-operative";

  // Build clean HTML from plain text if no HTML provided
  const htmlBody = html || `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#0d2a5e;padding:18px 20px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;font-size:20px;letter-spacing:2px;">BIDA</h2>
        <p style="color:#90caf9;margin:4px 0 0;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Multi-Purpose Co-operative Society</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e0e0;border-top:none;padding:24px 20px;border-radius:0 0 8px 8px;">
        <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;font-size:14px;line-height:1.7;color:#333;margin:0;">${
          (text||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        }</pre>
      </div>
      <p style="font-size:11px;color:#999;text-align:center;margin-top:16px;">
        Bida Multi-Purpose Co-operative Society · bidacooperative@gmail.com
      </p>
    </div>
  `;

  const payload = {
    from: `${fromName} <${fromEmail}>`,
    to:   Array.isArray(to) ? to : [to],
    subject,
    text:  text || subject,
    html:  htmlBody,
  };

  // Attach PDF if provided (base64 encoded from the app)
  if (attachment?.content && attachment?.filename) {
    payload.attachments = [{
      filename: attachment.filename,
      content:  attachment.content,  // base64 string
    }];
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Resend error:", data);
      return res.status(response.status).json({
        error: data.message || data.error || "Resend API returned an error",
      });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error("send-email handler crash:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

