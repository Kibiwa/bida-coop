// api/send-sms.js
// ─────────────────────────────────────────────────────────────────
// Vercel Serverless Function — SMS sender for BIDA Co-operative
//
// SETUP:
//   1. Copy this file to /api/send-sms.js in your project root
//   2. Go to Vercel → Your Project → Settings → Environment Variables
//   3. Add the env vars for your provider (Africa's Talking recommended)
//   4. Redeploy
//
// SUPPORTED PROVIDERS:
//   A) Africa's Talking — works in Uganda, reasonable rates — RECOMMENDED
//   B) Twilio            — global, slightly pricier for Uganda
//
// REQUEST FORMAT (from the app):
//   POST /api/send-sms
//   { to: "256772123456", message: "Your BIDA login code is: 123456..." }
//
// RESPONSE:
//   200 { ok: true }
//   4xx/5xx { error: "..." }
// ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, message } = req.body || {};

  if (!to || !message) {
    return res.status(400).json({ error: "Missing required fields: to, message" });
  }

  // Normalise number — ensure it starts with 256 (Uganda)
  const normalise = (n) => {
    const d = n.replace(/\D/g, "");
    if (d.startsWith("256") && d.length >= 12) return "+" + d;
    if (d.startsWith("0") && d.length >= 10) return "+256" + d.slice(1);
    return "+" + d;
  };
  const phone = normalise(to);


  // ── PROVIDER A: Africa's Talking (recommended for Uganda) ────────
  // Env vars: AT_API_KEY, AT_USERNAME, AT_SENDER_ID (optional)
  //
  // 1. Register at https://africastalking.com
  // 2. Create a new app under your account
  // 3. Go to Settings → API Key — copy the production key
  // 4. Add to Vercel env:
  //    AT_API_KEY   = your production API key
  //    AT_USERNAME  = your Africa's Talking username
  //    AT_SENDER_ID = BIDA (optional — apply for shortcode/alphanumeric)
  //
  // Note: Use sandbox (username=sandbox, key=any) for testing.

  if (process.env.AT_API_KEY && process.env.AT_USERNAME) {
    try {
      const params = new URLSearchParams({
        username: process.env.AT_USERNAME,
        to:       phone,
        message:  message,
      });
      if (process.env.AT_SENDER_ID) {
        params.set("from", process.env.AT_SENDER_ID);
      }

      const r = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          "Accept":       "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "apiKey":       process.env.AT_API_KEY,
        },
        body: params.toString(),
      });

      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));

      const recipients = data?.SMSMessageData?.Recipients;
      if (recipients && recipients[0]?.statusCode !== 101) {
        throw new Error("AT delivery failed: " + JSON.stringify(recipients[0]));
      }

      return res.status(200).json({ ok: true, provider: "africastalking" });

    } catch (e) {
      console.error("[send-sms] Africa's Talking error:", e.message);
      return res.status(500).json({ error: "SMS send failed: " + e.message });
    }
  }


  // ── PROVIDER B: Twilio ───────────────────────────────────────────
  // Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
  //
  // 1. Register at https://twilio.com
  // 2. Get a phone number (Trial allows Uganda +256 numbers)
  // 3. Add to Vercel env:
  //    TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxx
  //    TWILIO_AUTH_TOKEN  = your auth token
  //    TWILIO_FROM        = +1xxxxxxxxxx (your Twilio number)

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const sid  = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(sid + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64");

      const params = new URLSearchParams({
        To:   phone,
        From: process.env.TWILIO_FROM || "",
        Body: message,
      });

      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method:  "POST",
          headers: {
            "Authorization": "Basic " + auth,
            "Content-Type":  "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        }
      );

      const data = await r.json();
      if (!r.ok || data.error_code) throw new Error(data.message || JSON.stringify(data));
      return res.status(200).json({ ok: true, sid: data.sid, provider: "twilio" });

    } catch (e) {
      console.error("[send-sms] Twilio error:", e.message);
      return res.status(500).json({ error: "SMS send failed: " + e.message });
    }
  }


  // ── No provider configured ───────────────────────────────────────
  console.warn("[send-sms] No SMS provider configured. Set AT_API_KEY or TWILIO_ACCOUNT_SID.");
  return res.status(503).json({
    error: "SMS provider not configured. Add AT_API_KEY + AT_USERNAME to Vercel environment variables.",
  });
}
