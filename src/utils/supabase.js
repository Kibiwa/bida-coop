// src/utils/supabase.js
// ── IMPORTANT: Uses the same Supabase project as the manager app ──
const URL  = "https://oscuauaifgaeauzvkihu.supabase.co";
const KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY3VhdWFpZmdhZWF1enZraWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NTU2MzEsImV4cCI6MjA4OTEzMTYzMX0.tsdr1vL7Q5DcrSt-0AMHeWpxfXCWvi4KXuYuYoLblI0";

async function rest(method, table, body, query) {
  const url = `${URL}/rest/v1/${table}${query ? "?" + query : ""}`;
  const h = { "Content-Type":"application/json", "apikey":KEY, "Authorization":"Bearer "+KEY };
  if (method==="POST")  h["Prefer"] = "resolution=merge-duplicates,return=representation";
  if (method==="PATCH") h["Prefer"] = "return=representation";
  const r = await fetch(url, { method, headers:h, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.text()) || r.status);
  if (r.status===204) return [];
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

export const db = {
  get:    (table, q="")    => rest("GET",   table, null, q),
  insert: (table, row)     => rest("POST",  table, Array.isArray(row) ? row : [row]),
  update: (table, q, data) => rest("PATCH", table, data, q),
  del:    (table, q)       => rest("DELETE", table, null, q),
};

export const fmt   = n => n == null ? "—" : "UGX " + Number(n).toLocaleString("en-UG");
export const fmtD  = d => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
export const fmtDT = d => d ? new Date(d).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";

export function normPhone(raw) {
  const d = raw.replace(/[\s\-().+]/g, "");
  if (/^256\d{9}$/.test(d)) return d;
  if (/^0\d{9}$/.test(d))   return "256" + d.slice(1);
  if (/^\d{9}$/.test(d))    return "256" + d;
  return null;
}

export async function fingerprint() {
  try {
    const raw = [navigator.userAgent, navigator.language, screen.colorDepth,
      screen.width + "x" + screen.height, new Date().getTimezoneOffset()].join("|");
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("").slice(0,32);
  } catch { return "unknown"; }
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}
