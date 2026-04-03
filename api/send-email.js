// ================================================================
// api/send-email.js  —  Vercel Serverless Function
// Handles: OTP login codes + PDF statement attachments
//
// Required environment variables (set in Vercel project settings):
//   RESEND_API_KEY  — from https://resend.com → API Keys
//   FROM_EMAIL      — e.g. onboarding@resend.dev  (no custom domain needed)
//                     or noreply@yourdomain.com if you've verified a domain
//   FROM_NAME       — e.g. Bida Multi-Purpose Co-operative Society
// ================================================================

export default async function handler(req, res) {
  // ── Only accept POST ──────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Check env vars are configured ────────────────────────────
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL     = process.env.FROM_EMAIL     || "onboarding@resend.dev";
  const FROM_NAME      = process.env.FROM_NAME      || "Bida Co-operative";

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY environment variable is not set.");
    return res.status(500).json({ error: "Email service not configured. Set RESEND_API_KEY in Vercel." });
  }

  // ── Parse request body ────────────────────────────────────────
  const { to, subject, text, html, attachment } = req.body || {};

  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: "Missing required fields: to, subject, and text or html." });
  }

  // ── Validate recipient email ──────────────────────────────────
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    return res.status(400).json({ error: "Invalid recipient email address." });
  }

  // ── Build Resend payload ──────────────────────────────────────
  const payload = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to:   [to],
    subject,
    text: text || "",
  };

  // Optional: HTML version (falls back to auto-generating from text if not provided)
  if (html) {
    payload.html = html;
  } else if (text) {
    // Auto-generate a clean HTML version from plain text for better deliverability
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const lines = escaped.split("\n").map(l => l.trim() === "" ? "<br/>" : `<p style="margin:0 0 8px 0;">${l}</p>`).join("\n");
    payload.html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
        <div style="background:#fff;border-radius:10px;padding:32px;border:1px solid #e5e5e5;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;background:#00C853;color:#fff;font-weight:700;font-size:16px;padding:8px 20px;border-radius:20px;letter-spacing:.5px;">
              BIDA Co-operative
            </div>
          </div>
          <div style="color:#333;font-size:15px;line-height:1.7;">
            ${lines}
          </div>
          <hr style="border:none;border-top:1px solid #eee;margin:28px 0;"/>
          <div style="font-size:11px;color:#999;text-align:center;">
            Bida Multi-Purpose Co-operative Society &nbsp;·&nbsp; Do not reply to this email
          </div>
        </div>
      </div>
    `;
  }

  // Optional: PDF attachment  { content: base64string, filename: "statement.pdf" }
  if (attachment && attachment.content && attachment.filename) {
    payload.attachments = [
      {
        filename: attachment.filename,
        content:  attachment.content,   // Resend accepts base64 directly
      },
    ];
  }

  // ── Call Resend API ───────────────────────────────────────────
  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await resendRes.json().catch(() => ({}));

    if (!resendRes.ok) {
      console.error("Resend API error:", resendRes.status, data);
      return res.status(resendRes.status).json({
        error: data?.message || data?.error || `Resend error ${resendRes.status}`,
      });
    }

    // ── Success ───────────────────────────────────────────────
    return res.status(200).json({ ok: true, id: data.id });

  } catch (err) {
    console.error("send-email network error:", err);
    return res.status(500).json({ error: "Failed to reach email service. " + err.message });
  }
}
