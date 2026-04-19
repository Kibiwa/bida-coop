// pages/api/confirm-guarantor.js
// ─────────────────────────────────────────────────────────────────
// BIDA Co-operative — Guarantor Confirmation Route
// No login required. Handles both:
//   GET  /api/confirm-guarantor?token=xxx  → HTML confirmation page
//   POST /api/confirm-guarantor            → JSON action { token, action }
// ─────────────────────────────────────────────────────────────────

const SUPA_URL      = "https://oscuauaifgaeauzvkihu.supabase.co";
const SUPA_ANON_KEY = process.env.NEXT_PUBLIC_SUPA_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY3VhdWFpZmdhZWF1enZraWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NTU2MzEsImV4cCI6MjA4OTEzMTYzMX0.tsdr1vL7Q5DcrSt-0AMHeWpxfXCWvi4KXuYuYoLblI0";

// ── Supabase REST helper ──────────────────────────────────────────
async function db(method, table, query = "", body = null) {
  const url = `${SUPA_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
  const headers = {
    "Content-Type":  "application/json",
    apikey:          SUPA_ANON_KEY,
    Authorization:   "Bearer " + SUPA_ANON_KEY,
  };
  if (method === "POST")  headers.Prefer = "return=representation";
  if (method === "PATCH") headers.Prefer = "return=representation";

  const r = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!r.ok) {
    const t = await r.text().catch(() => String(r.status));
    throw new Error(`Supabase ${method} ${table}: ${t}`);
  }
  if (r.status === 204) return [];
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

// ── Utilities ─────────────────────────────────────────────────────
const fmtUGX = (n) =>
  "UGX " + Number(n || 0).toLocaleString("en-UG");

const monthlyEstimate = (amount, term) => {
  if (!amount || !term) return "—";
  return fmtUGX(Math.round(amount / term + amount * 0.04));
};

// ── HTML renderer ─────────────────────────────────────────────────
function buildPage({ guarantor, loan, token, alreadyResponded, errorTitle, errorMsg }) {
  const name       = guarantor?.guarantor_name  || "Guarantor";
  const borrower   = loan?.member_name          || "Borrower";
  const amount     = fmtUGX(loan?.amount);
  const purpose    = loan?.purpose              || "Not specified";
  const term       = loan?.term                 || 12;
  const rel        = guarantor?.relationship    || "Member";
  const reqNum     = loan?.request_number       || (loan?.id ? "#" + loan.id : "");
  const monthly    = monthlyEstimate(loan?.amount, term);
  const confirmed  = guarantor?.confirmed;
  const declined   = guarantor?.declined;
  const safeToken  = (token || "").replace(/'/g, "\\'");

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      min-height:100vh;
      background:linear-gradient(135deg,#0a1f3d 0%,#0d3461 55%,#1565c0 100%);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
      display:flex;align-items:flex-start;justify-content:center;
      padding:24px 16px 48px;
    }
    .card{
      background:#fff;border-radius:20px;width:100%;max-width:480px;
      box-shadow:0 24px 64px rgba(0,0,0,.4);overflow:hidden;margin-top:8px;
    }
    .hdr{
      background:linear-gradient(135deg,#0d3461,#1565c0);
      padding:22px 24px 18px;text-align:center;color:#fff;
    }
    .logo-box{display:inline-block;background:#fff;border-radius:8px;padding:4px 16px;margin-bottom:8px}
    .logo-box span{font-size:22px;font-weight:900;color:#1565c0;letter-spacing:3px}
    .tagline{font-size:10px;letter-spacing:2px;opacity:.7;text-transform:uppercase;margin-bottom:10px}
    .badge{
      display:inline-block;background:rgba(255,255,255,.15);
      border:1px solid rgba(255,255,255,.3);border-radius:20px;
      padding:3px 14px;font-size:11px;font-weight:600;
    }
    .body{padding:24px}
    h2{font-size:17px;font-weight:800;color:#0d2a5e;margin-bottom:3px}
    .sub{font-size:12px;color:#78909c;margin-bottom:18px}
    .intro{font-size:13px;color:#263238;margin-bottom:16px;line-height:1.65}
    .amt-box{
      background:linear-gradient(135deg,#0d3461,#1565c0);
      border-radius:12px;padding:14px 18px;margin:16px 0;color:#fff;text-align:center;
    }
    .amt-lbl{font-size:10px;opacity:.75;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px}
    .amt-val{font-size:28px;font-weight:900;font-family:monospace;letter-spacing:1px}
    .row{
      display:flex;justify-content:space-between;align-items:center;
      padding:9px 0;border-bottom:1px solid #f0f4f8;font-size:13px;
    }
    .row:last-child{border-bottom:none}
    .lbl{color:#78909c}
    .val{font-weight:700;color:#0d2a5e;text-align:right;max-width:60%;word-break:break-word}
    .warn{
      background:#fff8e1;border:1px solid #ffe082;border-radius:10px;
      padding:12px 14px;margin:18px 0;font-size:12px;color:#795548;line-height:1.65;
    }
    .warn strong{color:#e65100}
    .btns{display:flex;gap:10px;margin-top:20px}
    .btn{
      flex:1;padding:14px;border-radius:12px;border:none;
      font-size:15px;font-weight:800;cursor:pointer;
      transition:opacity .15s,transform .1s;
    }
    .btn:active{transform:scale(.97)}
    .btn:disabled{opacity:.4;cursor:not-allowed}
    .btn-ok{background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;box-shadow:0 4px 14px rgba(27,94,32,.3)}
    .btn-no{background:#ffebee;color:#c62828;border:1.5px solid #ffcdd2}
    .note{font-size:10px;color:#90a4ae;text-align:center;margin-top:12px}
    .sbox{border-radius:12px;padding:20px;text-align:center;margin-top:4px}
    .sbox-ok{background:#e8f5e9;border:1.5px solid #a5d6a7}
    .sbox-no{background:#ffebee;border:1.5px solid #ffcdd2}
    .sicon{font-size:42px;margin-bottom:10px}
    .stitle{font-size:16px;font-weight:800;margin-bottom:6px}
    .sbox-ok .stitle{color:#1b5e20}
    .sbox-no .stitle{color:#c62828}
    .ssub{font-size:12px;color:#546e7a;line-height:1.6}
    .errbox{background:#ffebee;border:1.5px solid #ffcdd2;border-radius:12px;padding:22px;text-align:center}
    .erricon{font-size:38px;margin-bottom:10px}
    .errtitle{font-size:15px;font-weight:800;color:#c62828;margin-bottom:6px}
    .errsub{font-size:12px;color:#546e7a;line-height:1.6}
    .ftr{padding:14px 24px;text-align:center;background:#f8faff;border-top:1px solid #e8eaf6;font-size:10px;color:#90a4ae}
    .spinner{
      width:20px;height:20px;border:3px solid rgba(255,255,255,.3);
      border-top-color:#fff;border-radius:50%;
      animation:spin .7s linear infinite;display:inline-block;vertical-align:middle;
    }
    .spinner-dark{border-color:rgba(0,0,0,.15);border-top-color:#c62828}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:380px){.btns{flex-direction:column}.amt-val{font-size:22px}}
  `;

  let bodyContent;

  if (errorTitle) {
    bodyContent = `
      <div class="errbox">
        <div class="erricon">❌</div>
        <div class="errtitle">${errorTitle}</div>
        <div class="errsub">${errorMsg}</div>
      </div>`;
  } else if (alreadyResponded) {
    bodyContent = `
      <h2>Already Responded</h2>
      <div class="sub">Loan ${reqNum}</div>
      <div class="sbox ${confirmed ? "sbox-ok" : "sbox-no"}">
        <div class="sicon">${confirmed ? "✅" : "❌"}</div>
        <div class="stitle">${confirmed ? "You confirmed as guarantor" : "You declined this request"}</div>
        <div class="ssub">
          ${confirmed
            ? `Thank you. The application for <strong>${borrower}</strong> is now under review by the Loan Officer.`
            : `The borrower has been notified and will need to choose another guarantor.`}
        </div>
      </div>`;
  } else {
    bodyContent = `
      <h2>Guarantor Confirmation Request</h2>
      <div class="sub">Loan ${reqNum} · Action required</div>
      <p class="intro">
        Dear <strong>${name}</strong>,<br/>
        <strong>${borrower}</strong> has listed you as a guarantor for the loan below.
        By confirming, you acknowledge the borrower's repayment obligation to BIDA Co-operative.
      </p>
      <div class="amt-box">
        <div class="amt-lbl">Loan Amount</div>
        <div class="amt-val">${amount}</div>
      </div>
      <div class="row"><span class="lbl">Borrower</span><span class="val">${borrower}</span></div>
      <div class="row"><span class="lbl">Purpose</span><span class="val">${purpose}</span></div>
      <div class="row"><span class="lbl">Term</span><span class="val">${term} months</span></div>
      <div class="row"><span class="lbl">Est. Monthly Payment</span><span class="val">${monthly}</span></div>
      <div class="row"><span class="lbl">Your Relationship</span><span class="val">${rel}</span></div>
      <div class="warn">
        <strong>⚠️ Please read:</strong> As guarantor you understand that if
        <strong>${borrower}</strong> defaults, BIDA Co-operative may seek
        recovery from you. Only confirm if you accept this responsibility.
      </div>
      <div id="msg"></div>
      <div class="btns" id="btns">
        <button class="btn btn-no"  id="btn-decline" onclick="respond('decline')">❌ Decline</button>
        <button class="btn btn-ok"  id="btn-confirm" onclick="respond('confirm')">✅ Confirm as Guarantor</button>
      </div>
      <p class="note">This link is valid for 7 days and can only be used once. No account required.</p>
      <script>
        async function respond(action) {
          const btns = document.getElementById('btns');
          const msg  = document.getElementById('msg');
          document.getElementById('btn-confirm').innerHTML = '<span class="spinner"></span>';
          document.getElementById('btn-decline').innerHTML = '<span class="spinner spinner-dark"></span>';
          document.querySelectorAll('.btn').forEach(b=>b.disabled=true);
          try {
            const res  = await fetch('/api/confirm-guarantor',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({token:'${safeToken}',action})
            });
            const data = await res.json();
            if(!res.ok||!data.success) throw new Error(data.error||'Request failed');
            btns.style.display='none';
            msg.innerHTML = action==='confirm' ? \`
              <div class="sbox sbox-ok">
                <div class="sicon">✅</div>
                <div class="stitle">Confirmed — thank you!</div>
                <div class="ssub">You are now registered as guarantor for <strong>${borrower}</strong>. The Loan Officer will review the application next.</div>
              </div>\` : \`
              <div class="sbox sbox-no">
                <div class="sicon">❌</div>
                <div class="stitle">Declined</div>
                <div class="ssub"><strong>${borrower}</strong> will be notified and will need to select another guarantor.</div>
              </div>\`;
          } catch(e) {
            document.querySelectorAll('.btn').forEach(b=>b.disabled=false);
            document.getElementById('btn-confirm').textContent='✅ Confirm as Guarantor';
            document.getElementById('btn-decline').textContent='❌ Decline';
            msg.innerHTML=\`<div style="background:#ffebee;border:1px solid #ffcdd2;border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:12px;color:#c62828">⚠️ \${e.message} — please try again.</div>\`;
          }
        }
      <\/script>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>BIDA — Guarantor Confirmation</title>
  <style>${css}</style>
</head>
<body>
  <div class="card">
    <div class="hdr">
      <div class="logo-box"><span>BIDA</span></div>
      <div class="tagline">Multi-Purpose Co-operative Society</div>
      <div class="badge">🤝 Guarantor Confirmation</div>
    </div>
    <div class="body">${bodyContent}</div>
    <div class="ftr">Bida Multi-Purpose Co-operative Society &nbsp;·&nbsp; Secure one-time link</div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // ── GET — serve HTML page ───────────────────────────────────────
  if (req.method === "GET") {
    const { token } = req.query;

    // Helper to send error HTML
    const sendError = (status, title, msg) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).send(buildPage({ errorTitle: title, errorMsg: msg }));
    };

    if (!token) {
      return sendError(400, "Invalid Link",
        "No confirmation token was provided. Please use the link from your email.");
    }

    try {
      // Look up guarantor by token
      const rows = await db(
        "GET", "loan_guarantors",
        `confirmation_token=eq.${encodeURIComponent(token)}&limit=1`
      );

      if (!rows?.length) {
        return sendError(404, "Link Not Found",
          "This confirmation link is invalid or does not exist. Contact the BIDA manager if you believe this is an error.");
      }

      const guarantor = rows[0];

      // Check token expiry
      if (guarantor.token_expires_at && new Date(guarantor.token_expires_at) < new Date()) {
        return sendError(410, "Link Expired",
          "This confirmation link expired 7 days after the loan was submitted. Ask the borrower to re-submit their loan request.");
      }

      // Fetch loan details
      const loanRows = await db(
        "GET", "loan_requests",
        `id=eq.${guarantor.loan_request_id}&limit=1`
      );
      const loan = loanRows?.[0] || null;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(buildPage({
        guarantor,
        loan,
        token,
        alreadyResponded: !!(guarantor.confirmed || guarantor.declined),
      }));

    } catch (err) {
      console.error("[confirm-guarantor] GET error:", err);
      return sendError(500, "Server Error",
        "A temporary error occurred loading this page. Please try again or contact the BIDA manager.");
    }
  }

  // ── POST — process confirm / decline ────────────────────────────
  if (req.method === "POST") {
    try {
      const { token, action } = req.body || {};

      if (!token || !action) {
        return res.status(400).json({ success: false, error: "Missing token or action" });
      }
      if (!["confirm", "decline"].includes(action)) {
        return res.status(400).json({ success: false, error: "action must be 'confirm' or 'decline'" });
      }

      // Fetch guarantor
      const rows = await db(
        "GET", "loan_guarantors",
        `confirmation_token=eq.${encodeURIComponent(token)}&limit=1`
      );
      if (!rows?.length) {
        return res.status(404).json({ success: false, error: "Token not found" });
      }

      const guarantor = rows[0];

      // Already responded?
      if (guarantor.confirmed || guarantor.declined) {
        return res.status(409).json({ success: false, error: "Already responded to this request" });
      }

      // Expired?
      if (guarantor.token_expires_at && new Date(guarantor.token_expires_at) < new Date()) {
        return res.status(410).json({ success: false, error: "Token has expired" });
      }

      const now = new Date().toISOString();
      const ip  = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
               || req.headers["x-real-ip"]
               || req.socket?.remoteAddress
               || null;
      const ua  = req.headers["user-agent"] || null;

      // Update loan_guarantors
      await db("PATCH", "loan_guarantors", `id=eq.${guarantor.id}`, {
        confirmed:          action === "confirm",
        declined:           action === "decline",
        confirmed_at:       action === "confirm" ? now : null,
        responded_at:       now,
        confirmation_ip:    ip,
        confirmation_agent: ua,
      });

      // Advance loan_requests status
      const newLoanStatus = action === "confirm" ? "under_review" : "guarantor_declined";
      await db("PATCH", "loan_requests", `id=eq.${guarantor.loan_request_id}`, {
        status:     newLoanStatus,
        updated_at: now,
      });

      return res.status(200).json({ success: true, action });

    } catch (err) {
      console.error("[confirm-guarantor] POST error:", err);
      return res.status(500).json({ success: false, error: "Server error: " + err.message });
    }
  }

  // ── Method not allowed ──────────────────────────────────────────
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ success: false, error: "Method not allowed" });
}
