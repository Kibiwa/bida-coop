// api/send-email.js - Complete working version with PDF attachments
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { to, subject, text, html, attachment } = req.body || {};
  
  if (!to || !subject) {
    return res.status(400).json({ error: "Missing to or subject" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY not configured" });
  }

  // Use Resend's default sender (works immediately)
  const fromEmail = "onboarding@resend.dev";
  const fromName = "Bida Multi-Purpose Co-operative Society";

  // Create HTML email
  const htmlBody = html || `
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

  const payload = {
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    subject: subject,
    html: htmlBody,
    text: text || subject,
  };

  // Add PDF attachment if present
  if (attachment?.content && attachment?.filename) {
    payload.attachments = [{
      filename: attachment.filename,
      content: attachment.content,
    }];
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    
    console.log("Resend response:", response.status, data);

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.message || "Email send failed",
        details: data 
      });
    }

    return res.status(200).json({ 
      ok: true, 
      id: data.id,
      message: "Email sent successfully"
    });
  } catch (error) {
    console.error("Email error:", error);
    return res.status(500).json({ error: error.message });
  }
}
