import React from "react";
const { useState, useMemo, useEffect } = React;

const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement("script");
  s.src = src; s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});


// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE — Persistent storage + real-time sync across all devices
// ══════════════════════════════════════════════════════════════════════════════
const SUPA_URL = "https://gzoafxyinwysstpixlclw.supabase.co";
const SYNC_INTERVAL_MS = 15000; // poll every 15 seconds for cross-device sync
// anon/public key — safe to ship in frontend code.
// Security enforced by Row Level Security on the database, not key secrecy.
// Supabase explicitly designed this key to be public.
const SUPA_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6b2FmeHlpbnd5c3RwaXhsY2x3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNzgzNDUsImV4cCI6MjA4Nzg1NDM0NX0.5RL38BcXpa_KYhRwLMeJwshGtFzEKZNF8xt9qbsx_nw";

let SUPA_KEY = SUPA_ANON_KEY;
function getSupaKey(){ return localStorage.getItem("bida_supa_key")||SUPA_ANON_KEY; }
function setSupaKey(k){ localStorage.setItem("bida_supa_key",k); SUPA_KEY=k; }
SUPA_KEY = SUPA_ANON_KEY; // Always start with hardcoded key — localStorage overrides if set

// Simple fetch wrapper for Supabase REST API
async function supa(method, table, body=null, query=""){
  const key=SUPA_KEY||getSupaKey();
  if(!key) throw new Error("Supabase API key not set.");
  const url=SUPA_URL+"/rest/v1/"+table+(query?"?"+query:"");
  // POST (upsert): merge-duplicates tells Supabase to UPDATE on conflict
  // GET: no Prefer header — it causes PostgREST to error on reads
  const headers={
    "Content-Type":"application/json",
    "apikey":key,
    "Authorization":"Bearer "+key,
  };
  if(method==="POST"){
    headers["Prefer"]="resolution=merge-duplicates,return=representation";
  }
  let res;
  try{
    res=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined});
  }catch(netErr){
    throw new Error("Network error on "+table+": "+netErr.message);
  }
  if(!res.ok){
    const err=await res.text().catch(()=>"unknown error");
    throw new Error("Supabase "+method+" "+table+" ("+res.status+"): "+err);
  }
  if(method==="DELETE"||res.status===204) return [];
  const text=await res.text();
  if(!text||text==="null") return [];
  try{ return JSON.parse(text); }catch(e){ return []; }
}

// Upsert array of records into a table — safe for concurrent multi-user writes
// Uses PostgreSQL upsert (INSERT ... ON CONFLICT DO UPDATE) via Supabase Prefer header
async function supaUpsert(table, rows){
  if(!rows||!rows.length) return;
  // Retry once on transient failure (handles simultaneous saves from different devices)
  try{
    await supa("POST", table, rows);
  }catch(e){
    // Wait 500ms and retry once — handles race conditions between concurrent users
    await new Promise(r=>setTimeout(r,500));
    await supa("POST", table, rows);
  }
}

// Fetch all rows from a table
async function supaFetch(table){ 
  try{ return await supa("GET", table, null, "order=id"); }
  catch(e){ console.warn("supaFetch("+table+") failed:",e.message); return []; }
}

// Delete a record by id
async function supaDelete(table, id){ return supa("DELETE", table, null, "id=eq."+id); }

// Offline queue — operations done while offline, replayed when back online
const OFFLINE_Q_KEY="bida_offline_q";
function offlineQ(){ try{return JSON.parse(localStorage.getItem(OFFLINE_Q_KEY)||"[]");}catch{return[];} }
function saveOfflineQ(q){ localStorage.setItem(OFFLINE_Q_KEY,JSON.stringify(q)); }
function queueOp(op){ const q=offlineQ(); q.push({...op,ts:Date.now()}); saveOfflineQ(q); }

// Replay offline queue when back online
async function replayOfflineQueue(setSync){
  const q=offlineQ();
  if(!q.length) return;
  setSync("syncing");
  const failed=[];
  for(const op of q){
    try{
      if(op.type==="upsert") await supaUpsert(op.table,[op.row]);
      if(op.type==="delete") await supaDelete(op.table,op.id);
    }catch(e){ failed.push(op); console.warn("Offline replay failed:",op,e); }
  }
  saveOfflineQ(failed);
  setSync(failed.length?"error":"synced");
}

// Save one record — tries Supabase, queues if offline
async function saveRecord(table, row, setSync, onError){
  const key=getSupaKey();
  if(!key) return;
  const stamped={...row, last_saved_at: new Date().toISOString()};
  try{
    setSync("syncing");
    await supaUpsert(table,[stamped]);
    setSync("synced");
  }catch(e){
    const msg=e.message||"Unknown error";
    if(!navigator.onLine){
      queueOp({type:"upsert",table,row:stamped});
      setSync("offline");
    } else {
      console.error("Save failed ("+table+"):",msg);
      setSync("error");
      queueOp({type:"upsert",table,row:stamped});
      if(onError) onError(msg);
    }
  }
}

// Delete one record — tries Supabase, queues if offline
async function deleteRecord(table, id, setSync){
  const key=getSupaKey();
  if(!key) return; // No key — skip silently
  try{
    await supaDelete(table,id);
    setSync("synced");
  }catch(e){
    if(!navigator.onLine){
      queueOp({type:"delete",table,id});
      setSync("offline");
    } else {
      console.error("Delete failed ("+table+"):",e.message);
      setSync("error");
    }
  }
}

// Load all data from Supabase on startup
// Sanitise a member row coming back from Supabase —
// coerce all numeric fields regardless of column name casing
function sanitiseMember(r){
  if(!r) return r;
  // approvalTrail and pendingCommissions come back as parsed arrays from JSONB
  const trail = Array.isArray(r.approvalTrail||r.approvaltrail)
    ? (r.approvalTrail||r.approvaltrail)
    : (typeof (r.approvalTrail||r.approvaltrail)==="string"
        ? JSON.parse(r.approvalTrail||r.approvaltrail||"[]")
        : []);
  const commissions = Array.isArray(r.pendingCommissions||r.pendingcommissions)
    ? (r.pendingCommissions||r.pendingcommissions)
    : (typeof (r.pendingCommissions||r.pendingcommissions)==="string"
        ? JSON.parse(r.pendingCommissions||r.pendingcommissions||"[]")
        : []);
  return {
    ...r,
    id:           +r.id||0,
    membership:   +(r.membership||r.Membership||0),
    annualSub:    +(r.annualSub||r.annualsub||r.annual_sub||0),
    monthlySavings: +(r.monthlySavings||r.monthlysavings||r.monthly_savings||0),
    welfare:      +(r.welfare||0),
    shares:       +(r.shares||0),
    voluntaryDeposit: +(r.voluntaryDeposit||r.voluntarydeposit||0),
    approvalStatus: r.approvalStatus||r.approvalstatus||"approved",
    approvalTrail: trail,
    pendingCommissions: commissions,
    nextOfKin:    r.nextOfKin||r.next_of_kin||null,
    // Contact & profile fields
    phone:        r.phone||r.Phone||"",
    whatsapp:     r.whatsapp||r.Whatsapp||"",
    email:        r.email||r.Email||"",
    address:      r.address||r.Address||"",
    nin:          r.nin||r.NIN||"",
    photoUrl:     r.photoUrl||r.photourl||"",
    // Referral fields
    referralCommission:  +(r.referralCommission||r.referralcommission||0),
    referralSource:       r.referralSource||r.referralsource||"",
    referredByMemberId:   r.referredByMemberId||r.referredbymemberid||null,
    // Payment fields (stored from new member registration)
    payMode:      r.payMode||r.paymode||"cash",
    bankName:     r.bankName||r.bankname||"",
    bankAccount:  r.bankAccount||r.bankaccount||"",
    depositorName:r.depositorName||r.depositorname||"",
    mobileNumber: r.mobileNumber||r.mobilenumber||"",
    transactionId:r.transactionId||r.transactionid||"",
    initialPaymentReceived: !!(r.initialPaymentReceived||r.initialpaymentreceived),
    joinDate:     r.joinDate||r.joindate||null,
  };
}
function sanitiseLoan(r){
  if(!r) return r;
  const trail = Array.isArray(r.approvalTrail||r.approvaltrail)
    ? (r.approvalTrail||r.approvaltrail)
    : (typeof (r.approvalTrail||r.approvaltrail)==="string"
        ? JSON.parse(r.approvalTrail||r.approvaltrail||"[]")
        : []);
  const payments = Array.isArray(r.payments)
    ? r.payments
    : (typeof r.payments==="string" ? JSON.parse(r.payments||"[]") : []);
  return {
    ...r,
    id:             +r.id||0,
    memberId:       +(r.memberId||r.memberid||0),
    amountLoaned:   +(r.amountLoaned||r.amountloaned||0),
    amountPaid:     +(r.amountPaid||r.amountpaid||0),
    processingFeePaid: +(r.processingFeePaid||r.processingfeepaid||0),
    term:           +(r.term||12),
    approvalStatus: r.approvalStatus||r.approvalstatus||"approved",
    approvalTrail:  trail,
    payments:       payments,
  };
}
function sanitiseExpense(r){
  if(!r) return r;
  return {
    ...r,
    id:+r.id||0,
    amount:+(r.amount||0),
    // Default approval status for all existing expenses — they are pre-approved
    expApprovalStatus: r.expApprovalStatus||"approved",
    expApprovedBy:     r.expApprovedBy||"",
    expApprovedAt:     r.expApprovedAt||"",
    expRejectionReason:r.expRejectionReason||"",
  };
}
function sanitiseInvestment(r){
  if(!r) return r;
  return {
    ...r,
    id:             +r.id||0,
    amount:         +(r.amount||0),
    interestEarned: +(r.interestEarned||r.interestearned||0),
  };
}

async function loadAllFromSupabase(){
  const [rawMembers,rawLoans,rawExpenses,rawInvestments,providers,receipts,ledger,auditLog,settings,rawContribLog,rawDividendPayouts]=await Promise.all([
    supaFetch("members"),
    supaFetch("loans"),
    supaFetch("expenses"),
    supaFetch("investments"),
    supaFetch("service_providers"),
    supaFetch("receipts").catch(()=>[]),
    supaFetch("contrib_log").catch(()=>[]),
    supaFetch("dividend_payouts").catch(()=>[]),
    supaFetch("ledger").catch(()=>[]),
    supaFetch("audit_log").catch(()=>[]),
    supaFetch("settings").catch(()=>[]),
  ]);
  // Apply any PINs stored in Supabase settings
  if(Array.isArray(settings)){
    settings.forEach(row=>{
      if(row.key&&row.key.startsWith("pin_")&&row.value){
        const role=row.key.replace("pin_","");
        savePin(role,row.value);
      }
    });
  }
  // Sanitise all numeric fields so no string values corrupt the cash formula
  const members     = Array.isArray(rawMembers)     ? rawMembers.map(sanitiseMember)     : [];
  const loans       = Array.isArray(rawLoans)       ? rawLoans.map(sanitiseLoan)         : [];
  const expenses    = Array.isArray(rawExpenses)    ? rawExpenses.map(sanitiseExpense)   : [];
  const investments = Array.isArray(rawInvestments) ? rawInvestments.map(sanitiseInvestment) : [];
  return {members,loans,expenses,investments,serviceProviders:providers||[],receipts,ledger,auditLog,contribLog:rawContribLog||[],dividendPayouts:rawDividendPayouts||[]};
}

const fmt   = (n) => n == null ? "—" : "UGX " + Number(n).toLocaleString("en-UG");
const fmtN  = (n) => n == null ? "0" : Number(n).toLocaleString("en-UG");
const fmtD  = (d) => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const toStr = () => { const n=new Date(); return n.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})+" at "+n.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}); };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthsElapsed(from, to) {
  if (!from) return 0;
  const a = new Date(from), b = to ? new Date(to) : new Date();
  if (isNaN(a)||isNaN(b)) return 0;
  return Math.max(0,(b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth()));
}

function calcLoan(l, _ignored) {
  const p    = l.amountLoaned || 0;
  const isReducing = p >= 7000000;
  const rate = isReducing ? 0.06 : 0.04;
  const TERM = isReducing ? 12 : (l.term || 12);
  const to   = l.status === "paid" ? l.datePaid : null;
  const mo   = monthsElapsed(l.dateBanked, to);
  const paid = l.amountPaid || 0;
  const method = isReducing ? "reducing" : "flat";
  if (isReducing) {
    const principalPerMonth = Math.round(p / TERM);
    let balance = p; let totalInterest = 0; const schedule = [];
    for (let i = 0; i < TERM; i++) {
      const intThisMonth = Math.round(balance * rate);
      const payment = principalPerMonth + intThisMonth;
      totalInterest += intThisMonth;
      schedule.push({ payment, interest: intThisMonth, principal: principalPerMonth, balanceAfter: balance - principalPerMonth });
      balance -= principalPerMonth;
    }
    const totalDue = p + totalInterest;
    const balSimple = Math.max(0, totalDue - paid);
    const profit = l.status === "paid" ? (l.processingFeePaid || 0) + totalInterest : 0;
    const monthlyPayment = schedule[0]?.payment || 0;
    const monthlyInt = schedule[0]?.interest || Math.round(p * rate);
    return { method, monthlyInt, monthlyPayment, months: mo, totalInterest, totalDue, amountPaid: paid, balance: balSimple, profit, term: TERM, rate };
  } else {
    const mi = Math.round(p * rate);
    const totalInterest = mi * TERM;
    const due = p + totalInterest;
    const bal = Math.max(0, due - paid);
    const monthlyPayment = Math.round(p / TERM) + mi;
    const ti = mi * mo;
    const profit = l.status === "paid" ? (l.processingFeePaid || 0) + ti : 0;
    return { method, monthlyInt: mi, monthlyPayment, months: mo, totalInterest, totalDue: due, amountPaid: paid, balance: bal, profit, term: TERM, rate };
  }
}

const totBanked   = (m) => (m.membership||0)+(m.annualSub||0)+(m.monthlySavings||0)+(m.welfare||0)+(m.shares||0)+(m.voluntaryDeposit||0);
const procFee     = (a) => 25000 + 0.01 * a;

// ── BORROW LIMIT: strict 60% of (monthlySavings + welfare) ──
// Defaulters >3 months overdue: principal limit reduced 0.5%/month. >6 months: frozen at 50%.
function monthsOverdue(l){
  if(!l||l.status==="paid"||!l.dateBanked) return 0;
  const issued=new Date(l.dateBanked);
  const dueDate=new Date(issued.getFullYear(),issued.getMonth()+(l.term||12),issued.getDate());
  const overdueDays=Math.floor((new Date()-dueDate)/(1000*60*60*24));
  return overdueDays>0?Math.floor(overdueDays/30):0;
}
function borrowCapacityRate(m,loans){
  const maxOD=(loans||[]).filter(l=>l.memberId===m.id&&l.status!=="paid").reduce((mx,l)=>Math.max(mx,monthsOverdue(l)),0);
  return maxOD>=6?0.50:0.60;
}
function defaultPrincipalPenalty(m,loans){
  const maxOD=(loans||[]).filter(l=>l.memberId===m.id&&l.status!=="paid").reduce((mx,l)=>Math.max(mx,monthsOverdue(l)),0);
  return maxOD<=3?0:Math.min((maxOD-3)*0.005,0.20);
}
function effectiveBorrowLimit(m,loans){
  const base=(m.monthlySavings||0)+(m.welfare||0);
  return Math.round(base*borrowCapacityRate(m,loans||[])*(1-defaultPrincipalPenalty(m,loans||[])));
}
const borrowLimit=(m,loans)=>effectiveBorrowLimit(m,loans||[]);
// Service provider compliance: must have membership, annualSub >= 50,000, monthlySavings > 0
const isProviderCompliant=(m)=>m&&(m.membership||0)>=50000&&(m.annualSub||0)>=50000&&(m.monthlySavings||0)>0;
const spExpiryDate=(sp)=>{
  if(!sp.registeredDate)return null;
  const d=new Date(sp.registeredDate);
  d.setMonth(d.getMonth()+(sp.isMember?12:6));
  return d;
};
const spIsActive=(sp)=>{const e=spExpiryDate(sp);return e?new Date()<=e:false;};

const INIT_MEMBERS = [
  {id:1,name:"LUKULA PATRICK",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:60000,welfare:40000,shares:150000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:2,name:"NAMWASE LOY",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:1030000,welfare:550000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:3,name:"BIRUNGI SHEILLA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:385000,welfare:285000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:4,name:"GANDI FRED K",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:935000,welfare:300000,shares:350000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:5,name:"BAZIRA RONALD JO",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:220000,welfare:150000,shares:250000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:6,name:"MUGAYA ROBERT",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:130000,welfare:120000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:7,name:"WANYANA JULIET",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:120000,welfare:110000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:8,name:"KITAKUULE BINASALI",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:850000,welfare:360000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:9,name:"KITAKUULE NASUR",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:10,name:"KISAMBIRA HASSAN",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:250000,welfare:200000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:11,name:"BAFUMBA SARAH",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:50000,welfare:60000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:12,name:"TEZUKUUBA FAROUK",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:10000,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:13,name:"KATUNTU HANNAH",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:210000,welfare:210000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:15,name:"KANKWENZI HELLEN",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:105000,welfare:60000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:16,name:"MUKESI DAVID",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:100000,welfare:70000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:17,name:"ITTAZI CHRISTOPHER",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:45000,welfare:40000,shares:150000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:18,name:"KIFUMBA SUMIN",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:19,name:"WOTAKYALA SAM",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:160000,welfare:90000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:20,name:"WOTAKYALA HAAWA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:110000,welfare:140000,shares:250000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:21,name:"JOSEPH KAWUBIRI",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:22,name:"LOVINA TEZIKUBA",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:23,name:"KAMIS KAYIMA",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:35000,welfare:20000,shares:150000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:24,name:"NAKAZIBWE FAITH",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:25,name:"KASIIRA ZIRABA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:700000,welfare:360000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:26,name:"ZIRABA YUSUF",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:140000,welfare:80000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:27,name:"JULIET TIGATEGE",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:660000,welfare:400000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:28,name:"KATUKO ZOE",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:990000,welfare:480000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:29,name:"BOGERE SWALIK",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:30,name:"MUKOOBA JULIUS",email:"",whatsapp:"",membership:50000,annualSub:100000,monthlySavings:50000,welfare:40000,shares:100000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:31,name:"ZIRABA AIDHA",email:"",whatsapp:"",membership:50000,annualSub:100000,monthlySavings:50000,welfare:60000,shares:100000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:33,name:"KATUBE AZIAZ",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:60000,welfare:40000,shares:150000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:34,name:"TIBAKAWA SUZAN",email:"",whatsapp:"",membership:50000,annualSub:100000,monthlySavings:110000,welfare:40000,shares:100000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:35,name:"BALWANA JOHNNY",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:36,name:"MWASE PATRICK",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:200000,welfare:100000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:37,name:"NAMULONDO SHAMIRA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:140000,welfare:150000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:38,name:"NDIKUWA MISHA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:240000,welfare:100000,shares:200000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:39,name:"BABIRYE OLIVIA",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:70000,welfare:80000,shares:100000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:40,name:"WAISWA DAMIENO",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:41,name:"BABIRYE REBECCA",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:42,name:"BALWANA SUZAN",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:43,name:"EDWARD BAZIRA",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:0,welfare:20000,shares:100000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:44,name:"ROBINA KALINAKI",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:20000,welfare:0,shares:50000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:45,name:"BAKITA JOYCE",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:300000,welfare:200000,shares:300000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:46,name:"MUNABI AGGREY",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:47,name:"NASONGOLA ARON",email:"",whatsapp:"",membership:50000,annualSub:20000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
  {id:48,name:"KAGODA MOSES",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:50000,welfare:50000,shares:100000,joinDate:"2024-01-01",approvalStatus:"approved",approvalTrail:[]},
];

const INIT_LOANS = [
  {id:1,memberId:13,memberName:"KATUNTU HANNAH",dateBanked:"2025-09-01",amountLoaned:1000000,processingFeePaid:60000,datePaid:"",amountPaid:0,status:"active",term:12,approvalStatus:"approved",approvalTrail:[]},
  {id:2,memberId:16,memberName:"MUKESI DAVID",dateBanked:"2025-09-01",amountLoaned:550000,processingFeePaid:55500,datePaid:"",amountPaid:0,status:"active",term:12,approvalStatus:"approved",approvalTrail:[]},
  {id:3,memberId:28,memberName:"KATUKO ZOE",dateBanked:"2025-09-01",amountLoaned:1000000,processingFeePaid:60000,datePaid:"2025-09-30",amountPaid:1040000,status:"paid",term:1,approvalStatus:"approved",approvalTrail:[]},
];

const INIT_INVESTMENTS = [];
const SAVINGS_CHART_DATA = [{"month": "2022 Q1", "total": 2850000, "label": "Q1 2022"}, {"month": "2022 Q2", "total": 5200000, "label": "Q2 2022"}, {"month": "2022 Q3", "total": 7100000, "label": "Q3 2022"}, {"month": "2022 Q4", "total": 9800000, "label": "Q4 2022"}, {"month": "2023 Q1", "total": 12400000, "label": "Q1 2023"}, {"month": "2023 Q2", "total": 15600000, "label": "Q2 2023"}, {"month": "2023 Q3", "total": 18200000, "label": "Q3 2023"}, {"month": "2023 Q4", "total": 20500000, "label": "Q4 2023"}, {"month": "2024 Q1", "total": 22800000, "label": "Q1 2024"}, {"month": "2024 Q2", "total": 24500000, "label": "Q2 2024"}, {"month": "2024 Q3", "total": 26100000, "label": "Q3 2024"}, {"month": "2024 Q4", "total": 27400000, "label": "Q4 2024"}, {"month": "2025 Q1", "total": 28100000, "label": "Q1 2025"}, {"month": "2025 Q2", "total": 28500000, "label": "Q2 2025"}, {"month": "2025 Q3", "total": 28760000, "label": "Q3 2025 (Current)"}];
const EXPENSES_CHART_DATA = [{"month": "2022-02", "total": 20000, "meetings": 0, "transport": 20000, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2022-03", "total": 200000, "meetings": 200000, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2022-04", "total": 585000, "meetings": 60000, "transport": 125000, "printing": 0, "legal_registration": 400000, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2022-05", "total": 847000, "meetings": 420000, "transport": 0, "printing": 62000, "legal_registration": 150000, "banking": 0, "operations": 122000, "communications": 0, "refunds": 93000}, {"month": "2023-02", "total": 100000, "meetings": 0, "transport": 0, "printing": 100000, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2023-03", "total": 285000, "meetings": 0, "transport": 285000, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2023-04", "total": 390000, "meetings": 120000, "transport": 270000, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2023-06", "total": 320000, "meetings": 0, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 100000, "communications": 20000, "refunds": 200000}, {"month": "2023-07", "total": 895000, "meetings": 105000, "transport": 220000, "printing": 0, "legal_registration": 0, "banking": 270000, "operations": 300000, "communications": 0, "refunds": 0}, {"month": "2023-09", "total": 40000, "meetings": 40000, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2023-11", "total": 150000, "meetings": 150000, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2023-12", "total": 100000, "meetings": 0, "transport": 0, "printing": 100000, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2024-01", "total": 280000, "meetings": 60000, "transport": 100000, "printing": 120000, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2024-02", "total": 1110000, "meetings": 170000, "transport": 125000, "printing": 670000, "legal_registration": 135000, "banking": 0, "operations": 10000, "communications": 0, "refunds": 0}, {"month": "2024-04", "total": 120000, "meetings": 120000, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2024-08", "total": 100000, "meetings": 0, "transport": 100000, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2024-09", "total": 100000, "meetings": 0, "transport": 100000, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2025-03", "total": 2103000, "meetings": 1403000, "transport": 200000, "printing": 0, "legal_registration": 500000, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2025-04", "total": 250000, "meetings": 250000, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2025-08", "total": 25000, "meetings": 25000, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}, {"month": "2025-09", "total": 80000, "meetings": 80000, "transport": 0, "printing": 0, "legal_registration": 0, "banking": 0, "operations": 0, "communications": 0, "refunds": 0}];
const INIT_EXPENSES    = [
  {id:1,date:"2022-02-15",activity:"Transport to pick cashflow book",amount:20000,issuedBy:"WANYANA JULIET",category:"transport",payMode:"cash",purpose:"Operations",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:2,date:"2022-03-03",activity:"Venue at Bistrona — inaugural meeting",amount:100000,issuedBy:"WANYANA JULIET",category:"meetings",payMode:"cash",purpose:"Meeting",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:3,date:"2022-03-05",activity:"Facilitation payment",amount:100000,issuedBy:"LUBAALE ANGELLA",category:"meetings",payMode:"cash",purpose:"Meeting facilitation",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:4,date:"2022-04-15",activity:"Printing all BIDA documents plus transport",amount:125000,issuedBy:"WANYANA JULIET",category:"printing",payMode:"cash",purpose:"Printing",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:5,date:"2022-04-15",activity:"Refund to Binnasali for venue 2/4/2022",amount:60000,issuedBy:"HAJJI BINNASALI",category:"refunds",payMode:"cash",purpose:"Refund",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:6,date:"2022-04-16",activity:"Bank account opening costs",amount:320000,issuedBy:"GANDI FRED K",category:"banking",payMode:"bank",purpose:"Account opening",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:7,date:"2022-04-16",activity:"BIDA trading licence",amount:80000,issuedBy:"HAJJI BINNASALI",category:"legal_registration",payMode:"cash",purpose:"Legal",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:8,date:"2022-05-05",activity:"BIDA SACCO meeting at Bistrona",amount:100000,issuedBy:"BAIRA RICHARD",category:"meetings",payMode:"cash",purpose:"Meeting",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:9,date:"2022-05-15",activity:"Designing BIDA by-laws",amount:100000,issuedBy:"WANYANA JULIET",category:"legal_registration",payMode:"cash",purpose:"Legal documentation",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:10,date:"2022-05-20",activity:"TIN registration",amount:50000,issuedBy:"BINNASALI KITAKKULE",category:"legal_registration",payMode:"cash",purpose:"Legal",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:11,date:"2022-05-20",activity:"Meeting facilitation at Kasaka 16/4/2022",amount:100000,issuedBy:"MWASE PATRICK",category:"meetings",payMode:"cash",purpose:"Meeting",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:12,date:"2022-05-20",activity:"Minute book purchase",amount:12000,issuedBy:"WANYANA JULIET",category:"printing",payMode:"cash",purpose:"Stationery",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:13,date:"2022-05-20",activity:"Plastic burner purchase",amount:70000,issuedBy:"WANYANA JULIET",category:"operations",payMode:"cash",purpose:"Office equipment",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:14,date:"2022-05-20",activity:"Temporary BIDA office payment",amount:52000,issuedBy:"ME MUTESI",category:"operations",payMode:"cash",purpose:"Office",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:15,date:"2022-05-20",activity:"Transport to Nansana meeting",amount:35000,issuedBy:"WANYANA JULIET",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:16,date:"2022-05-20",activity:"Facilitation data and airtime",amount:50000,issuedBy:"WANYANA JULIET",category:"communications",payMode:"cash",purpose:"Communications",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:17,date:"2022-05-20",activity:"Marther fees refund — Bafumba Sarah",amount:93000,issuedBy:"BAFUMBA SARAH",category:"refunds",payMode:"cash",purpose:"Refund",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:18,date:"2022-05-20",activity:"Purchase of cooperative books",amount:50000,issuedBy:"NAMULAWA ZABIA",category:"printing",payMode:"cash",purpose:"Stationery",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:19,date:"2022-05-20",activity:"3 meetings facilitation — Hajj and Chair (Dec/Aug/2022)",amount:135000,issuedBy:"WANYANA JULIET",category:"meetings",payMode:"cash",purpose:"Meeting facilitation",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:20,date:"2023-02-24",activity:"Phone and lines — designing BIDA documents",amount:100000,issuedBy:"AIDHA ZIRABA",category:"communications",payMode:"cash",purpose:"Communications",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:21,date:"2023-03-25",activity:"Printing and transport",amount:165000,issuedBy:"AIDHA ZIRABA",category:"printing",payMode:"cash",purpose:"Printing",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:22,date:"2023-03-25",activity:"Transport — chairman to sign BIDA documents",amount:20000,issuedBy:"WANYANA JULIET",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:23,date:"2023-03-27",activity:"Transport — BIDA members to sign documents",amount:100000,issuedBy:"MUKESI DAVID",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:24,date:"2023-04-26",activity:"Meals and refreshments during meeting at Kasaka",amount:120000,issuedBy:"MUKESI DAVID",category:"meetings",payMode:"cash",purpose:"Meeting",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:25,date:"2023-04-28",activity:"Transport — chairman, secretary, treasurer",amount:70000,issuedBy:"MUKESI DAVID",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:26,date:"2023-04-28",activity:"Facilitation during BIDA meeting at Kasaka",amount:120000,issuedBy:"MONICA NANSIKO",category:"meetings",payMode:"cash",purpose:"Meeting facilitation",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:27,date:"2023-04-28",activity:"Members files and transport",amount:100000,issuedBy:"MUKESI DAVID",category:"operations",payMode:"cash",purpose:"Operations",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:28,date:"2023-04-28",activity:"Transport to treasurer — March and April (4 trips)",amount:100000,issuedBy:"WANYANA JULIET",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:29,date:"2023-06-17",activity:"Refund — Zabia Namulawa",amount:200000,issuedBy:"NAMULAWA ZABIA",category:"refunds",payMode:"cash",purpose:"Refund",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:30,date:"2023-06-18",activity:"Airtime and data",amount:20000,issuedBy:"WANYANA JULIET",category:"communications",payMode:"cash",purpose:"Communications",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:31,date:"2023-06-07",activity:"Transport to BIDA activities",amount:100000,issuedBy:"MULAMBA PETER",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:32,date:"2023-07-09",activity:"Transport and facilitation",amount:40000,issuedBy:"MULAMBA PETER",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:33,date:"2023-07-14",activity:"Transport payment",amount:30000,issuedBy:"MULAMBA PETER",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:34,date:"2023-07-14",activity:"Stamp and transport",amount:65000,issuedBy:"MULAMBA PETER",category:"operations",payMode:"cash",purpose:"Operations",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:35,date:"2023-07-18",activity:"Transport — deliver documents to Kamuli",amount:25000,issuedBy:"MULAMBA PETER",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:36,date:"2023-07-18",activity:"Transport to Commercial Officer",amount:100000,issuedBy:"INHENSICO MONICA",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:37,date:"2023-07-18",activity:"Facilitation to Commercial Officer",amount:105000,issuedBy:"INHENSICO MONICA",category:"meetings",payMode:"cash",purpose:"Meeting facilitation",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:38,date:"2023-07-18",activity:"Payment to Zabia Mulawa",amount:300000,issuedBy:"NAMULAWA ZABIA",category:"refunds",payMode:"cash",purpose:"Refund",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:39,date:"2023-07-30",activity:"Bank charges 2023 (full year)",amount:270000,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:40,date:"2023-11-25",activity:"Facilitation to Commercial Officer",amount:150000,issuedBy:"INHENSICO MONICA",category:"meetings",payMode:"cash",purpose:"Meeting facilitation",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:41,date:"2023-12-04",activity:"Stamp purchase",amount:100000,issuedBy:"MULAMBA PETER",category:"operations",payMode:"cash",purpose:"Operations",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:42,date:"2024-01-11",activity:"Facilitation to treasurer — data and airtime",amount:20000,issuedBy:"WANYANA JULIET",category:"communications",payMode:"cash",purpose:"Communications",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:43,date:"2024-01-11",activity:"Facilitation data and airtime — Aidah Ziraba",amount:20000,issuedBy:"AIDHA ZIRABA",category:"communications",payMode:"cash",purpose:"Communications",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:44,date:"2024-01-11",activity:"Printing headed papers for the coop",amount:120000,issuedBy:"MULAMBA PETER",category:"printing",payMode:"cash",purpose:"Printing",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:45,date:"2024-01-11",activity:"Mukesi transport to Kamuli to see DCO",amount:60000,issuedBy:"MUKESI DAVID",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:46,date:"2024-01-11",activity:"Robina transport — deliver AGM minutes to Kampala",amount:20000,issuedBy:"ROBINA KALINAKI",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:47,date:"2024-01-13",activity:"Mukesi transport Kamuli to Kampala after DCO",amount:40000,issuedBy:"MUKESI DAVID",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:48,date:"2024-02-08",activity:"Facilitation — David to get Aidah and Julie sign board resolution",amount:30000,issuedBy:"MUKESI DAVID",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:49,date:"2024-02-10",activity:"Transport — Mukesi to get Aidah sign board resolution",amount:20000,issuedBy:"MUKESI DAVID",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:50,date:"2024-02-10",activity:"Filing BIDA cooperative returns to URSB",amount:80000,issuedBy:"DAVID KEMBA",category:"legal_registration",payMode:"cash",purpose:"Legal",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:51,date:"2024-02-10",activity:"Change wrong board resolution — David Kemba lawyer",amount:50000,issuedBy:"DAVID KEMBA",category:"legal_registration",payMode:"cash",purpose:"Legal",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:52,date:"2024-02-12",activity:"Transport — chair to Nansana bank (4 trips)",amount:75000,issuedBy:"GANDI FRED K",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:53,date:"2024-02-21",activity:"Transport — bank to open coop account (Juliet)",amount:30000,issuedBy:"WANYANA JULIET",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:54,date:"2024-02-21",activity:"Transport — bank to open coop account (Aidah)",amount:30000,issuedBy:"AIDHA ZIRABA",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:55,date:"2024-02-21",activity:"Affidavit by Aidah for wrong signatures",amount:55000,issuedBy:"AIDHA ZIRABA",category:"legal_registration",payMode:"cash",purpose:"Legal",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:56,date:"2024-02-22",activity:"Banker Brian facilitation — cooperative account opening",amount:30000,issuedBy:"GANDI FRED K",category:"banking",payMode:"bank",purpose:"Account opening",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:57,date:"2024-02-22",activity:"Follow up — cooperative account opening",amount:10000,issuedBy:"GANDI FRED K",category:"banking",payMode:"bank",purpose:"Account opening",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:58,date:"2024-02-26",activity:"Printing BIDA documents (50 passbooks, receipt books, requisitions etc.)",amount:670000,issuedBy:"VINCENT NTALE",category:"printing",payMode:"cash",purpose:"Stationery",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:59,date:"2024-02-26",activity:"Transport — collect printed books from town",amount:30000,issuedBy:"VINCENT NTALE",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:60,date:"2024-04-11",activity:"Sarah Namugoya — cooperative training facilitation",amount:250000,issuedBy:"SARAH NAMUGOOYA",category:"meetings",payMode:"cash",purpose:"Training",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:61,date:"2024-08-10",activity:"Transport to Wagabaza — pick letters for certificate",amount:50000,issuedBy:"MUSITAFA",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:62,date:"2024-08-30",activity:"Transport — pick final letters for permanent certificate",amount:50000,issuedBy:"MUSITAFA",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:63,date:"2024-09-10",activity:"Transport and token to Musitafa for delivering permanent certificate",amount:100000,issuedBy:"MUSITAFA",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
    {id:64,date:"2025-03-20",activity:"Transport — Inhensiko",amount:200000,issuedBy:"MONICA INHENSIKO",category:"transport",payMode:"cash",purpose:"Transport",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:65,date:"2025-03-20",activity:"Printing charges — AGM documents",amount:215000,issuedBy:"MUKESI DAVID",category:"printing",payMode:"cash",purpose:"AGM printing",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:66,date:"2025-03-20",activity:"AGM extra costs — hotel",amount:58000,issuedBy:"MUKESI DAVID",category:"meetings",payMode:"cash",purpose:"AGM",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:67,date:"2025-03-20",activity:"AGM arrangement — withdrew from account and paid hotel",amount:500000,issuedBy:"MUKESI DAVID",category:"meetings",payMode:"bank",purpose:"AGM",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:68,date:"2025-03-20",activity:"Audit for cooperative — Izimba",amount:500000,issuedBy:"MUKESI DAVID",category:"legal_registration",payMode:"cash",purpose:"Audit",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:69,date:"2025-03-20",activity:"AGM arrangement paid to hotel",amount:300000,issuedBy:"MUKESI DAVID",category:"meetings",payMode:"cash",purpose:"AGM",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:70,date:"2025-03-20",activity:"AGM arrangement paid to hotel (2nd payment)",amount:200000,issuedBy:"MUKESI DAVID",category:"meetings",payMode:"cash",purpose:"AGM",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:71,date:"2025-03-29",activity:"AGM arrangements hotel — final payment",amount:130000,issuedBy:"MUKESI DAVID",category:"meetings",payMode:"cash",purpose:"AGM",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:72,date:"2025-08-12",activity:"Musitafa — re-writing BIDA coop AGM minutes",amount:25000,issuedBy:"MUSITAFA",category:"meetings",payMode:"cash",purpose:"Secretarial",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:73,date:"2025-09-16",activity:"Musitafa — re-writing BIDA coop AGM minutes (2nd payment)",amount:35000,issuedBy:"MUSTAFA",category:"meetings",payMode:"cash",purpose:"Secretarial",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:74,date:"2025-09-16",activity:"Refreshments — Fred, Rogers and Mustafa",amount:45000,issuedBy:"GANDI FRED K",category:"meetings",payMode:"cash",purpose:"Meeting",bankName:"",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:75,date:"2025-02-01",activity:"Bank charges — February 2025",amount:17483,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:76,date:"2025-03-01",activity:"Bank charges — March 2025",amount:1368,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:77,date:"2025-04-01",activity:"Bank charges — April 2025",amount:12689,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:78,date:"2025-05-01",activity:"Bank charges — May 2025",amount:1490,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:79,date:"2025-06-01",activity:"Bank charges — June 2025",amount:1551,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:80,date:"2025-07-01",activity:"Bank charges — July 2025",amount:88353,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:81,date:"2025-08-01",activity:"Bank charges — August 2025",amount:1198,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:82,date:"2025-09-01",activity:"Bank charges — September 2025",amount:1162,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:83,date:"2025-10-01",activity:"Bank charges — October 2025",amount:1205,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""},
  {id:84,date:"2025-11-01",activity:"Bank charges — November 2025",amount:11500,issuedBy:"Stanbic Bank",category:"banking",payMode:"bank",purpose:"Bank charges",bankName:"Stanbic Bank",bankAccount:"",mobileNumber:"",transactionId:"",issuedByPhone:"",issuedByNIN:"",issuedById:"",approvedBy:"",approverPhone:"",approverNIN:"",approverMemberId:"",categoryCustom:"",depositorName:""}
]
const INIT_RECEIPTS    = [];
// Service providers: BIDA members who provide consistent services
// Must be compliant: active membership, annualSub >= 50,000, monthlySavings > 0
const INIT_SERVICE_PROVIDERS = [];
const INIT_PENDING     = []; // pending approvals queue

// ── AUTH — two users only ──
// PINs managed in USERS block below


// ══════════════════════════════════════════════════════════════════════
// FINTECH LAYER — Role-based access, ledger, audit trail, risk controls
// ══════════════════════════════════════════════════════════════════════

// ROLES with permission matrix
const ROLES = {
  admin:        { label:"Administrator",  can:["all"] },
  treasurer:    { label:"Treasurer",      can:["view","savings","loans","expenses","investments","reports","settings","approve","disburse"] },
  loan_officer: { label:"Loan Officer",   can:["view","loans","reports"] },
  auditor:      { label:"Auditor",        can:["view","reports","audit"] },
  finance_mgr:  { label:"Finance Manager",can:["view","savings","loans","expenses","investments","reports"] },
  member:       { label:"Member",         can:["view","own_profile"] },
};

// ══════════════════════════════════════════════════════════════
// 4-STEP APPROVAL WORKFLOW
// Step 1: Treasurer initiates
// Step 2: Finance Manager reviews numbers
// Step 3: Administrator approves governance
// Step 4: Auditor gives final stamp → PDF generated
// ══════════════════════════════════════════════════════════════

const APPROVAL_STEPS = [
  { step:1, role:"treasurer",     label:"Treasurer",        action:"Initiated",  verb:"Initiate"  },
  { step:2, role:"finance_mgr",   label:"Finance Manager",  action:"Reviewed",   verb:"Review"    },
  { step:3, role:"admin",         label:"Administrator",    action:"Approved",   verb:"Approve"   },
  { step:4, role:"auditor",       label:"Auditor",          action:"Stamped",    verb:"Final Stamp"},
];

const APPROVAL_STATUS = {
  draft:        { label:"Draft",              color:"#757575", bg:"#f5f5f5"  },
  step1_done:   { label:"Pending Finance",    color:"#1565c0", bg:"#e3f2fd"  },
  step2_done:   { label:"Pending Admin",      color:"#e65100", bg:"#fff3e0"  },
  step3_done:   { label:"Pending Audit",      color:"#6a1b9a", bg:"#f3e5f5"  },
  approved:     { label:"✅ Fully Approved",  color:"#1b5e20", bg:"#e8f5e9"  },
  rejected:     { label:"❌ Rejected",        color:"#c62828", bg:"#ffebee"  },
};

// Get next step info for a given current status
const getNextStep = (status) => {
  const map = { draft:1, step1_done:2, step2_done:3, step3_done:4 };
  const stepNum = map[status];
  if(!stepNum) return null;
  return APPROVAL_STEPS.find(s=>s.step===stepNum)||null;
};

// Can this user act on this item?
const canActOn = (authUser, item) => {
  if(!authUser||!item) return false;
  const next = getNextStep(item.approvalStatus||"draft");
  if(!next) return false;
  return authUser.role === next.role;
};

// Build an approval record
const mkApprovalStep = (step, actor, decision, note) => ({
  step,
  role: actor.role,
  name: actor.name,
  decision,   // "approved" | "rejected"
  note: note||"",
  ts: new Date().toISOString(),
  date: new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),
  time: new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),
});

// Advance status after approval
const advanceStatus = (currentStatus) => {
  const map = { draft:"step1_done", step1_done:"step2_done", step2_done:"step3_done", step3_done:"approved" };
  return map[currentStatus]||currentStatus;
};

const canDo=(user,action)=>{if(!user)return false;const r=ROLES[user.role];if(!r)return false;return r.can.includes("all")||r.can.includes(action);};

// Extended USERS with roles (keeps existing PINs)
// Default PINs — immediately overridden by any saved PINs from Settings
const DEFAULT_PINS = {
  treasurer:"1234", financemanager:"5678", admin:"9999", auditor:"7777"
};
const USER_DEFS = {
  treasurer:     { role:"treasurer",     name:"Treasurer"        },
  financemanager:{ role:"finance_mgr",   name:"Finance Manager"  },
  admin:         { role:"admin",         name:"Administrator"    },
  auditor:       { role:"auditor",       name:"Auditor"          },
};
// Load saved PINs from localStorage (set by Admin in Settings)
function loadSavedPins(){
  try{ return JSON.parse(localStorage.getItem("bida_pins")||"{}"); }
  catch{ return {}; }
}
function getSavedPin(role){
  const saved=loadSavedPins();
  return saved[role]||DEFAULT_PINS[role]||"";
}
function savePin(role,pin){
  const saved=loadSavedPins();
  saved[role]=pin;
  localStorage.setItem("bida_pins",JSON.stringify(saved));
  // Also persist to Supabase so all devices get the new PIN
  const key=getSupaKey();
  if(key){
    supaUpsert("settings",[{key:"pin_"+role,value:pin,updated_at:new Date().toISOString()}])
      .catch(e=>console.warn("PIN sync to Supabase failed:",e.message));
  }
}
function isPinDefault(role){
  return !loadSavedPins()[role];
}
// Build USERS object with current PINs
function buildUsers(){
  return Object.fromEntries(
    Object.entries(USER_DEFS).map(([key,u])=>([key,{...u,pin:getSavedPin(key)}]))
  );
}
const USERS = buildUsers(); // initial build — refreshed on login

// Loan delinquency classification
const classifyLoan=(l)=>{
  const c=calcLoan(l);
  if(l.status==="paid") return {class:"performing",label:"Paid",color:"#2e7d32"};
  const missedMonths=c.months - Math.floor((l.amountPaid||0)/Math.max(c.monthlyPayment,1));
  if(missedMonths<=0) return {class:"performing",label:"Performing",color:"#2e7d32"};
  if(missedMonths<=1) return {class:"watch",label:"Watch",color:"#f57f17"};
  if(missedMonths<=3) return {class:"substandard",label:"Substandard",color:"#e65100"};
  if(missedMonths<=6) return {class:"doubtful",label:"Doubtful",color:"#c62828"};
  return {class:"loss",label:"Loss",color:"#b71c1c"};
};

// Liquidity check before loan approval
const liquidityCheck=(amount,cashInBank,totalInvested)=>{
  const reserve=cashInBank*0.30; // must keep 30% liquid
  const available=cashInBank-totalInvested-reserve;
  return {ok:available>=amount,available:Math.max(0,available),reserve,shortfall:Math.max(0,amount-available)};
};

// Double-entry ledger entry builder
const mkEntry=(type,refId,description,debit,credit,account,actorRole,actorName)=>({
  id:Date.now()+Math.random(),
  ts:new Date().toISOString(),
  type,       // "savings_deposit"|"loan_disbursement"|"loan_repayment"|"expense"|"investment"|"reversal"
  refId,      // reference to parent record
  description,
  debit:debit||0,
  credit:credit||0,
  account,    // "savings_pool"|"loan_book"|"expense_account"|"investment_account"|"welfare_pool"
  actorRole:actorRole||"system",
  actorName:actorName||"System",
  immutable:true,
});

// Audit trail entry builder
const mkAudit=(action,entity,entityId,before,after,actorRole,actorName)=>({
  id:Date.now()+Math.random(),
  ts:new Date().toISOString(),
  action,    // "create"|"edit"|"delete"|"approve"|"reject"|"login"|"config_change"
  entity,    // "member"|"loan"|"expense"|"investment"
  entityId,
  before:before?JSON.stringify(before):null,
  after:after?JSON.stringify(after):null,
  actorRole:actorRole||"system",
  actorName:actorName||"System",
});

// Dividend calculation engine
const calcDividends=(members,loans,expenses,investments,surplusOverride)=>{
  const totalPool=members.reduce((s,m)=>s+totBanked(m),0);
  const totalExpenses=expenses.reduce((s,e)=>s+(+e.amount||0),0);
  const loanProfit=loans.filter(l=>l.status==="paid").reduce((s,l)=>s+calcLoan(l).profit,0);
  const invReturns=investments.reduce((s,i)=>s+(+i.interestEarned||0),0);
  const grossSurplus=loanProfit+invReturns*0.4; // 40% of inv returns distributable
  const statutory=Math.round(grossSurplus*0.20); // 20% statutory reserve
  const operational=Math.round(grossSurplus*0.10); // 10% operational reserve
  const distributable=surplusOverride!=null?surplusOverride:Math.max(0,grossSurplus-statutory-operational);
  const totalShares=members.reduce((s,m)=>s+(m.shares||0),0);
  const perMember=members.map(m=>{
    const shareRatio=totalShares>0?(m.shares||0)/totalShares:0;
    const savingsRatio=totalPool>0?totBanked(m)/totalPool:0;
    const shareDividend=Math.round(distributable*0.60*shareRatio);
    const savingsDividend=Math.round(distributable*0.40*savingsRatio);
    return {...m,shareDividend,savingsDividend,totalDividend:shareDividend+savingsDividend};
  });
  return {grossSurplus,statutory,operational,distributable,perMember,totalShares};
};

// Risk indicators
const riskIndicators=(m,loans)=>{
  const mLoans=loans.filter(l=>l.memberId===m.id);
  const active=mLoans.filter(l=>l.status!=="paid");
  const totalOwed=active.reduce((s,l)=>s+calcLoan(l).balance,0);
  const savingsBase=(m.monthlySavings||0)+(m.welfare||0);
  const exposureRatio=savingsBase>0?totalOwed/savingsBase:0;
  const hasDelinquent=active.some(l=>classifyLoan(l).class!=="performing");
  const flags=[];
  if(exposureRatio>3) flags.push({level:"high",msg:"Exposure ratio "+exposureRatio.toFixed(1)+"x savings base"});
  if(hasDelinquent) flags.push({level:"high",msg:"Has delinquent loan(s)"});
  if(mLoans.length>2) flags.push({level:"medium",msg:"Multiple loan history ("+mLoans.length+")"});
  if((m.annualSub||0)<50000) flags.push({level:"medium",msg:"Annual sub below threshold"});
  return {flags,risk:flags.some(f=>f.level==="high")?"high":flags.length>0?"medium":"low"};
};

const WELFARE_RATE = 0.40; // 40% of cumulative monthly savings auto-allocated to welfare
const autoWelfare = (monthlySavings) => Math.round((monthlySavings||0) * WELFARE_RATE);
const SHARE_UNIT_VALUE = 50000; // UGX 50,000 per share unit
const shareUnits = (m) => Math.round((m.shares||0)/SHARE_UNIT_VALUE);
const SERVICE_TYPES = ["Printing & Stationery","Transport","Catering & Meetings","Legal & Registration","IT & Communications","Venue & Facilities","Audit & Accounting","Other"];
const EXP_CATEGORIES = ["Operations","Meetings","Transport","Printing","Legal & Registration","Banking","Communications","Welfare Payouts","Refunds","Salaries","Other"];
const INV_TYPE_LABELS = {unit_trust:"Unit Trust",treasury_bond:"Treasury Bond",fixed_deposit:"Fixed Deposit",money_market:"Money Market",other:"Other"};

const emptyInv = {
  id:null, platform:"", type:"unit_trust", amount:"", dateInvested:"",
  investmentYear:new Date().getFullYear(), interestEarned:0, lastUpdated:"", status:"active", notes:"",
  approvalStatus:"pending", approvedByMemberId:"", approvedBy:"", approvalDate:"",
  documents:[], docNames:[]
};

const emptyE = {
  date: new Date().toISOString().split("T")[0],
  activity:"", amount:"", issuedBy:"", issuedByPhone:"", issuedByNIN:"", issuedById:"",
  approvedBy:"", approverPhone:"", approverNIN:"",
  purpose:"", payMode:"cash", bankName:"", bankAccount:"", depositorName:"",
  mobileNumber:"", transactionId:"", category:"operations", categoryCustom:"", bankCharges:0, approverMemberId:"",
  expApprovalStatus:"approved", expApprovedBy:"", expApprovedAt:"", expRejectionReason:""
};
const emptyL = {
  memberId:"", memberName:"", dateBanked:"", amountLoaned:"", processingFeePaid:"",
  datePaid:"", amountPaid:0, status:"active", term:12,
  loanType:"personal", loanPurpose:"",
  borrowerPhone:"", borrowerAddress:"", borrowerNIN:"",
  guarantorName:"", guarantorPhone:"", guarantorAddress:"", guarantorNIN:"", guarantorMemberId:"",
  approvalStatus:"draft", approvalTrail:[], initiatedBy:"", approvedBy:"",
};
const emptyPay = {
  loanId:null, amount:"", date: new Date().toISOString().split("T")[0],
  payMode:"cash", bankName:"", bankAccount:"", depositorName:"",
  mobileNumber:"", transactionId:"", attachmentName:"", attachmentData:""
};



function Avatar({name,size=40,photoUrl}){
  if(photoUrl) return React.createElement("div",{style:{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,border:"2px solid var(--bdr2)"}},React.createElement("img",{src:photoUrl,alt:name,style:{width:"100%",height:"100%",objectFit:"cover"}}));
  const w=name.trim().split(" ");
  const ini=(w[0]?.[0]||"")+(w[1]?.[0]||"");
  const hue=Math.abs(name.split("").reduce((a,c)=>a+c.charCodeAt(0),0))%360;
  return React.createElement("div",{style:{width:size,height:size,borderRadius:"50%",background:"hsl("+hue+",50%,34%)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:size*0.36,flexShrink:0,userSelect:"none"}},ini.toUpperCase());
}

function waNum(raw){if(!raw)return "";const d=raw.replace(/\D/g,"");if(d.startsWith("256")&&d.length>=12)return d;if(d.startsWith("0")&&d.length>=10)return "256"+d.slice(1);return d;}
function waLink(num,text){const n=waNum(num);if(!n)return null;return "https://wa.me/"+n+(text?"?text="+encodeURIComponent(text):"");}

const WA_SVG = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>;

function buildWASavingsMsg(m){const mn=MONTHS[new Date().getMonth()],yr=new Date().getFullYear();return `Dear ${m.name.split(" ")[0]}, this is your BIDA Co-operative Multi-Purpose Society savings reminder for ${mn} ${yr}.\n\nYour monthly contribution of ${fmt(m.monthlySavings)} is due by the 5th.\nTotal banked to date: ${fmt(totBanked(m))}\n\n— BIDA Co-operative Multi-Purpose Society`;}
function buildWALoanMsg(m,loan){const c=calcLoan(loan);return `Dear ${m.name.split(" ")[0]}, this is a BIDA Co-operative loan reminder.\n\nBalance outstanding: ${fmt(c.balance)}\nMonthly payment: ${fmt(c.monthlyPayment)}\nTotal due: ${fmt(c.totalDue)}\n\nPlease arrange payment at your earliest convenience.\n— BIDA Co-operative Multi-Purpose Society`;}
function buildWAStatementMsg(m){
  const mn=MONTHS[new Date().getMonth()],yr=new Date().getFullYear();
  return `Dear ${m.name.split(" ")[0]}, please find your BIDA Co-operative Member Statement attached.

Summary as at ${mn} ${yr}:
  Total Banked:  ${fmt(totBanked(m))}
  Monthly Savings: ${fmt(m.monthlySavings)}
  Welfare:       ${fmt(m.welfare)}
  Shares:        ${fmt(m.shares)}

Thank you for being a valued member.
— BIDA Co-operative Multi-Purpose Society
bidacooperative@gmail.com`;
}
function buildWADueMsg(m,loan){const c=calcLoan(loan);const issued=new Date(loan.dateBanked);const due=new Date(issued.getFullYear(),issued.getMonth()+(loan.term||12),issued.getDate());const dueFmt=due.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});return `⚠️ Dear ${m.name.split(" ")[0]}, your BIDA Co-operative loan of ${fmt(loan.amountLoaned)} is due for full settlement on ${dueFmt}.\n\nBalance due: ${fmt(c.balance)}\nMonthly payment: ${fmt(c.monthlyPayment)}\n\nPlease arrange payment before the due date.\n— BIDA Co-operative Multi-Purpose Society`;}
function buildSMSSavingsMsg(m){const mn=MONTHS[new Date().getMonth()],yr=new Date().getFullYear();return `BIDA Coop: Dear ${m.name.split(" ")[0]}, your ${mn} ${yr} savings of ${fmt(m.monthlySavings)} is due by the 5th. Total: ${fmt(totBanked(m))}.`;}
function buildSMSLoanMsg(m,loan){const c=calcLoan(loan);return `BIDA Coop: Dear ${m.name.split(" ")[0]}, your loan balance is ${fmt(c.balance)}. Monthly pay: ${fmt(c.monthlyPayment)}. Total due: ${fmt(c.totalDue)}.`;}
function buildSMSDueMsg(m,loan,daysLeft){const c=calcLoan(loan);const issued=new Date(loan.dateBanked);const due=new Date(issued.getFullYear(),issued.getMonth()+(loan.term||12),issued.getDate());const dueFmt=due.toLocaleDateString("en-GB",{day:"numeric",month:"short"});return `BIDA Coop: Dear ${m.name.split(" ")[0]}, your loan of ${fmt(loan.amountLoaned)} is due ${dueFmt} (${daysLeft} days). Balance: ${fmt(c.balance)}. Please pay on time.`;}

function buildSavingsEmail(m){const mn=MONTHS[new Date().getMonth()],yr=new Date().getFullYear();return{subj:"BIDA Cooperative — "+mn+" "+yr+" Savings Reminder",body:"Dear "+m.name.split(" ")[0]+",\n\nYour monthly savings contribution of "+fmt(m.monthlySavings)+" is due by the 5th of "+mn+" "+yr+".\n\nYour contributions on record:\n  Membership:      "+fmt(m.membership)+"\n  Annual Sub:      "+fmt(m.annualSub)+"\n  Monthly Savings: "+fmt(m.monthlySavings)+"\n  Welfare:         "+fmt(m.welfare)+"\n  Shares:          "+fmt(m.shares)+"\n  ─────────────────────────\n  Total Banked:    "+fmt(totBanked(m))+"\n\nThank you,\nBIDA Co-operative Multi-Purpose Society\n"+toStr()};}
function buildLoanEmail(m,loan){const c=calcLoan(loan);return{subj:"BIDA Cooperative — Loan Settlement Reminder",body:"Dear "+m.name.split(" ")[0]+",\n\nThis is a reminder that you have an outstanding loan balance with BIDA Co-operative.\n\nLoan Details:\n  Principal:        "+fmt(loan.amountLoaned)+"\n  Issued:           "+fmtD(loan.dateBanked)+"\n  Months elapsed:   "+c.months+"\n  Monthly Payment:  "+fmt(c.monthlyPayment)+"\n  Total due:        "+fmt(c.totalDue)+"\n  ─────────────────────────\n  Outstanding:      "+fmt(c.balance)+"\n\nPlease arrange payment at your earliest convenience.\n\nBIDA Co-operative Multi-Purpose Society\n"+toStr()};}
function buildDueEmail(m,loan){const c=calcLoan(loan);const issued=new Date(loan.dateBanked);const due=new Date(issued.getFullYear(),issued.getMonth()+(loan.term||12),issued.getDate());const dueFmt=due.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});return{subj:"⚠️ BIDA Cooperative — Loan Due in 5 Days: "+dueFmt,body:"Dear "+m.name.split(" ")[0]+",\n\nThis is an automated reminder that your BIDA Co-operative loan is due for full settlement on "+dueFmt+".\n\nLoan Summary:\n  Principal:       "+fmt(loan.amountLoaned)+"\n  Monthly Payment: "+fmt(c.monthlyPayment)+"\n  ─────────────────────────\n  Balance Due:     "+fmt(c.balance)+"\n\nPlease ensure payment is made on or before the due date to avoid your account being marked overdue.\n\nBIDA Co-operative Multi-Purpose Society\n"+toStr()};}

// Convert blob to base64 data URL — works in ALL environments including sandboxed iframes
function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=reject;
    r.readAsDataURL(blob);
  });
}

async function shareViaPDF(blob, filename, memberName){
  // Try native share (mobile)
  if(navigator.canShare&&navigator.canShare({files:[new File([blob],filename,{type:"application/pdf"})]})){
    try{
      await navigator.share({files:[new File([blob],filename,{type:"application/pdf"})],title:"BIDA Cooperative — "+(memberName||"Report"),text:"Please find your BIDA Cooperative statement attached."});
      return "shared";
    }catch(e){if(e.name!=="AbortError")console.warn("Share failed:",e);}
  }
  // Fallback: URL.createObjectURL (works on all platforms unlike data URLs)
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename;
  a.style.cssText="position:fixed;top:-200px;left:-200px;opacity:0";
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);try{document.body.removeChild(a);}catch(e){}},8000);
  return "downloaded";
}

// ── Central PDF loader — loads jsPDF + autoTable once ──
let _jspdfLoaded=false;
async function loadJsPDF(){
  if(_jspdfLoaded&&window.jspdf&&window.jspdf.jsPDF)return;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  _jspdfLoaded=true;
}


// ── LOAN AGREEMENT PDF ──────────────────────────────────────────────────────
async function generateLoanPDF(loan, member, calc){
  await loadJsPDF();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  const NAVY=[13,52,97],BLUE=[21,101,192],WHITE=[255,255,255],GREY=[94,127,160],RED=[198,40,40],GREEN=[27,94,32],BLITE=[227,242,253];
  // Header
  doc.setFillColor(...NAVY);doc.rect(0,0,W,28,"F");
  doc.setFillColor(...BLUE);doc.rect(0,28,W,2,"F");
  (()=>{const cx=22,cy=15,r=8;doc.setFillColor(...BLUE);doc.rect(cx-r,cy-r,r*2,r*2,"F");doc.setFillColor(...WHITE);doc.rect(cx-r*.42,cy+r*.02,r*.20,r*.50,"F");doc.rect(cx-r*.10,cy-r*.26,r*.20,r*.78,"F");doc.rect(cx+r*.22,cy-r*.54,r*.20,r*1.06,"F");})();
  doc.setFont("helvetica","bold");doc.setFontSize(13);doc.setTextColor(...WHITE);doc.text("BIDA",36,12);
  doc.setFont("helvetica","normal");doc.setFontSize(5.5);doc.setTextColor(144,202,249);doc.text("CO-OPERATIVE MULTI-PURPOSE SOCIETY",36,18);
  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...WHITE);doc.text("LOAN AGREEMENT",W/2,12,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(187,222,251);doc.text("Official Loan Disbursement Record — Confidential",W/2,19,{align:"center"});
  doc.setFontSize(7);doc.setTextColor(187,222,251);doc.text("Date: "+toStr(),W-12,12,{align:"right"});doc.text("Loan Ref: #"+loan.id,W-12,18,{align:"right"});
  // Borrower block
  doc.setFillColor(...BLITE);doc.roundedRect(12,36,W-24,22,3,3,"F");
  doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(...NAVY);doc.text("BORROWER DETAILS",16,44);
  doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(40,40,40);
  doc.text("Name: "+member.name,16,51);
  doc.text("Phone: "+(loan.borrowerPhone||member.phone||"—")+"   NIN: "+(loan.borrowerNIN||member.nin||"—"),16,57);
  doc.text("Address: "+(loan.borrowerAddress||member.address||"—"),16,63);
  doc.setFont("helvetica","bold");doc.setFontSize(13);doc.setTextColor(...BLUE);doc.text(fmt(loan.amountLoaned),W-14,50,{align:"right"});
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);doc.text("PRINCIPAL AMOUNT",W-14,56,{align:"right"});
  // Loan terms table
  doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...NAVY);doc.text("LOAN TERMS",14,73);
  const method=calc.method==="reducing"?"6% Reducing Balance":"4% Flat Rate";
  doc.autoTable({startY:77,
    head:[["Item","Details"]],
    body:[
      ["Loan Reference","#"+loan.id],
      ["Principal Amount",fmt(loan.amountLoaned)],
      ["Interest Method",method],
      ["Interest Rate",(calc.rate*100)+"%  per month"],
      ["Repayment Term",calc.term+" months"],
      ["Monthly Payment",fmt(calc.monthlyPayment)],
      ["Total Interest",fmt(calc.totalInterest)],
      ["Total Amount Due",fmt(calc.totalDue)],
      ["Processing Fee",fmt(loan.processingFeePaid||0)],
      ["Date Issued",fmtD(loan.dateBanked)],
      ["Expected Completion",(()=>{if(!loan.dateBanked)return "—";const d=new Date(loan.dateBanked);d.setMonth(d.getMonth()+calc.term);return d.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});})()],
      ["Loan Purpose",loan.loanPurpose||"—"],
      ["Loan Type",(loan.loanType||"personal").charAt(0).toUpperCase()+(loan.loanType||"personal").slice(1)],
    ],
    styles:{fontSize:9,cellPadding:3},
    headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold"},
    columnStyles:{0:{cellWidth:70,fontStyle:"bold",textColor:NAVY},1:{fontStyle:"normal"}},
    alternateRowStyles:{fillColor:[245,250,255]},
    didParseCell:(d)=>{
      if(d.row.index===7&&d.section==="body"){d.cell.styles.fillColor=BLITE;d.cell.styles.textColor=BLUE;d.cell.styles.fontStyle="bold";}
    },
    margin:{left:14,right:14}
  });
  // Guarantor
  if(loan.guarantorName){
    const gy=doc.lastAutoTable.finalY+8;
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...NAVY);doc.text("GUARANTOR DETAILS",14,gy);
    doc.autoTable({startY:gy+4,
      body:[["Name",loan.guarantorName],["Phone",loan.guarantorPhone||"—"],["NIN",loan.guarantorNIN||"—"],["Address",loan.guarantorAddress||"—"]],
      styles:{fontSize:8.5,cellPadding:2.5},
      columnStyles:{0:{cellWidth:40,fontStyle:"bold",textColor:NAVY}},
      margin:{left:14,right:14}
    });
  }
  // Full approval trail in PDF
  const trail=loan.approvalTrail||[];
  const trailY=Math.min(doc.lastAutoTable?doc.lastAutoTable.finalY+10:190, H-100);
  doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...NAVY);
  doc.text("APPROVAL TRAIL & SIGNATURES",14,trailY);
  doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(60,60,60);
  doc.text("This loan has been reviewed and approved through the BIDA 4-step approval process.",14,trailY+6);

  // Approval step boxes
  const steps=[
    {step:1,role:"Treasurer",      label:"Initiated"},
    {step:2,role:"Finance Manager",label:"Reviewed"},
    {step:3,role:"Administrator",  label:"Approved"},
    {step:4,role:"Auditor",        label:"Final Stamp"},
  ];
  const boxW=(W-28)/4;
  steps.forEach((s,i)=>{
    const bx=14+i*boxW, by=trailY+12;
    const done=trail.find(t=>t.step===s.step&&t.decision==="approved");
    doc.setFillColor(...(done?[232,245,233]:[245,245,245]));
    doc.roundedRect(bx,by,boxW-3,28,2,2,"F");
    doc.setFont("helvetica","bold");doc.setFontSize(7);
    doc.setTextColor(...(done?GREEN:GREY));
    doc.text("Step "+s.step+": "+s.label,bx+2,by+6);
    doc.setFont("helvetica","normal");doc.setFontSize(6.5);
    if(done){
      doc.setTextColor(30,60,30);
      doc.text(done.name,bx+2,by+12,{maxWidth:boxW-5});
      doc.text(done.date+" "+done.time,bx+2,by+18,{maxWidth:boxW-5});
      if(done.note) doc.text('"'+done.note.substring(0,25)+'"',bx+2,by+23,{maxWidth:boxW-5});
    } else {
      doc.setTextColor(...GREY);
      doc.text("Pending",bx+2,by+12);
    }
  });

  // Borrower signature line
  const sigY2=trailY+48;
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(60,60,60);
  doc.text("I, "+member.name+", confirm receipt of "+fmt(loan.amountLoaned)+" and agree to repay as stated.",14,sigY2);
  doc.setDrawColor(150,150,150);
  doc.line(14,sigY2+14,90,sigY2+14);doc.line(105,sigY2+14,W-14,sigY2+14);
  doc.setFontSize(7);doc.setTextColor(...GREY);
  doc.text("Borrower Signature & Date",14,sigY2+19);
  doc.text("BIDA Auditor Signature & Date",105,sigY2+19);
  const finalApproval=trail.find(t=>t.step===4&&t.decision==="approved");
  if(finalApproval){
    doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...GREEN);
    doc.text("✓ FULLY APPROVED — "+finalApproval.date+" "+finalApproval.time,W/2,sigY2+28,{align:"center"});
  }
  // Footer
  doc.setFillColor(...BLITE);doc.rect(0,H-10,W,10,"F");
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);
  doc.text("BIDA Co-operative Multi-Purpose Society — Loan Agreement — Confidential",12,H-4);
  doc.text(toStr(),W-12,H-4,{align:"right"});
  return doc.output("blob");
}

// ── PDF GENERATION ──────────────────────────────────────────────────────────
async function generatePDF(type, members, loans, expenses, returnBlob=false){
  await loadJsPDF();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  const NAVY=[13,52,97],BLUE=[21,101,192],BLITE=[227,242,253],WHITE=[255,255,255],GREEN=[27,94,32],RED=[198,40,40],GREY=[94,127,160],ORANGE=[191,54,12];
  const dH=(title,sub)=>{
    doc.setFillColor(...NAVY);doc.rect(0,0,W,24,"F");doc.setFillColor(...BLUE);doc.rect(0,24,W,2,"F");
    (()=>{const cx=18,cy=12,r=7;doc.setFillColor(...BLUE);doc.rect(cx-r,cy-r,r*2,r*2,"F");doc.setFillColor(...WHITE);doc.rect(cx-r*.42,cy+r*.02,r*.20,r*.50,"F");doc.rect(cx-r*.10,cy-r*.26,r*.20,r*.78,"F");doc.rect(cx+r*.22,cy-r*.54,r*.20,r*1.06,"F");})();
    doc.setFont("helvetica","bold");doc.setFontSize(12);doc.setTextColor(...WHITE);doc.text("BIDA",30,10);
    doc.setFont("helvetica","normal");doc.setFontSize(5.5);doc.setTextColor(144,202,249);doc.text("CO-OPERATIVE MULTI-PURPOSE SOCIETY",30,16);
    doc.setFont("helvetica","bold");doc.setFontSize(13);doc.setTextColor(...WHITE);doc.text(title,W/2,10,{align:"center"});
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(187,222,251);doc.text(sub,W/2,17,{align:"center"});
    doc.setFontSize(7);doc.setTextColor(187,222,251);doc.text("Generated: "+toStr(),W-10,10,{align:"right"});doc.text("Confidential",W-10,17,{align:"right"});
  };
  const dF=(n)=>{doc.setFillColor(...BLITE);doc.rect(0,H-10,W,10,"F");doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);doc.text("BIDA Co-operative Multi-Purpose Society — Confidential",10,H-4);doc.text("Page "+n,W/2,H-4,{align:"center"});doc.text(toStr(),W-10,H-4,{align:"right"});};
  const sB=(x,y,w,h,lb,v,c)=>{doc.setFillColor(...BLITE);doc.roundedRect(x,y,w,h,2,2,"F");doc.setFillColor(...(c||BLUE));doc.roundedRect(x,y,3,h,1,1,"F");doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);doc.text(lb.toUpperCase(),x+6,y+5);doc.setFont("helvetica","bold");doc.setFontSize(9.5);doc.setTextColor(...NAVY);doc.text(v,x+6,y+11);};

  if(type==="savings"){
    const tM=members.reduce((s,m)=>s+(m.membership||0),0),tA=members.reduce((s,m)=>s+(m.annualSub||0),0),tS=members.reduce((s,m)=>s+(m.monthlySavings||0),0),tW=members.reduce((s,m)=>s+(m.welfare||0),0),tSh=members.reduce((s,m)=>s+(m.shares||0),0),grand=members.reduce((s,m)=>s+totBanked(m),0);
    const totalExp=expenses.reduce((s,e)=>s+(+e.amount||0),0);
    const profit=loans.filter(l=>l.status==="paid").reduce((s,l)=>s+calcLoan(l).profit,0);
    const cashInBk=grand+profit-totalExp;
    dH("BIDA CO-OPERATIVE — MEMBER SAVINGS LEDGER","Financial Statement as at "+toStr());
    sB(10,27,38,16,"Members",""+members.length,BLUE);
    sB(52,27,46,16,"Total Banked",fmt(grand),BLUE);
    sB(102,27,44,16,"Monthly Rate",fmt(tS),[25,118,210]);
    sB(150,27,44,16,"Welfare Pool",fmt(tW),[66,165,245]);
    sB(198,27,44,16,"Cash in Bank",fmt(cashInBk),cashInBk<0?RED:GREEN);
    sB(246,27,40,16,"Total Expenses",fmt(totalExp),RED);
    // Main member table with contact details
    const rows=members.map((m,i)=>{
      const bl=borrowLimit(m,loans);
      const activeLoan=loans.find(l=>l.memberId===m.id&&l.status!=="paid");
      const contact=(m.phone||m.whatsapp)?" | "+(m.phone||m.whatsapp):"";
      const nin=m.nin?" | "+m.nin:"";
      return [i+1,m.name+contact+nin,m.joinDate?new Date(m.joinDate).toLocaleDateString("en-GB",{month:"short",year:"numeric"}):"—",fmtN(m.membership),fmtN(m.annualSub),fmtN(m.monthlySavings),fmtN(m.welfare),fmtN(m.shares),fmtN(totBanked(m)),fmt(bl),activeLoan?fmt(calcLoan(activeLoan).balance):"—"];
    });
    rows.push(["","TOTALS","",fmtN(tM),fmtN(tA),fmtN(tS),fmtN(tW),fmtN(tSh),fmtN(grand),"","—"]);
    doc.autoTable({
      startY:48,
      head:[["#","Member","Since","Membership","Annual Sub","Monthly","Welfare","Shares","Total Banked","Max Borrow","Loan Bal"]],
      body:rows,
      styles:{fontSize:6.5,cellPadding:2},
      headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",halign:"center",fontSize:6.5},
      alternateRowStyles:{fillColor:[245,250,255]},
      columnStyles:{
        0:{halign:"center",cellWidth:6},
        1:{cellWidth:40,fontStyle:"bold"},
        2:{halign:"center",cellWidth:16},
        3:{halign:"right",cellWidth:18},4:{halign:"right",cellWidth:18},
        5:{halign:"right",cellWidth:18},6:{halign:"right",cellWidth:18},
        7:{halign:"right",cellWidth:18},
        8:{halign:"right",fontStyle:"bold",cellWidth:22},
        9:{halign:"right",textColor:BLUE,cellWidth:22},
        10:{halign:"right",textColor:RED,cellWidth:18},
      },
      didParseCell:(d)=>{
        if(d.row.index===members.length&&d.section==="body"){d.cell.styles.fillColor=BLITE;d.cell.styles.fontStyle="bold";}
        if(d.column.index===10&&d.section==="body"&&d.cell.raw!=="—")d.cell.styles.textColor=RED;
      },
      margin:{left:8,right:8},
      didDrawPage:(d)=>dF(d.pageNumber)
    });
    // Summary footer
    const fy=doc.lastAutoTable.finalY+5;
    doc.setFillColor(227,242,253);doc.roundedRect(8,fy,W-16,16,2,2,"F");
    doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...NAVY);
    const summaryItems=[["Total Banked",fmt(grand)],["Total Expenses",fmt(totalExp)],["Loan Profit",fmt(profit)],["Cash in Bank",fmt(cashInBk)],["Active Loans",""+loans.filter(l=>l.status!=="paid").length],["Outstanding",fmt(loans.filter(l=>l.status!=="paid").reduce((s,l)=>s+calcLoan(l).balance,0))]];
    summaryItems.forEach((item,i)=>{const x=10+i*47;doc.setFontSize(6);doc.setFont("helvetica","normal");doc.setTextColor(...GREY);doc.text(item[0].toUpperCase(),x,fy+5);doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...NAVY);doc.text(item[1],x,fy+11);});
    return doc.output("blob");
  } else if(type==="loans"){
    const calcs=loans.map(l=>({...l,...calcLoan(l)})),active=calcs.filter(l=>l.status!=="paid"),paid=calcs.filter(l=>l.status==="paid");
    dH("LOAN REGISTER REPORT","Disbursements & Repayments — 4% Flat (<7m) | 6% Reducing (≥7m)");
    sB(10,27,42,16,"Active",""+active.length,[191,54,12]);sB(56,27,42,16,"Disbursed",fmt(loans.reduce((s,l)=>s+(l.amountLoaned||0),0)),BLUE);sB(102,27,42,16,"Outstanding",fmt(active.reduce((s,l)=>s+l.balance,0)),RED);sB(148,27,42,16,"Int. Accrued",fmt(calcs.reduce((s,l)=>s+l.totalInterest,0)),[25,118,210]);sB(194,27,42,16,"Profit",fmt(paid.reduce((s,l)=>s+l.profit,0)),GREEN);sB(240,27,42,16,"Closed",""+paid.length,[46,125,50]);
    const rows=calcs.map((l,i)=>[i+1,l.memberName,fmtD(l.dateBanked),fmtN(l.amountLoaned),l.method==="reducing"?"6% RB":"4% Flat",l.term+"mo",fmtN(l.monthlyPayment),""+l.months,fmtN(l.totalInterest),fmtN(l.totalDue),fmtN(l.amountPaid),l.balance>0?"("+fmtN(l.balance)+")":fmtN(l.balance),l.status==="paid"?"PAID":"ACTIVE"]);
    doc.autoTable({startY:48,head:[["#","Member","Issued","Principal","Method","Term","Monthly Pay","Elapsed","Total Int.","Total Due","Paid","Balance","Status"]],body:rows,styles:{fontSize:7,cellPadding:2.2},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",fontSize:7,halign:"center"},alternateRowStyles:{fillColor:[245,250,255]},columnStyles:{0:{halign:"center",cellWidth:7},1:{cellWidth:34,fontStyle:"bold"},2:{halign:"center",cellWidth:19},3:{halign:"right"},4:{halign:"center",cellWidth:13},5:{halign:"center",cellWidth:11},6:{halign:"right",fontStyle:"bold"},7:{halign:"center"},8:{halign:"right"},9:{halign:"right",fontStyle:"bold"},10:{halign:"right"},11:{halign:"right"},12:{halign:"center"}},didParseCell:(d)=>{if(d.column.index===12&&d.section==="body"){d.cell.styles.fontStyle="bold";d.cell.styles.textColor=d.cell.raw==="PAID"?GREEN:[191,54,12];}if(d.column.index===11&&d.section==="body"&&typeof d.cell.raw==="string"&&d.cell.raw.startsWith("("))d.cell.styles.textColor=RED;},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    const fy=doc.lastAutoTable.finalY+6;doc.setFillColor(255,253,231);doc.roundedRect(10,fy,W-20,10,2,2,"F");doc.setFont("helvetica","bold");doc.setFontSize(7);doc.setTextColor(120,90,10);doc.text("INTEREST RULES:",15,fy+4);doc.setFont("helvetica","normal");doc.setTextColor(100,80,20);doc.text("Loans < UGX 7,000,000: 4% flat on original principal/mo. Loans ≥ UGX 7,000,000: 6% reducing balance on outstanding principal/mo. Terms 6–24 months.",52,fy+4);
    return doc.output("blob");
  } else if(type==="expenses"){
    const totalExp=expenses.reduce((s,e)=>s+(+e.amount||0),0);
    const pool=members.reduce((s,m)=>s+totBanked(m),0);
    const profit=loans.filter(l=>l.status==="paid").reduce((s,l)=>s+calcLoan(l).profit,0);
    const cashInBk=pool+profit-totalExp;
    const catTotals={};expenses.forEach(e=>{catTotals[e.category]=(catTotals[e.category]||0)+(+e.amount||0);});
    dH("BIDA CO-OPERATIVE — EXPENSES REGISTER","Full Expenditure Ledger with Running Balance — "+toStr());
    sB(10,27,42,16,"Fund Pool",fmt(pool),BLUE);
    sB(56,27,42,16,"Total Expenses",fmt(totalExp),RED);
    sB(102,27,42,16,"Loan Profit",fmt(profit),GREEN);
    sB(148,27,48,16,"Cash in Bank",fmt(cashInBk),cashInBk<0?RED:GREEN);
    sB(200,27,38,16,"Transactions",""+expenses.length,GREY);
    sB(242,27,44,16,"Bank Charges",fmt(catTotals["banking"]||0),[13,52,97]);
    // Category summary table first
    const catRows=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>[cat.replace(/_/g," ").toUpperCase(),fmtN(amt),((amt/totalExp)*100).toFixed(1)+"%"]);
    catRows.push(["TOTAL",fmtN(totalExp),"100.0%"]);
    doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...NAVY);doc.text("CATEGORY SUMMARY",10,50);
    doc.autoTable({startY:53,head:[["Category","Amount (UGX)","%"]],body:catRows,styles:{fontSize:7.5,cellPadding:2},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold"},columnStyles:{0:{cellWidth:60,fontStyle:"bold"},1:{halign:"right",cellWidth:40},2:{halign:"center",cellWidth:20}},didParseCell:(d)=>{if(d.row.index===catRows.length-1&&d.section==="body"){d.cell.styles.fillColor=BLITE;d.cell.styles.fontStyle="bold";}},tableWidth:120,margin:{left:10}});
    // Main ledger with running balance
    const sortedExp=[...expenses].sort((a,b)=>new Date(a.date)-new Date(b.date));
    let running=pool+profit;
    const rows=sortedExp.map((e,i)=>{
      running-=(+e.amount||0);
      const payDetail=e.payMode==="cash"?"💵 Cash":e.payMode==="bank"?"🏦 "+(e.bankName||"Bank"):e.payMode==="mtn"?"📱 MTN "+(e.mobileNumber||""):e.payMode==="airtel"?"📱 Airtel "+(e.mobileNumber||""):e.payMode||"—";
      return [i+1,fmtD(e.date),e.activity.substring(0,45),e.issuedBy||"—",e.approvedBy||"—",fmtN(+e.amount||0),fmtN(Math.round(running)),e.category?e.category.replace(/_/g," "):"—",payDetail];
    });
    rows.push(["","","TOTAL EXPENSES","","",fmtN(totalExp),fmtN(Math.round(cashInBk)),"","CASH IN BANK"]);
    const startY2=doc.lastAutoTable?doc.lastAutoTable.finalY+8:55;
    doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...NAVY);doc.text("FULL EXPENSE LEDGER",10,startY2-2);
    doc.autoTable({
      startY:startY2,
      head:[["#","Date","Activity","Issued By","Approved By","Amount (UGX)","Balance After","Category","Payment"]],
      body:rows,
      styles:{fontSize:6.5,cellPadding:2},
      headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",halign:"center",fontSize:6.5},
      alternateRowStyles:{fillColor:[245,250,255]},
      columnStyles:{
        0:{halign:"center",cellWidth:6},
        1:{halign:"center",cellWidth:18},
        2:{cellWidth:52,fontStyle:"bold"},
        3:{cellWidth:22},4:{cellWidth:22},
        5:{halign:"right",fontStyle:"bold",cellWidth:22,textColor:RED},
        6:{halign:"right",fontStyle:"bold",cellWidth:22},
        7:{cellWidth:18},8:{cellWidth:20},
      },
      didParseCell:(d)=>{
        if(d.row.index===rows.length-1&&d.section==="body"){d.cell.styles.fillColor=BLITE;d.cell.styles.fontStyle="bold";if(d.column.index===5)d.cell.styles.textColor=RED;if(d.column.index===6)d.cell.styles.textColor=cashInBk<0?RED:GREEN;}
        if(d.column.index===6&&d.section==="body"&&d.row.index<rows.length-1){const v=parseInt((d.cell.raw||"0").replace(/,/g,""));if(v<0)d.cell.styles.textColor=RED;}
      },
      margin:{left:8,right:8},
      didDrawPage:(d)=>dF(d.pageNumber)
    });
    return doc.output("blob");
  } else if(type==="projections"){
    // ── DATA-DRIVEN PROJECTIONS based on actual activity ──
    const tM=members.reduce((s,m)=>s+(m.monthlySavings||0),0);
    const gT=members.reduce((s,m)=>s+totBanked(m),0);
    const totalExp=expenses.reduce((s,e)=>s+(+e.amount||0),0);
    const aL=loans.filter(l=>l.status!=="paid");
    const aI=aL.reduce((s,l)=>s+calcLoan(l).monthlyInt,0);
    const tP=loans.filter(l=>l.status==="paid").reduce((s,l)=>s+calcLoan(l).profit,0);
    const cashInBk=gT+tP-totalExp;
    // New members in last 6 months
    const now=new Date();const sixAgo=new Date(now);sixAgo.setMonth(sixAgo.getMonth()-6);
    const recentNewMembers=members.filter(m=>m.joinDate&&new Date(m.joinDate)>=sixAgo).length;
    const avgMbrSavings=members.length>0?Math.round(tM/members.length):50000;
    const sm=now.getMonth();
    dH("BIDA 12-MONTH PROJECTIONS & SCENARIOS","Activity-Based Forecast — "+toStr());
    sB(10,27,40,16,"Cash in Bank",fmt(cashInBk),cashInBk>=0?GREEN:RED);
    sB(54,27,40,16,"Monthly Savings",fmt(tM),BLUE);
    sB(98,27,36,16,"Loan Int/Mo",fmt(aI),[191,54,12]);
    sB(138,27,44,16,"New Mbrs (6mo)",""+recentNewMembers,GREY);
    sB(186,27,40,16,"Avg Mbr/Mo",fmt(avgMbrSavings),[25,118,210]);
    sB(230,27,56,16,"Profit So Far",fmt(tP),GREEN);
    // ── SCENARIO A: Current trajectory ──
    let pA=gT,rA=tM;
    const rA_rows=[];
    for(let i=0;i<12;i++){
      rA+=Math.round((recentNewMembers/6)*avgMbrSavings); // new members joining monthly
      const wf=Math.round(rA*0.30);
      const int=Math.round(aI*(1+i*0.01));
      const inflow=rA+int;
      pA+=inflow;
      const mi=(sm+i)%12,yr=now.getFullYear()+Math.floor((sm+i)/12);
      rA_rows.push([MONTHS[mi]+" "+yr,fmtN(Math.round(rA)),fmtN(wf),fmtN(int),fmtN(inflow),fmtN(Math.round(pA))]);
    }
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...NAVY);
    doc.text("SCENARIO A — Current Trajectory (based on actual last 6 months activity)",10,50);
    doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);
    doc.text("Monthly savings: "+fmt(tM)+" | "+recentNewMembers+" new members in last 6 months | Loan interest: "+fmt(aI)+"/mo",10,55);
    doc.autoTable({startY:58,head:[["Month","Monthly Savings","Welfare (30%)","Loan Interest","Total Inflow","Cumulative Pool"]],body:rA_rows,styles:{fontSize:7,cellPadding:1.8},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",halign:"center",fontSize:7},alternateRowStyles:{fillColor:[245,250,255]},columnStyles:{0:{fontStyle:"bold",cellWidth:28},1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right",fontStyle:"bold"},5:{halign:"right",fontStyle:"bold",textColor:BLUE}},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    // ── SCENARIO B: All members pay UGX 25,000/month for 18 months ──
    let pB=gT,pC=gT;
    const rB=members.length*25000,rC=members.length*30000;
    const rB_rows=[],rC_rows=[];
    for(let i=0;i<18;i++){
      const mi=(sm+i)%12,yr=now.getFullYear()+Math.floor((sm+i)/12);
      const wfB=Math.round(rB*0.30),wfC=Math.round(rC*0.30);
      const int=Math.round(aI*(1+i*0.005));
      pB+=rB+int; pC+=rC+int;
      rB_rows.push([MONTHS[mi]+" "+yr,fmtN(rB),fmtN(wfB),fmtN(int),fmtN(rB+int),fmtN(Math.round(pB))]);
      rC_rows.push([MONTHS[mi]+" "+yr,fmtN(rC),fmtN(wfC),fmtN(int),fmtN(rC+int),fmtN(Math.round(pC))]);
    }
    const yB=doc.lastAutoTable.finalY+8;
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(27,94,32);
    doc.text("SCENARIO B — All "+members.length+" Members Pay UGX 25,000/Month for 18 Months",10,yB);
    doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);
    doc.text("Total monthly: "+fmt(rB)+" | Pool after 18 months before expenses: "+fmt(Math.round(pB)),10,yB+5);
    doc.autoTable({startY:yB+8,head:[["Month","Monthly Savings","Welfare (30%)","Loan Interest","Total Inflow","Cumulative Pool"]],body:rB_rows,styles:{fontSize:7,cellPadding:1.8},headStyles:{fillColor:[27,94,32],textColor:WHITE,fontStyle:"bold",halign:"center",fontSize:7},alternateRowStyles:{fillColor:[232,245,233]},columnStyles:{0:{fontStyle:"bold",cellWidth:28},1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right",fontStyle:"bold"},5:{halign:"right",fontStyle:"bold",textColor:[27,94,32]}},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    const yC=doc.lastAutoTable.finalY+8;
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(191,54,12);
    doc.text("SCENARIO C — All "+members.length+" Members Pay UGX 30,000/Month for 18 Months",10,yC);
    doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);
    doc.text("Total monthly: "+fmt(rC)+" | Pool after 18 months before expenses: "+fmt(Math.round(pC)),10,yC+5);
    doc.autoTable({startY:yC+8,head:[["Month","Monthly Savings","Welfare (30%)","Loan Interest","Total Inflow","Cumulative Pool"]],body:rC_rows,styles:{fontSize:7,cellPadding:1.8},headStyles:{fillColor:[191,54,12],textColor:WHITE,fontStyle:"bold",halign:"center",fontSize:7},alternateRowStyles:{fillColor:[255,248,225]},columnStyles:{0:{fontStyle:"bold",cellWidth:28},1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right",fontStyle:"bold"},5:{halign:"right",fontStyle:"bold",textColor:[191,54,12]}},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    // Final comparison summary
    const yS=doc.lastAutoTable.finalY+8;
    if(yS<H-30){
      doc.setFillColor(13,52,97);doc.roundedRect(10,yS,W-20,28,2,2,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(255,255,255);
      doc.text("WHY CONSISTENT BANKING MATTERS",14,yS+7);
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(187,222,251);
      const pA12=Number(String(rA_rows[11][5]).replace(/,/g,""));
      doc.text("After 12 months — Current pace: "+fmt(Math.round(pA))+" | At 25k/month: "+fmt(Math.round(pB*12/18))+" | At 30k/month: "+fmt(Math.round(pC*12/18)),14,yS+13);
      doc.text("Consistent UGX 30,000/month by all members grows the pool "+Math.round(((pC*12/18)/Math.max(pA,1)-1)*100)+"% faster than current pace.",14,yS+19);
      doc.text("Higher pool = larger investments, bigger dividends, more welfare — everyone benefits.",14,yS+25);
    }
    return doc.output("blob");
  }
}

async function generateMemberPDF(member, memberLoans, allMembers, allLoans, returnBlob=false){
  await loadJsPDF();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  const NAVY=[13,52,97],BLUE=[21,101,192],BLITE=[227,242,253],WHITE=[255,255,255],GREEN=[27,94,32],RED=[198,40,40],GREY=[94,127,160];

  // BIDA hexagon logo
  const drawLogo=(cx,cy,r)=>{
    doc.setFillColor(...BLUE);
    doc.rect(cx-r,cy-r,r*2,r*2,"F");
    doc.setFillColor(...WHITE);
    doc.rect(cx-r*0.42,cy+r*0.02,r*0.20,r*0.50,"F");
    doc.rect(cx-r*0.10,cy-r*0.26,r*0.20,r*0.78,"F");
    doc.rect(cx+r*0.22,cy-r*0.54,r*0.20,r*1.06,"F");
  };

  // Header
  doc.setFillColor(...NAVY);doc.rect(0,0,W,32,"F");
  doc.setFillColor(...BLUE);doc.rect(0,32,W,1.5,"F");
  drawLogo(22,16,9);
  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...WHITE);doc.text("BIDA",36,13);
  doc.setFont("helvetica","normal");doc.setFontSize(5.5);doc.setTextColor(144,202,249);
  doc.text("CO-OPERATIVE MULTI-PURPOSE SOCIETY",36,19);
  doc.text("bidacooperative@gmail.com",36,25);
  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...WHITE);
  doc.text("MEMBER STATEMENT",W/2,13,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(187,222,251);
  doc.text("Individual Financial Summary — Confidential",W/2,20,{align:"center"});
  doc.setFontSize(6.5);doc.setTextColor(187,222,251);
  doc.text("Generated: "+toStr(),W-10,13,{align:"right"});

  // Stats banner
  const tb=totBanked(member);
  const allTotals=allMembers.map(m=>totBanked(m)).sort((a,b)=>b-a);
  const rank=allTotals.indexOf(tb)+1;
  const poolTotal=allTotals.reduce((s,v)=>s+v,0);
  const pct=poolTotal>0?((tb/poolTotal)*100).toFixed(1):"0.0";
  const lim=borrowLimit(member,allLoans||[]);
  const avgTotal=allMembers.length>0?Math.round(poolTotal/allMembers.length):0;
  const diff=tb-avgTotal;
  const boxY=37,boxH=18,bGap=3,bW=(W-24)/4;
  const sBox=(x,label,val,col)=>{
    doc.setFillColor(...BLITE);doc.roundedRect(x,boxY,bW,boxH,2,2,"F");
    doc.setFillColor(...col);doc.roundedRect(x,boxY,3,boxH,1,1,"F");
    doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(...GREY);doc.text(label.toUpperCase(),x+5,boxY+5.5);
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...NAVY);doc.text(val,x+5,boxY+13,{maxWidth:bW-7});
  };
  sBox(12,"Total Banked",fmt(tb),BLUE);
  sBox(12+bW+bGap,"Max Borrow",fmt(lim),GREEN);
  sBox(12+2*(bW+bGap),"Rank","#"+rank+" / "+allMembers.length,NAVY);
  sBox(12+3*(bW+bGap),"Pool Share",pct+"% of pool",BLUE);

  // Member detail card
  const cY=boxY+boxH+4;
  doc.setFillColor(248,252,255);doc.roundedRect(10,cY,W-20,22,2,2,"F");
  doc.setDrawColor(...BLUE);doc.roundedRect(10,cY,W-20,22,2,2,"S");
  doc.setFont("helvetica","bold");doc.setFontSize(12);doc.setTextColor(...NAVY);doc.text(member.name,14,cY+8);
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);
  const c2=W/2+2;
  doc.text("Member ID: #"+member.id,14,cY+14);
  doc.text("Joined: "+(member.joinDate?new Date(member.joinDate).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}):"—"),14,cY+19);
  if(member.phone||member.whatsapp) doc.text("Phone: "+(member.phone||member.whatsapp),c2,cY+14);
  if(member.nin) doc.text("NIN: "+member.nin,c2,cY+19);

  // Savings breakdown
  const sY=cY+27;
  doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...NAVY);doc.text("SAVINGS BREAKDOWN",12,sY);
  doc.autoTable({startY:sY+3,
    head:[["Category","Amount (UGX)","% of Total"]],
    body:[
      ["Membership Fee",fmtN(member.membership),tb>0?((member.membership/tb)*100).toFixed(1)+"%":"—"],
      ["Annual Subscription",fmtN(member.annualSub),tb>0?((member.annualSub/tb)*100).toFixed(1)+"%":"—"],
      ["Monthly Savings (cumulative)",fmtN(member.monthlySavings),tb>0?((member.monthlySavings/tb)*100).toFixed(1)+"%":"—"],
      ["Welfare Contributions",fmtN(member.welfare),tb>0?((member.welfare/tb)*100).toFixed(1)+"%":"—"],
      ["Shares",fmtN(member.shares),tb>0?((member.shares/tb)*100).toFixed(1)+"%":"—"],
      ["TOTAL BANKED",fmtN(tb),"100.0%"],
    ],
    styles:{fontSize:9,cellPadding:2.8},
    headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",fontSize:8.5},
    columnStyles:{0:{cellWidth:100},1:{halign:"right",fontStyle:"bold",cellWidth:46},2:{halign:"center",cellWidth:26}},
    didParseCell:(d)=>{if(d.row.index===5&&d.section==="body"){d.cell.styles.fillColor=BLITE;d.cell.styles.textColor=BLUE;d.cell.styles.fontStyle="bold";d.cell.styles.fontSize=10;}},
    margin:{left:12,right:12}
  });

  // Borrowing capacity
  const bRate=Math.round(borrowCapacityRate(member,allLoans||[])*100);
  const bBase=(member.monthlySavings||0)+(member.welfare||0);
  const bPenalty=defaultPrincipalPenalty(member,allLoans||[]);
  const limY=doc.lastAutoTable.finalY+5;
  doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...NAVY);doc.text("BORROWING CAPACITY",12,limY);
  doc.autoTable({startY:limY+3,
    body:[["Savings + Welfare base",fmt(bBase),""],["Capacity rate",bRate+"%"+(bPenalty>0?" (penalty applied)":""),""],["Maximum loan limit",fmt(lim),"Up to this amount available"]],
    styles:{fontSize:8.5,cellPadding:2.5},
    columnStyles:{0:{cellWidth:80,fontStyle:"bold"},1:{halign:"right",cellWidth:46},2:{cellWidth:46,fontSize:7}},
    didParseCell:(d)=>{if(d.row.index===2&&d.section==="body"){d.cell.styles.fillColor=[232,245,233];d.cell.styles.textColor=GREEN;d.cell.styles.fontStyle="bold";d.cell.styles.fontSize=10;}},
    margin:{left:12,right:12}
  });

  // Pool standing & peer comparison
  const psY=doc.lastAutoTable.finalY+5;
  doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...NAVY);doc.text("POOL STANDING & PEER COMPARISON",12,psY);
  doc.autoTable({startY:psY+3,
    head:[["Metric","Value","Note"]],
    body:[
      ["Total pool (all "+allMembers.length+" members)",fmt(poolTotal),"Combined savings of all members"],
      ["Pool average per member",fmt(avgTotal),"Average contribution"],
      ["Your total banked",fmt(tb),pct+"% of the entire pool"],
      [diff>=0?"Above pool average":"Below pool average",fmt(Math.abs(diff)),diff>=0?"▲ You are above average":"▼ You are below average"],
      ["Your rank","#"+rank+" of "+allMembers.length,rank===1?"🏅 Top contributor":rank<=3?"Top 3":"By total amount banked"],
    ],
    styles:{fontSize:8.5,cellPadding:2.5},
    headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",fontSize:8.5},
    columnStyles:{0:{cellWidth:78,fontStyle:"bold"},1:{halign:"right",cellWidth:44},2:{cellWidth:50,fontSize:7.5}},
    didParseCell:(d)=>{
      if(d.section==="body"){
        if(d.row.index===2){d.cell.styles.fillColor=BLITE;d.cell.styles.textColor=BLUE;}
        if(d.row.index===3){d.cell.styles.textColor=diff>=0?GREEN:RED;d.cell.styles.fontStyle="bold";}
        if(d.row.index===4){d.cell.styles.fillColor=[232,245,233];d.cell.styles.textColor=GREEN;d.cell.styles.fontStyle="bold";}
      }
    },
    margin:{left:12,right:12}
  });

  // Loan history
  if(memberLoans&&memberLoans.length>0){
    const lY=doc.lastAutoTable.finalY+5;
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...NAVY);
    doc.text("LOAN HISTORY ("+memberLoans.length+" loan"+(memberLoans.length>1?"s":"")+")",12,lY);
    const lRows=memberLoans.map(l=>{
      const c=l.method?l:calcLoan(l);
      return [fmtD(l.dateBanked||l.dateIssued),fmtN(l.amountLoaned),c.method==="reducing"?"6% RB":"4% Flat",(l.term||12)+"mo",fmtN(c.monthlyPayment),fmtN(c.totalInterest),fmtN(c.totalDue),fmtN(l.amountPaid||0),(l.balance>0||c.balance>0)?"("+fmtN(l.balance||c.balance)+")":"✓ CLEAR",l.status==="paid"?"✓ PAID":"● ACTIVE"];
    });
    doc.autoTable({startY:lY+3,
      head:[["Issued","Principal","Rate","Term","Monthly","Interest","Total Due","Paid","Balance","Status"]],
      body:lRows,
      styles:{fontSize:7.5,cellPadding:2.2},
      headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",halign:"center",fontSize:7},
      columnStyles:{0:{cellWidth:18,halign:"center"},1:{cellWidth:24,halign:"right"},2:{cellWidth:14,halign:"center"},3:{cellWidth:10,halign:"center"},4:{cellWidth:22,halign:"right"},5:{cellWidth:22,halign:"right"},6:{cellWidth:22,halign:"right"},7:{cellWidth:22,halign:"right"},8:{cellWidth:18,halign:"right"},9:{cellWidth:14,halign:"center",fontStyle:"bold"}},
      didParseCell:(d)=>{
        if(d.column.index===9&&d.section==="body"){d.cell.styles.textColor=d.cell.raw==="✓ PAID"?GREEN:RED;}
        if(d.column.index===8&&d.section==="body"&&d.cell.raw&&d.cell.raw.startsWith("("))d.cell.styles.textColor=RED;
      },
      margin:{left:12,right:12}
    });
  }

  // Footer
  const pageCount=doc.internal.getNumberOfPages();
  for(let pg=1;pg<=pageCount;pg++){
    doc.setPage(pg);
    doc.setFillColor(...BLITE);doc.rect(0,H-10,W,10,"F");
    doc.setFillColor(...BLUE);doc.rect(0,H-10,W,0.8,"F");
    doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(...GREY);
    doc.text("BIDA Co-operative Multi-Purpose Society — Confidential Member Statement",12,H-4);
    doc.text("Page "+pg+" of "+pageCount+"  ·  "+toStr(),W-12,H-4,{align:"right"});
  }
  return doc.output("blob");
}


// ── SHARE CERTIFICATE PDF ─────────────────────────────────────────────────
async function generateShareCertificate(member, shareUnitsCount, shareValue){
  await loadJsPDF();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a5"});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  const NAVY=[13,52,97],BLUE=[21,101,192],WHITE=[255,255,255],GOLD=[183,146,30],LIGHT=[227,242,253];

  // Border
  doc.setDrawColor(...GOLD);doc.setLineWidth(1.5);doc.rect(6,6,W-12,H-12,"S");
  doc.setLineWidth(0.4);doc.rect(9,9,W-18,H-18,"S");

  // Header band
  doc.setFillColor(...NAVY);doc.rect(9,9,W-18,22,"F");

  // Logo block
  const cx=24,cy=20,r=7;
  doc.setFillColor(...BLUE);doc.rect(cx-r,cy-r,r*2,r*2,"F");
  doc.setFillColor(...WHITE);
  doc.rect(cx-r*.42,cy+r*.02,r*.20,r*.50,"F");
  doc.rect(cx-r*.10,cy-r*.26,r*.20,r*.78,"F");
  doc.rect(cx+r*.22,cy-r*.54,r*.20,r*1.06,"F");

  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...WHITE);
  doc.text("BIDA",36,17);
  doc.setFont("helvetica","normal");doc.setFontSize(5.5);doc.setTextColor(180,210,250);
  doc.text("CO-OPERATIVE MULTI-PURPOSE SOCIETY",36,23);

  doc.setFont("helvetica","bold");doc.setFontSize(15);doc.setTextColor(...WHITE);
  doc.text("SHARE CERTIFICATE",W/2,16,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(180,210,250);
  doc.text("Official Certificate of Share Ownership",W/2,23,{align:"center"});

  const certNo="BIDA-SH-"+String(member.id).padStart(4,"0");
  doc.setFontSize(7);doc.setTextColor(180,210,250);
  doc.text("Cert No: "+certNo,W-12,16,{align:"right"});
  doc.text("Date: "+toStr(),W-12,22,{align:"right"});

  // Gold band under header
  doc.setFillColor(...GOLD);doc.rect(9,31,W-18,1,"F");

  // THIS IS TO CERTIFY text
  doc.setFont("helvetica","italic");doc.setFontSize(9);doc.setTextColor(...NAVY);
  doc.text("This is to certify that",W/2,40,{align:"center"});

  // Member name large
  doc.setFont("helvetica","bold");doc.setFontSize(18);doc.setTextColor(...NAVY);
  doc.text(member.name,W/2,51,{align:"center"});
  doc.setDrawColor(...GOLD);doc.setLineWidth(0.5);
  doc.line(W/2-50,53,W/2+50,53);

  // Details
  doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(50,50,50);
  const midY=60;
  doc.text("Member ID: #"+member.id,W/2,midY,{align:"center"});
  doc.text("is the registered holder of",W/2,midY+7,{align:"center"});

  // Share count — big
  doc.setFillColor(...LIGHT);doc.roundedRect(W/2-40,midY+10,80,18,3,3,"F");
  doc.setDrawColor(...GOLD);doc.setLineWidth(0.8);doc.roundedRect(W/2-40,midY+10,80,18,3,3,"S");
  doc.setFont("helvetica","bold");doc.setFontSize(20);doc.setTextColor(...NAVY);
  doc.text(shareUnitsCount+" UNIT"+(shareUnitsCount>1?"S":""),W/2,midY+20,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(100,100,100);
  doc.text("("+shareUnitsCount+" share unit"+(shareUnitsCount>1?"s":"")+") at UGX 50,000 per unit",W/2,midY+26,{align:"center"});

  // Share value
  doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(...BLUE);
  doc.text("Total Share Capital: UGX "+Number(shareValue).toLocaleString("en-UG"),W/2,midY+34,{align:"center"});

  doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(60,60,60);
  doc.text("in BIDA Co-operative Multi-Purpose Society, subject to the rules and by-laws of the Society.",W/2,midY+41,{align:"center"});

  // Signature lines
  const sigY=H-22;
  doc.setDrawColor(150,150,150);doc.setLineWidth(0.4);
  doc.line(18,sigY,65,sigY);doc.line(W-65,sigY,W-18,sigY);
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(100,100,100);
  doc.text("Chairperson Signature & Date",18,sigY+4);
  doc.text("Secretary / Treasurer Signature & Date",W-65,sigY+4);

  // Footer
  doc.setFillColor(...NAVY);doc.rect(9,H-11,W-18,6,"F");
  doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(...WHITE);
  doc.text("BIDA Co-operative Multi-Purpose Society · "+certNo+" · bidacooperative@gmail.com",W/2,H-7,{align:"center"});

  return doc.output("blob");
}


// ── ERROR BOUNDARY — catches render crashes and shows message instead of white screen ──
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={hasError:false,error:null}; }
  static getDerivedStateFromError(error){ return {hasError:true,error}; }
  componentDidCatch(error,info){ console.error("BIDA App Error:",error,info); }
  render(){
    if(this.state.hasError){
      return React.createElement("div",{style:{minHeight:"100vh",background:"#0d3461",display:"flex",alignItems:"center",justifyContent:"center",padding:20}},
        React.createElement("div",{style:{background:"#fff",borderRadius:16,padding:"28px 24px",maxWidth:480,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}},
          React.createElement("div",{style:{fontSize:28,marginBottom:12}},"⚠️"),
          React.createElement("div",{style:{fontSize:18,fontWeight:800,color:"#0d3461",marginBottom:8}},"BIDA App — Unexpected Error"),
          React.createElement("div",{style:{fontSize:12,color:"#666",marginBottom:16,lineHeight:1.6}},"Something went wrong. Please refresh the page. If the problem persists, clear your browser cache."),
          React.createElement("div",{style:{background:"#f5f5f5",borderRadius:8,padding:"10px 12px",fontSize:11,fontFamily:"monospace",color:"#c62828",wordBreak:"break-word"}},
            this.state.error?.message||"Unknown error"
          ),
          React.createElement("button",{onClick:()=>window.location.reload(),style:{marginTop:16,padding:"10px 20px",borderRadius:8,background:"#1565c0",color:"#fff",border:"none",fontWeight:700,fontSize:13,cursor:"pointer",width:"100%"}},"Refresh Page")
        )
      );
    }
    return this.props.children;
  }
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --b900:#0a1931;--b800:#0d3461;--b700:#1350a0;--b600:#1565c0;--b500:#1976d2;
  --b400:#42a5f5;--b300:#90caf9;--b100:#e3f2fd;--b50:#f0f7ff;
  --td:#0d2137;--tm:#1a3a5c;--tmuted:#5e7fa0;--bdr:#c5dcf5;--bdr2:#90caf9;
  --danger:#c62828;--dbg:#ffebee;--ok:#1b5e20;--okbg:#e8f5e9;--warn:#bf360c;--wbg:#fff3e0;
  --sans:'Outfit',sans-serif;--mono:'JetBrains Mono',monospace;
}
html{-webkit-text-size-adjust:100%;}
body{background:var(--b50);color:var(--td);font-family:var(--sans);min-height:100vh;font-size:14px;}
.app{display:flex;flex-direction:column;min-height:100vh;}

/* ── HEADER ── */
.hdr{background:linear-gradient(130deg,var(--b900) 0%,var(--b800) 55%,var(--b700) 100%);
  box-shadow:0 3px 20px rgba(6,16,31,.5);position:sticky;top:0;z-index:100;}
.hdr-top{padding:0 12px;height:50px;display:flex;align-items:center;justify-content:space-between;}
.hdr-nav{padding:0 8px 8px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
.hdr-nav::-webkit-scrollbar{display:none;}
.brand{display:flex;align-items:center;gap:9px;}
.brand-name{font-size:17px;font-weight:900;letter-spacing:3px;color:#fff;line-height:1;}
.brand-sub{font-size:7px;letter-spacing:.8px;color:var(--b300);text-transform:uppercase;margin-top:2px;line-height:1.3;}
.nav{display:inline-flex;gap:2px;background:rgba(255,255,255,.1);padding:3px;border-radius:10px;border:1px solid rgba(255,255,255,.15);white-space:nowrap;}
.nbtn{padding:6px 11px;border-radius:7px;border:none;font-family:var(--sans);font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:rgba(255,255,255,.6);transition:all .18s;white-space:nowrap;}
.nbtn:hover{color:#fff;background:rgba(255,255,255,.12);}
.nbtn.on{background:#fff;color:var(--b800);box-shadow:0 2px 8px rgba(0,0,0,.2);}

/* ── MAIN ── */
.main{flex:1;padding:12px;width:100%;max-width:100%;overflow-x:hidden;}
.ptitle{font-size:16px;font-weight:800;color:var(--b800);margin-bottom:12px;display:flex;align-items:center;gap:8px;}
.ptdot{width:7px;height:7px;border-radius:50%;background:var(--b500);flex-shrink:0;}

/* ── STAT CARDS ── */
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-bottom:12px;}
@media(min-width:480px){.stats{grid-template-columns:repeat(3,1fr);}}
@media(min-width:720px){.stats{grid-template-columns:repeat(auto-fit,minmax(130px,1fr));}}
.card{background:#fff;border:1px solid var(--bdr);border-radius:11px;padding:10px 12px;position:relative;overflow:hidden;}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--b500),var(--b400));}
.card.ck::before{background:linear-gradient(90deg,#43a047,#2e7d32);}
.card.cw::before{background:linear-gradient(90deg,#fb8c00,#e65100);}
.card.cd::before{background:linear-gradient(90deg,#ef5350,#c62828);}
.clabel{font-size:9px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--tmuted);margin-bottom:4px;}
.cval{font-size:13px;font-weight:800;color:var(--b700);line-height:1.1;word-break:break-all;}
.cval.ok{color:#2e7d32;}.cval.warn{color:#bf360c;}.cval.danger{color:#c62828;}
.csub{font-size:9px;color:var(--tmuted);margin-top:2px;}

/* ── TOOLBAR ── */
.toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;}
.tl{display:flex;align-items:center;gap:8px;}
.ttitle{font-size:13px;font-weight:700;color:var(--b800);}
.tcount{font-size:10px;font-family:var(--mono);background:var(--b100);color:var(--b700);padding:2px 7px;border-radius:20px;}
.swrap{position:relative;}
.sico{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--tmuted);font-size:11px;pointer-events:none;}
.sinput{background:#fff;border:1.5px solid var(--bdr);border-radius:8px;padding:7px 10px 7px 28px;
  color:var(--td);font-family:var(--sans);font-size:13px;outline:none;width:140px;}
.sinput:focus{border-color:var(--b500);}

/* ── BUTTONS ── */
.btn{display:inline-flex;align-items:center;gap:4px;padding:8px 13px;border-radius:8px;border:none;
  font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.bp{background:linear-gradient(135deg,var(--b600),var(--b700));color:#fff;}
.bg{background:#fff;color:var(--b700);border:1.5px solid var(--bdr2);}
.bg:hover{border-color:var(--b500);background:var(--b50);}
.bk{background:linear-gradient(135deg,#43a047,#2e7d32);color:#fff;}
.bd{background:var(--dbg);color:var(--danger);border:1.5px solid #ffcdd2;}
.bpdf{background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;}
.bemail{background:linear-gradient(135deg,#6a1b9a,#4a148c);color:#fff;}
.bstmt{background:linear-gradient(135deg,#00695c,#004d40);color:#fff;}
.bwa{background:#25D366;color:#fff;}
.bwa:hover{background:#1ebe5d;}
.bsms{background:#e65100;color:#fff;}
.bsms:hover{background:#bf360c;}
.sm{padding:5px 10px;font-size:11px;border-radius:7px;}
.xs{padding:3px 7px;font-size:10px;border-radius:6px;}

/* ── TABLE ── */
.twrap{background:#fff;border-radius:11px;border:1px solid var(--bdr);overflow:hidden;overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%;}
table{width:100%;border-collapse:collapse;font-size:12px;}
thead tr{background:var(--b50);}
th{padding:8px 9px;text-align:left;font-size:9px;font-family:var(--mono);font-weight:600;color:var(--b700);
  text-transform:uppercase;letter-spacing:.6px;border-bottom:1.5px solid var(--bdr);white-space:nowrap;}
td{padding:8px 9px;border-bottom:1px solid #eef5ff;vertical-align:middle;white-space:nowrap;}
tr:last-child td{border-bottom:none;}
tbody tr:hover td{background:#f0f7ff;}
.trow td{background:linear-gradient(to right,var(--b100),var(--b50));font-weight:700;font-family:var(--mono);
  color:var(--b800);border-top:2px solid var(--bdr2);font-size:10px;}
th.hi,td.hi{background:rgba(21,101,192,.04);}
.nc{font-weight:700;color:var(--b700);cursor:pointer;text-decoration:underline;text-decoration-color:var(--bdr2);text-underline-offset:3px;}
.nc:hover{color:var(--b500);}
.mc{font-family:var(--mono);font-size:11px;color:var(--tm);}
.mct{font-family:var(--mono);font-weight:700;color:var(--b700);}
.mcd{font-family:var(--mono);font-weight:700;color:#bf360c;}
.sn{font-family:var(--mono);font-size:10px;color:var(--tmuted);}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;font-family:var(--mono);white-space:nowrap;}
.bpaid{background:#c8e6c9;color:#1b5e20;font-weight:800;}
.bactive{background:var(--wbg);color:var(--warn);}
.bover{background:#ffcdd2;color:#b71c1c;font-weight:800;}
.bp-pos{color:#2e7d32;font-family:var(--mono);font-weight:600;}
.bp-neg{color:var(--danger);font-family:var(--mono);font-weight:600;}
.abtn{display:flex;gap:3px;}

/* ── MODAL ── */
.overlay{position:fixed;inset:0;background:rgba(6,16,31,.75);backdrop-filter:blur(4px);
  z-index:200;display:flex;align-items:flex-end;justify-content:center;padding:0;overflow-y:auto;}
@media(min-width:600px){.overlay{align-items:center;padding:16px;}}
.modal{background:#fff;border:1px solid var(--bdr);width:100%;max-width:560px;
  max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;
  border-radius:18px 18px 0 0;padding:20px 16px 30px;animation:su .2s ease;}
@media(min-width:600px){.modal{border-radius:18px;padding:22px 20px;}.modal.wide{max-width:680px;}}
@keyframes su{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
.mhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.mtitle{font-size:15px;font-weight:800;color:var(--b800);}
.mclose{background:var(--b50);border:none;border-radius:8px;width:32px;height:32px;
  cursor:pointer;font-size:16px;color:var(--tmuted);display:flex;align-items:center;justify-content:center;}
.mclose:hover{background:var(--b100);}
.fgrid{display:grid;grid-template-columns:1fr;gap:10px;}
@media(min-width:480px){.fgrid{grid-template-columns:1fr 1fr;}}
.ff{grid-column:1/-1;}
.fg{display:flex;flex-direction:column;gap:4px;}
.fl{font-size:10px;font-weight:600;font-family:var(--mono);color:var(--tmuted);text-transform:uppercase;letter-spacing:.7px;}
.fi{background:var(--b50);border:1.5px solid var(--bdr);border-radius:9px;padding:10px 12px;
  color:var(--td);font-family:var(--sans);font-size:15px;outline:none;width:100%;}
.fi:focus{border-color:var(--b500);background:#fff;}
.fhint{font-size:9.5px;color:var(--b500);font-family:var(--mono);}
.div{border:none;border-top:1px solid var(--bdr);margin:12px 0;}
.crow{display:flex;justify-content:space-between;align-items:center;padding:4px 0;}
.cl{font-size:11px;color:var(--tmuted);font-family:var(--mono);}
.cv{font-size:13px;font-weight:700;font-family:var(--mono);color:var(--b700);}
.cv.d{color:var(--danger);}.cv.ok{color:#2e7d32;}
.fa{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap;}
select.fi{cursor:pointer;}

/* ── MISC ── */
.empty{text-align:center;padding:30px;color:var(--tmuted);font-size:13px;}
.eico{font-size:26px;margin-bottom:6px;opacity:.3;}
.int-rule{background:linear-gradient(135deg,var(--b800),var(--b700));border-radius:11px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;color:#fff;}
.int-rule-text{font-size:11px;line-height:1.5;}
.int-rule-text strong{color:var(--b300);}
.int-pill{display:inline-flex;align-items:center;background:var(--b100);border:1px solid var(--bdr2);border-radius:7px;padding:2px 7px;font-family:var(--mono);font-size:10px;color:var(--b700);}
.int-pill.over{background:#fce4ec;border-color:#f48fb1;color:#c62828;}
.pdf-panel{background:#fff;border:1px solid var(--bdr);border-radius:12px;padding:14px;margin-bottom:12px;}
.pdf-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
@media(min-width:480px){.pdf-cards{grid-template-columns:repeat(auto-fit,minmax(148px,1fr));}}
.pdf-card{border:1.5px solid var(--bdr);border-radius:11px;padding:12px;cursor:pointer;transition:all .18s;background:var(--b50);}
.pdf-card:hover{border-color:var(--b500);background:var(--b100);}
.pdf-card-icon{font-size:20px;margin-bottom:4px;}
.pdf-card-title{font-size:12px;font-weight:700;color:var(--b700);margin-bottom:2px;}
.pdf-card-desc{font-size:10px;color:var(--tmuted);line-height:1.4;}
.method-toggle{display:flex;align-items:center;gap:8px;background:var(--b50);border:1px solid var(--bdr);border-radius:9px;padding:8px 12px;margin-bottom:12px;flex-wrap:wrap;}
.method-toggle-label{font-size:10px;font-weight:700;font-family:var(--mono);color:var(--tmuted);text-transform:uppercase;letter-spacing:.6px;}
.spin{display:inline-block;animation:sp .7s linear infinite;}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes pu{0%,100%{opacity:1}50%{opacity:.3}}

/* ── PROFILE ── */
.prof-hero{background:linear-gradient(135deg,var(--b800),var(--b600));border-radius:13px;padding:14px 16px;margin-bottom:14px;color:#fff;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;}
.prof-info{flex:1;min-width:0;}
.prof-name{font-size:16px;font-weight:900;}
.prof-meta{font-size:11px;color:var(--b300);margin-top:2px;}
.prof-email-disp{font-size:11px;color:var(--b300);margin-top:2px;font-family:var(--mono);word-break:break-all;}
.prof-rank-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:#fff;font-family:var(--mono);margin-top:6px;}
.prof-section{margin-bottom:14px;}
.prof-section-title{font-size:9.5px;font-weight:700;color:var(--tmuted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-family:var(--mono);}
.prof-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}
@media(min-width:400px){.prof-grid{grid-template-columns:repeat(3,1fr);}}
.prof-item{background:var(--b50);border:1px solid var(--bdr);border-radius:9px;padding:8px 10px;}
.prof-item-label{font-size:9px;color:var(--tmuted);font-family:var(--mono);margin-bottom:2px;text-transform:uppercase;}
.prof-item-val{font-size:12px;font-weight:800;color:var(--b700);word-break:break-all;}
.prof-item-val.ok{color:#2e7d32;}
.prof-bar-wrap{background:var(--b50);border:1px solid var(--bdr);border-radius:9px;padding:10px 12px;margin-bottom:7px;}
.prof-bar-label{display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px;color:var(--tm);}
.prof-bar-track{height:6px;background:var(--b100);border-radius:3px;overflow:hidden;}
.prof-bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--b500),var(--b400));}
.prof-loan-card{background:#fff;border:1.5px solid var(--bdr);border-radius:11px;padding:12px;margin-bottom:9px;}
.prof-loan-card.lactive{border-color:#ffcc80;background:#fffde7;}
.prof-loan-card.loverdue{border-color:#ef9a9a;background:#ffebee;}
.prof-loan-card.lpaid{border-color:#66bb6a;background:#f1f8e9;border-width:2px;}

/* ── REMINDERS ── */
.email-section{background:#fff;border:1px solid var(--bdr);border-radius:12px;padding:14px;margin-bottom:12px;}
.email-sec-title{font-size:13px;font-weight:700;color:var(--b800);margin-bottom:3px;}
.email-sec-sub{font-size:11px;color:var(--tmuted);margin-bottom:10px;}
.send-all-bar{background:var(--b50);border:1px solid var(--bdr2);border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}
.email-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eef5ff;gap:8px;flex-wrap:wrap;}
.email-row:last-child{border-bottom:none;}
.email-member-info{display:flex;align-items:center;gap:8px;flex:1;min-width:0;}
.email-member-name{font-weight:700;font-size:12px;color:var(--td);}
.email-member-addr{font-size:10px;color:var(--tmuted);font-family:var(--mono);word-break:break-all;}
.no-email-tag{font-size:9.5px;background:#fff3e0;color:#e65100;border:1px solid #ffcc80;border-radius:9px;padding:2px 7px;font-family:var(--mono);}
.wa-chip{display:inline-flex;align-items:center;gap:4px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:9px;padding:2px 8px;font-size:10px;font-family:var(--mono);color:#1b5e20;cursor:pointer;}
.wa-chip:hover{background:#c8e6c9;}
.no-wa-tag{font-size:9.5px;background:#f1f8e9;color:#558b2f;border:1px solid #c5e1a5;border-radius:9px;padding:2px 7px;font-family:var(--mono);}
.contact-row{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:3px;}
.no-sms-tag{font-size:9.5px;background:#fbe9e7;color:#bf360c;border:1px solid #ffccbc;border-radius:9px;padding:2px 7px;font-family:var(--mono);}
.estatus-ok{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#2e7d32;font-family:var(--mono);white-space:nowrap;}
.estatus-err{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#c62828;font-family:var(--mono);white-space:nowrap;}
.estatus-sending{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--tmuted);font-family:var(--mono);white-space:nowrap;}
.estatus-nosetup{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#e65100;font-family:var(--mono);white-space:nowrap;}
.estatus-sms-ok{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#e65100;font-family:var(--mono);white-space:nowrap;}
.setup-banner{background:#fff3e0;border:1.5px solid #ffb74d;border-radius:11px;padding:14px 16px;margin-bottom:14px;}
.setup-banner h3{font-size:13px;font-weight:800;color:#bf360c;margin-bottom:8px;}
.setup-banner ol{padding-left:18px;font-size:12px;color:#5d4037;line-height:1.9;}
.setup-banner code{background:#ffe0b2;border-radius:4px;padding:1px 5px;font-family:var(--mono);font-size:11px;color:#bf360c;}

/* ── DUE LOAN ALERTS ── */
.due-alert{background:#fff3e0;border:1.5px solid #ffb74d;border-radius:11px;padding:12px 14px;margin-bottom:12px;}
.due-alert-title{font-size:13px;font-weight:800;color:#bf360c;margin-bottom:6px;}
.due-loan-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ffe0b2;gap:8px;flex-wrap:wrap;}
.due-loan-row:last-child{border-bottom:none;}
/* ── EXPENSE ROWS ── */
.exp-row{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #eef5ff;flex-wrap:wrap;}
.exp-row:last-child{border-bottom:none;}
.exp-date{font-size:10px;font-family:var(--mono);color:var(--tmuted);white-space:nowrap;min-width:70px;padding-top:2px;}
.exp-main{flex:1;min-width:0;}
.exp-activity{font-size:13px;font-weight:700;color:var(--b800);margin-bottom:3px;}
.exp-meta{font-size:10px;color:var(--tmuted);line-height:1.6;}
.exp-amount{font-size:14px;font-weight:900;font-family:var(--mono);color:#c62828;white-space:nowrap;}
.exp-actions{display:flex;gap:5px;align-items:center;flex-shrink:0;}
.exp-mode{font-size:9px;border-radius:7px;padding:2px 7px;font-family:var(--mono);display:inline-block;margin-right:4px;}
.mode-cash{background:#e8f5e9;color:#1b5e20;border:1px solid #a5d6a7;}
.mode-bank{background:#e3f2fd;color:#1565c0;border:1px solid #90caf9;}
.mode-mtn{background:#fff8e1;color:#f57f17;border:1px solid #ffe082;}
.mode-airtel{background:#fce4ec;color:#c62828;border:1px solid #f48fb1;}
`;

function DueLoanRow({loan, members, emailSending, sendDueEmail, sendDueSMS}){
  const mem = members.find(function(m){ return m.id===loan.memberId; });
  if(!mem) return null;
  const issued = new Date(loan.dateBanked);
  const due = new Date(issued.getFullYear(), issued.getMonth()+(loan.term||12), issued.getDate());
  const msLeft = due - new Date();
  const dl = Math.floor(msLeft/(1000*60*60*24));
  const dueFmt = due.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});
  return (
    <div className="due-loan-row">
      <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
        <Avatar name={mem.name} size={28}/>
        <div>
          <div style={{fontWeight:700,fontSize:12,color:"var(--td)"}}>{mem.name}</div>
          <div style={{fontSize:10,color:"#bf360c",fontFamily:"var(--mono)"}}>Due: {dueFmt} · Balance: {fmt(calcLoan(loan).balance)} · <strong>{dl===0?"TODAY":dl===1?"1 day":dl+" days"}</strong></div>
        </div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        {mem.email&&<button className="btn bemail xs" disabled={emailSending["due_"+loan.id]==="sending"} onClick={function(){sendDueEmail(mem,loan);}}>{emailSending["due_"+loan.id]==="sending"?"⏳":"📨 Email"}</button>}
        {mem.whatsapp&&<a className="btn bwa xs" href={waLink(mem.whatsapp,buildWADueMsg(mem,loan))} target="_blank" rel="noreferrer">{WA_SVG} WA</a>}
        {mem.whatsapp&&<button className="btn bsms xs" disabled={emailSending["sms_due_"+loan.id]==="sending"} onClick={function(){sendDueSMS(mem,loan);}}>{emailSending["sms_due_"+loan.id]==="sending"?"⏳":"📱 SMS"}</button>}
      </div>
    </div>
  );
}

function ProfLoanCard({l, markPd, closeProfile, openEditL}){
  const ov = l.status!=="paid" && l.months>l.term;
  const stats = [
    ["Monthly Payment",fmt(l.monthlyPayment),true],
    ["Interest/Mo",fmt(l.monthlyInt),false],
    ["Amount Paid",fmt(l.amountPaid),false],
    ["Remaining Balance",fmt(l.balance),l.balance>0],
    ["Total Interest ("+l.term+"mo)",fmt(l.totalInterest),false],
    ["Total Due",fmt(l.totalDue),false]
  ];
  const dates = [["Issued",fmtD(l.dateBanked)],["Months",l.months+"mo"],["Settled",l.datePaid?fmtD(l.datePaid):"—"]];
  return (
    <div className={"prof-loan-card"+(l.status==="paid"?" lpaid":ov?" loverdue":" lactive")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div>
          <span style={{fontWeight:800,color:"var(--b800)",fontSize:13}}>{fmt(l.amountLoaned)}</span>
          <span style={{fontSize:10,color:"var(--tmuted)",marginLeft:8,fontFamily:"var(--mono)"}}>Agreed: {l.term}mo term</span>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:700,color:l.method==="reducing"?"#1565c0":"#37474f",background:l.method==="reducing"?"#e3f2fd":"#eceff1",borderRadius:9,padding:"2px 7px"}}>{l.method==="reducing"?"6% Reducing":"4% Flat"}</span>
          <span className={"badge "+(l.status==="paid"?"bpaid":l.months>l.term?"bover":"bactive")}>
            {l.status==="paid"?"✅ Cleared":l.months>l.term?"🔴 Overdue":"🟡 Active"}
          </span>
          {(()=>{const as=APPROVAL_STATUS[l.approvalStatus];return as&&l.approvalStatus!=="approved"?<span style={{fontSize:8,padding:"2px 6px",borderRadius:5,background:as.bg,color:as.color,fontWeight:700,marginLeft:3}}>{as.label}</span>:null;})()}
          {(()=>{const d=classifyLoan(l);return d.class!=="performing"?<span style={{fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:5,background:d.color+"22",color:d.color,marginLeft:2}}>{d.label}</span>:null;})()}
        </div>
      </div>
      <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:8,padding:"8px 10px",marginBottom:8}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px"}}>
          {stats.map(function(item){
            return (
              <div key={item[0]}>
                <div style={{fontSize:8.5,color:"var(--tmuted)",fontFamily:"var(--mono)",textTransform:"uppercase"}}>{item[0]}</div>
                <div style={{fontWeight:700,fontSize:11.5,color:item[2]?"#c62828":"var(--b700)",marginTop:1}}>{item[1]}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:l.status!=="paid"?8:0}}>
        {dates.map(function(item){
          return (
            <div key={item[0]}>
              <div style={{fontSize:8.5,color:"var(--tmuted)",fontFamily:"var(--mono)",textTransform:"uppercase"}}>{item[0]}</div>
              <div style={{fontWeight:600,fontSize:11,color:"var(--b600)",marginTop:1}}>{item[1]}</div>
            </div>
          );
        })}
      </div>
      {/* Repayment Schedule — rendered via proper sub-component (hooks-safe) */}
      <LoanScheduleFooter l={l} markPd={markPd} closeProfile={closeProfile} openEditL={openEditL}/>
    </div>
  );
}

// Proper sub-component so useState is called at component level — not inside an IIFE
function LoanScheduleFooter({l, markPd, closeProfile, openEditL}){
  const [showSched,setShowSched] = React.useState(false);
  const term=l.term||12;
  const isReducing=(l.amountLoaned||0)>=7000000;
  const rate=isReducing?0.06:0.04;
  const schedule=[];
  if(l.dateBanked){
    let bal=l.amountLoaned;
    const start=new Date(l.dateBanked);
    const principalPerMonth=Math.round(l.amountLoaned/term);
    for(let i=1;i<=term;i++){
      const due=new Date(start.getFullYear(),start.getMonth()+i,start.getDate());
      const interest=isReducing?Math.round(bal*rate):Math.round(l.amountLoaned*rate);
      const principal=principalPerMonth;
      const payment=principal+interest;
      const cumPaid=i*payment;
      const isPaid=(l.amountPaid||0)>=cumPaid;
      bal=Math.max(0,bal-principal);
      schedule.push({n:i,due,payment,principal,interest,balance:bal,isPaid});
    }
  }
  return (
    <React.Fragment>
      <div style={{display:"flex",gap:6,marginTop:l.status!=="paid"?0:6,flexWrap:"wrap"}}>
        {l.status!=="paid"&&(
          <React.Fragment>
            {(l.approvalStatus==="approved"||!l.approvalStatus)
              ?<button className="btn bk sm" onClick={function(){markPd(l.id);}}>✓ Settle</button>
              :<button className="btn bg sm" disabled style={{opacity:.5}}>⏳ Pending</button>}
            <button className="btn bg sm" onClick={function(){closeProfile();openEditL(l);}}>✏️ Edit</button>
          </React.Fragment>
        )}
        {schedule.length>0&&(
          <button className="btn bg sm" onClick={()=>setShowSched(s=>!s)} style={{fontSize:10}}>
            {showSched?"▲ Hide":"📅 Repayment Schedule"}
          </button>
        )}
      </div>
      {showSched&&schedule.length>0&&(
        <div style={{marginTop:8,overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr style={{background:"var(--b50)"}}>
              {["Mo","Due Date","Payment","Principal","Interest","Balance","Status"].map(h=>(
                <th key={h} style={{padding:"4px 6px",textAlign:h==="Mo"||h==="Status"?"center":"right",fontSize:8,fontFamily:"var(--mono)",fontWeight:700,color:"var(--b700)",borderBottom:"1.5px solid var(--bdr)",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {schedule.map(row=>(
                <tr key={row.n} style={{background:row.isPaid?"#f1f8e9":new Date()>row.due&&!row.isPaid?"#ffebee":"#fff",borderBottom:"1px solid #eef5ff"}}>
                  <td style={{padding:"4px 6px",textAlign:"center",fontFamily:"var(--mono)",fontWeight:700,color:"var(--b700)",fontSize:9}}>{row.n}</td>
                  <td style={{padding:"4px 6px",textAlign:"right",fontFamily:"var(--mono)",fontSize:9,whiteSpace:"nowrap"}}>{row.due.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}</td>
                  <td style={{padding:"4px 6px",textAlign:"right",fontFamily:"var(--mono)",fontWeight:700,color:"#1565c0",fontSize:9}}>{fmt(row.payment)}</td>
                  <td style={{padding:"4px 6px",textAlign:"right",fontFamily:"var(--mono)",fontSize:9}}>{fmt(row.principal)}</td>
                  <td style={{padding:"4px 6px",textAlign:"right",fontFamily:"var(--mono)",fontSize:9,color:"#c62828"}}>{fmt(row.interest)}</td>
                  <td style={{padding:"4px 6px",textAlign:"right",fontFamily:"var(--mono)",fontSize:9,color:row.balance>0?"#e65100":"#1b5e20",fontWeight:700}}>{fmt(row.balance)}</td>
                  <td style={{padding:"4px 6px",textAlign:"center"}}><span style={{fontSize:8,fontWeight:700,padding:"1px 5px",borderRadius:10,background:row.isPaid?"#e8f5e9":new Date()>row.due?"#ffebee":"#e3f2fd",color:row.isPaid?"#1b5e20":new Date()>row.due?"#c62828":"#1565c0"}}>{row.isPaid?"✓ Paid":new Date()>row.due?"Overdue":"Pending"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </React.Fragment>
  );
}

function TermSelectorButtons({lF, setLF}){
  const terms = [3,6,9,12,18,24];
  const base = {amountLoaned:+lF.amountLoaned, dateBanked:lF.dateBanked||new Date().toISOString().split("T")[0], status:"active", amountPaid:0};
  const bestInt = calcLoan({...base, term:3}).totalInterest;
  return terms.map(function(t){
    const preview = calcLoan({...base, term:t});
    const isSelected = (+lF.term||12)===t;
    const extraInt = preview.totalInterest - bestInt;
    const color = t<=3?"#1b5e20":t<=6?"#2e7d32":t<=12?"#1565c0":t<=18?"#e65100":"#b71c1c";
    return (
      <button key={t} onClick={function(){setLF(function(f){return {...f,term:t};});}}
        style={{flex:1,minWidth:72,padding:"8px 5px",borderRadius:9,border:isSelected?"2px solid "+color:"2px solid #e0e0e0",background:isSelected?color+"18":"#fff",cursor:"pointer",textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:800,color:isSelected?color:"#555"}}>{t} mo</div>
        <div style={{fontSize:10,fontWeight:700,color:isSelected?color:"#888",marginTop:2,fontFamily:"var(--mono)"}}>{fmt(preview.monthlyPayment)}<span style={{fontWeight:400}}>/mo</span></div>
        {t<=3?<div style={{fontSize:9,color:"#1b5e20",marginTop:1}}>✓ Best value</div>:<div style={{fontSize:9,color:color,marginTop:1}}>+{fmt(extraInt)} extra</div>}
      </button>
    );
  });
}



function InvestmentCard({inv, openEditInv, delInv}){
  const statusColor = inv.status==="active" ? "#1b5e20" : "#546e7a";
  const stats = [
    ["Amount Invested", fmt(+inv.amount||0), "var(--b700)"],
    ["Interest Earned", fmt(+inv.interestEarned||0), "#1b5e20"],
    ["Retained (60%)", fmt(Math.round((+inv.interestEarned||0)*0.6)), "var(--tmuted)"],
    ["To Members (40%)", fmt(Math.round((+inv.interestEarned||0)*0.4)), "#1b5e20"],
  ];
  return (
    <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:10}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"var(--b800)"}}>{inv.platform}</div>
          <div style={{fontSize:11,color:"var(--tmuted)",marginTop:2,fontFamily:"var(--mono)"}}>{INV_TYPE_LABELS[inv.type]||inv.type} · Invested {fmtD(inv.dateInvested)}</div>
        </div>
        <span style={{fontSize:9,fontWeight:700,background:inv.status==="active"?"#e8f5e9":"#eceff1",color:statusColor,borderRadius:20,padding:"2px 10px",fontFamily:"var(--mono)"}}>{inv.status==="active"?"● Active":"◼ Closed"}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:7,marginBottom:10}}>
        {stats.map(function(item){
          return (
            <div key={item[0]} style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:8,padding:"7px 9px"}}>
              <div style={{fontSize:9,color:"var(--tmuted)",fontFamily:"var(--mono)",textTransform:"uppercase",marginBottom:2}}>{item[0]}</div>
              <div style={{fontWeight:800,fontSize:13,color:item[2],fontFamily:"var(--mono)"}}>{item[1]}</div>
            </div>
          );
        })}
      </div>
      {inv.notes&&<div style={{fontSize:11,color:"var(--tmuted)",fontStyle:"italic",marginBottom:8}}>📝 {inv.notes}</div>}
      {inv.approvedBy&&<div style={{fontSize:10,color:"#1b5e20",marginBottom:4,fontFamily:"var(--mono)"}}>✅ Approved by: {inv.approvedBy}{inv.approvalDate?" on "+fmtD(inv.approvalDate):""}</div>}
      {inv.approvalStatus&&inv.approvalStatus!=="approved"&&<div style={{fontSize:10,color:inv.approvalStatus==="rejected"?"#c62828":"#f57f17",marginBottom:4,fontFamily:"var(--mono)"}}>{inv.approvalStatus==="rejected"?"❌ Rejected":"⏳ Pending approval"}</div>}
      {(inv.docNames||[]).length>0&&(
        <div style={{marginBottom:8}}>
          <div style={{fontSize:9,color:"var(--tmuted)",textTransform:"uppercase",letterSpacing:.6,marginBottom:4,fontFamily:"var(--mono)"}}>📎 {inv.docNames.length} document{inv.docNames.length>1?"s":""} attached</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {inv.docNames.map((name,i)=>(
              <a key={i} href={inv.documents[i]} download={name} style={{fontSize:9,background:"#e3f2fd",color:"#1565c0",border:"1px solid #90caf9",borderRadius:6,padding:"2px 8px",textDecoration:"none",fontFamily:"var(--mono)"}}>📄 {name}</a>
            ))}
          </div>
        </div>
      )}
      {inv.lastUpdated&&<div style={{fontSize:10,color:"var(--tmuted)",marginBottom:8,fontFamily:"var(--mono)"}}>Last updated: {fmtD(inv.lastUpdated)}</div>}
      <div style={{display:"flex",gap:7}}>
        <button className="btn bg xs" onClick={function(){openEditInv(inv);}}>✏️ Update</button>
        <button className="btn bd xs" onClick={function(){delInv(inv.id);}}>🗑 Remove</button>
      </div>
    </div>
  );
}



function ExpCategoryButtons({expF, setExpF}){
  return EXP_CATEGORIES.map(function(cat){
    const val = cat.toLowerCase().replace(/\s+&\s+/g,"_").replace(/\s+/g,"_");
    const active = expF.category === val;
    return React.createElement("button", {
      key: val,
      onClick: function(){ setExpF(function(f){ return {...f, category:val, categoryCustom: val==="other" ? f.categoryCustom : ""}; }); },
      style: {padding:"6px 11px", borderRadius:8, border: active?"2px solid var(--b600)":"2px solid var(--bdr)", background: active?"var(--b100)":"#fff", cursor:"pointer", fontSize:11, fontWeight: active?700:400, color: active?"var(--b700)":"var(--tm)"}
    }, cat);
  });
}

function LoanLimitBadge({memberId, members, amountLoaned}){
  if(!memberId) return null;
  const m = members.find(m=>m.id===+memberId);
  if(!m) return null;
  const lim = borrowLimit(m), tb = totBanked(m);
  const mult = tb < 1000000 ? "×1.5" : "×2";
  const over = +amountLoaned > lim;
  return (
    <div style={{marginTop:4,padding:"5px 8px",borderRadius:7,background:over?"#ffebee":"#e8f5e9",border:"1px solid "+(over?"#ef9a9a":"#a5d6a7"),fontSize:10,color:over?"#b71c1c":"#1b5e20"}}>
      {over
        ? <React.Fragment><strong>⚠ Exceeds limit!</strong> Max: {fmt(lim)} ({mult} of {fmt(tb)})</React.Fragment>
        : <React.Fragment><strong>✓ Within limit.</strong> Max: {fmt(lim)} ({mult} × {fmt(tb)})</React.Fragment>
      }
    </div>
  );
}

function FlatLoanPreview({lFPreview, lF, setLF}){
  const bestCase = calcLoan({amountLoaned:+lF.amountLoaned, dateBanked:lF.dateBanked||new Date().toISOString().split("T")[0], status:"active", amountPaid:0, term:3});
  const extraInt = lFPreview.totalInterest - bestCase.totalInterest;
  const extraPct = bestCase.totalInterest > 0 ? Math.round((extraInt/bestCase.totalInterest)*100) : 0;
  const term = lFPreview.term;
  const advisory = term<=6 ? null
    : term<=9  ? {level:"info",    icon:"ℹ️", msg:"Choosing "+term+" months instead of 6 costs an extra "+fmt(extraInt)+" in interest — "+extraPct+"% more."}
    : term<=12 ? {level:"warn",    icon:"⚠️", msg:"At "+term+" months you pay "+fmt(extraInt)+" more interest than at 6 months."}
    : term<=18 ? {level:"serious", icon:"🔴", msg:term+"-month term costs "+fmt(extraInt)+" extra ("+extraPct+"% more than 6 months). Advise member to clear early if possible."}
    :            {level:"danger",  icon:"🚨", msg:"24 months MAXIMUM. This member will pay "+fmt(extraInt)+" extra interest — "+extraPct+"% more than a 6-month loan. Record verbal agreement carefully."};
  return (
    <React.Fragment>
      {advisory && (
        <div style={{borderRadius:9,padding:"9px 12px",marginBottom:8,background:advisory.level==="info"?"#e3f2fd":advisory.level==="warn"?"#fff8e1":advisory.level==="serious"?"#fbe9e7":"#ffebee",border:"1px solid "+(advisory.level==="info"?"#90caf9":advisory.level==="warn"?"#ffe082":advisory.level==="serious"?"#ffab91":"#ef9a9a")}}>
          <div style={{fontWeight:700,fontSize:11,color:advisory.level==="info"?"#1565c0":advisory.level==="warn"?"#e65100":advisory.level==="serious"?"#bf360c":"#b71c1c",marginBottom:3}}>{advisory.icon} Repayment Advisory</div>
          <div style={{fontSize:11,color:"#444",lineHeight:1.5}}>{advisory.msg}</div>
        </div>
      )}
      <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px",marginBottom:8}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--b700)",letterSpacing:1,textTransform:"uppercase",marginBottom:8,fontFamily:"var(--mono)"}}>📊 Term Comparison — tap to select</div>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          <TermSelectorButtons lF={lF} setLF={setLF}/>
        </div>
      </div>
      <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--b700)",letterSpacing:1,textTransform:"uppercase",marginBottom:6,fontFamily:"var(--mono)"}}>✅ Agreed: {lFPreview.term} months — 4% Flat</div>
        <div className="crow"><span className="cl">Monthly payment</span><span className="cv ok" style={{fontSize:14,fontWeight:900}}>{fmt(lFPreview.monthlyPayment)}</span></div>
        <div className="crow"><span className="cl">Interest/month</span><span className="cv">{fmt(lFPreview.monthlyInt)}</span></div>
        <div className="crow"><span className="cl">Total interest ({lFPreview.term}mo)</span><span className="cv d">{fmt(lFPreview.totalInterest)}</span></div>
        <div className="crow" style={{borderTop:"1px solid var(--bdr)",paddingTop:4,marginTop:3}}>
          <span className="cl">Total due</span><span className="cv" style={{fontWeight:800}}>{fmt(lFPreview.totalDue)}</span>
        </div>
        {lFPreview.amountPaid>0 && <div className="crow"><span className="cl">Balance remaining</span><span className={"cv"+(lFPreview.balance>0?" d":" ok")}>{fmt(lFPreview.balance)}</span></div>}
      </div>
    </React.Fragment>
  );
}


function PayModal({loan, mem, payF, setPayF, savePay, setPayModal}){
  if(!loan)return null;
  const previewPaid=(loan.amountPaid||0)+(+payF.amount||0);
  const previewCalc=calcLoan({...loan,amountPaid:previewPaid});
  return(
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&setPayModal(false)}>
      <div className="modal wide">
        <div className="mhdr">
          <div className="mtitle">Record Loan Payment{mem?" — "+mem.name:""}</div>
          <button className="mclose" onClick={()=>setPayModal(false)}>✕</button>
        </div>
        <div style={{background:"linear-gradient(135deg,var(--b800),var(--b600))",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          {[["Principal",fmt(loan.amountLoaned),"#fff"],["Monthly Pay",fmt(loan.monthlyPayment),"#90caf9"],["Paid So Far",fmt(loan.amountPaid),"#a5d6a7"],["Balance",fmt(loan.balance),"#ef9a9a"]].map(([l,v,c])=>(
            <div key={l}><div style={{fontSize:9,color:"var(--b300)",fontFamily:"var(--mono)",textTransform:"uppercase"}}>{l}</div><div style={{fontWeight:800,color:c,fontSize:14}}>{v}</div></div>
          ))}
        </div>
        <div className="fgrid">
          <div className="fg"><label className="fl">Payment Date</label><input className="fi" type="date" value={payF.date} onChange={e=>setPayF(f=>({...f,date:e.target.value}))}/></div>
          <div className="fg"><label className="fl">Amount Paid (UGX)</label><input className="fi" type="number" value={payF.amount} onChange={e=>setPayF(f=>({...f,amount:e.target.value}))} placeholder="0"/></div>
          <div className="fg ff"><label className="fl">Mode of Payment</label>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
              {[["cash","💵 Cash"],["bank","🏦 Bank"],["mtn","📱 MTN MoMo"],["airtel","📱 Airtel"]].map(([v,lbl])=>(
                <button key={v} onClick={()=>setPayF(f=>({...f,payMode:v}))} style={{flex:1,minWidth:80,padding:"7px 4px",borderRadius:9,border:payF.payMode===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:payF.payMode===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:12,fontWeight:payF.payMode===v?700:400,color:payF.payMode===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
              ))}
            </div>
          </div>
          {payF.payMode==="bank"&&<React.Fragment>
            <div className="fg"><label className="fl">Bank Name</label><input className="fi" value={payF.bankName} onChange={e=>setPayF(f=>({...f,bankName:e.target.value}))} placeholder="e.g. Stanbic Bank"/></div>
            <div className="fg"><label className="fl">Account Number</label><input className="fi" value={payF.bankAccount} onChange={e=>setPayF(f=>({...f,bankAccount:e.target.value}))} placeholder="Account number"/></div>
            <div className="fg ff"><label className="fl">Depositor Name</label><input className="fi" value={payF.depositorName} onChange={e=>setPayF(f=>({...f,depositorName:e.target.value}))} placeholder="Name of person making deposit"/></div>
            <div className="fg ff"><label className="fl">Transaction / Reference ID</label><input className="fi" value={payF.transactionId} onChange={e=>setPayF(f=>({...f,transactionId:e.target.value}))} placeholder="Bank reference or transaction ID"/></div>
          </React.Fragment>}
          {(payF.payMode==="mtn"||payF.payMode==="airtel")&&<React.Fragment>
            <div className="fg"><label className="fl">{payF.payMode==="mtn"?"MTN":"Airtel"} Number</label><input className="fi" type="tel" value={payF.mobileNumber} onChange={e=>setPayF(f=>({...f,mobileNumber:e.target.value}))} placeholder="e.g. 0772123456"/></div>
            <div className="fg"><label className="fl">Transaction ID</label><input className="fi" value={payF.transactionId} onChange={e=>setPayF(f=>({...f,transactionId:e.target.value}))} placeholder="e.g. QK7XXXXXX"/></div>
          </React.Fragment>}
          <div className="fg ff"><label className="fl">Attach Proof of Payment <span style={{fontWeight:400,color:"var(--tmuted)"}}>(photo or PDF)</span></label>
            <input className="fi" type="file" accept="image/*,application/pdf" style={{padding:"6px 8px"}}
              onChange={e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=r=>setPayF(f=>({...f,attachmentName:file.name,attachmentData:r.target.result}));reader.readAsDataURL(file);}}/>
            {payF.attachmentName&&<div style={{fontSize:10,color:"#1b5e20",marginTop:3,fontFamily:"var(--mono)"}}>✓ {payF.attachmentName} attached</div>}
          </div>
        </div>
        {+payF.amount>0&&<div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px",marginTop:10}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--b700)",letterSpacing:1,textTransform:"uppercase",marginBottom:6,fontFamily:"var(--mono)"}}>📊 After This Payment</div>
          <div className="crow"><span className="cl">Amount paying now</span><span className="cv ok">{fmt(+payF.amount)}</span></div>
          <div className="crow"><span className="cl">Total paid after this</span><span className="cv">{fmt(previewPaid)}</span></div>
          <div className="crow" style={{borderTop:"1px solid var(--bdr)",paddingTop:4,marginTop:3}}>
            <span className="cl">Remaining balance</span>
            <span className={"cv"+(previewCalc.balance<=0?" ok":" d")} style={{fontSize:14,fontWeight:900}}>
              {previewCalc.balance<=0?"✓ FULLY SETTLED":fmt(previewCalc.balance)}
            </span>
          </div>
          {previewCalc.balance>0&&<div className="crow"><span className="cl">Total due (incl. interest)</span><span className="cv">{fmt(previewCalc.totalDue)}</span></div>}
        </div>}
        <div className="fa"><button className="btn bg" onClick={()=>setPayModal(false)}>Cancel</button><button className="btn bk" onClick={savePay}>✓ Record Payment</button></div>
      </div>
    </div>
  );
}

// ── SAVINGS & EXPENSES BAR CHART ────────────────────────────────────────────
function SavingsExpensesChart({savingsData, expensesData}){
  const canvasRef = React.useRef(null);
  const chartRef  = React.useRef(null);
  const [mode, setMode] = React.useState("savings");
  const [loaded, setLoaded] = React.useState(false);
  useEffect(()=>{
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js")
      .then(()=>setLoaded(true)).catch(()=>{});
  },[]);
  useEffect(()=>{
    if(!loaded||!canvasRef.current)return;
    if(chartRef.current){chartRef.current.destroy();chartRef.current=null;}
    const ctx=canvasRef.current.getContext("2d");
    if(mode==="savings"){
      chartRef.current=new window.Chart(ctx,{type:"bar",data:{labels:savingsData.map(d=>d.label),datasets:[{label:"Pool (UGX)",data:savingsData.map(d=>d.total),backgroundColor:"rgba(21,101,192,0.75)",borderColor:"#1565c0",borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>" UGX "+Number(c.raw).toLocaleString("en-UG")}}},scales:{y:{ticks:{callback:v=>"UGX "+Number(v/1000000).toFixed(1)+"m"},grid:{color:"#eef5ff"}},x:{grid:{display:false}}}}});
    } else {
      const cats=["meetings","transport","printing","legal_registration","banking","operations","refunds","communications"];
      const colors=["#1565c0","#e65100","#6a1b9a","#00695c","#c62828","#37474f","#2e7d32","#0277bd"];
      const labels=["Meetings","Transport","Printing","Legal/Reg","Banking","Operations","Refunds","Comms"];
      chartRef.current=new window.Chart(ctx,{type:"bar",data:{labels:expensesData.map(d=>d.month),datasets:cats.map((cat,i)=>({label:labels[i],data:expensesData.map(d=>d[cat]||0),backgroundColor:colors[i]+"cc",borderColor:colors[i],borderWidth:1,borderRadius:2}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{font:{size:9},padding:6,boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+": UGX "+Number(c.raw).toLocaleString("en-UG")}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:8}}},y:{stacked:true,ticks:{callback:v=>"UGX "+Number(v).toLocaleString("en-UG"),font:{size:8}},grid:{color:"#eef5ff"}}}}});
    }
    return ()=>{if(chartRef.current){chartRef.current.destroy();chartRef.current=null;}};
  },[loaded,mode,savingsData,expensesData]);
  return (
    <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:"var(--b800)"}}>{mode==="savings"?"📈 Cumulative Savings Pool Growth":"🧾 Expenses by Month & Category"}</div>
          <div style={{fontSize:10,color:"var(--tmuted)",marginTop:1}}>{mode==="savings"?"Quarterly pool growth since BIDA started (2022–2025)":"All expenses broken down by category per month"}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {[["savings","📈 Savings"],["expenses","🧾 Expenses"]].map(([v,lbl])=>(
            <button key={v} type="button" onClick={()=>setMode(v)} style={{padding:"5px 12px",borderRadius:8,border:mode===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:mode===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:mode===v?700:400,color:mode===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
          ))}
        </div>
      </div>
      <div style={{height:220,position:"relative"}}>
        {!loaded&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--tmuted)",fontSize:11}}>⏳ Loading chart…</div>}
        <canvas ref={canvasRef} style={{display:loaded?"block":"none"}}/>
      </div>
    </div>
  );
}

function AppInner(){
  const [tab,setTab]        = useState("savings");
  const [authUser,setAuthUser] = useState(null); // null = logged out
  const SESSION_MINUTES = 5;

  const [loginPin,setLoginPin] = useState("");
  const [loginRole,setLoginRole] = useState("treasurer");
  const [loginErr,setLoginErr]   = useState("");
  const [loginAttempts,setLoginAttempts] = useState(0);
  const [loginLockedUntil,setLoginLockedUntil] = useState(null);
  const [members,setMembers]= useState(INIT_MEMBERS);
  const [loans,setLoans]    = useState(INIT_LOANS);
  const [expenses,setExpenses] = useState(INIT_EXPENSES.map(sanitiseExpense));
  const [serviceProviders,setServiceProviders] = useState(INIT_SERVICE_PROVIDERS);
  // Sync state: "idle" | "loading" | "synced" | "syncing" | "offline" | "error"
  const [syncStatus,setSyncStatus] = useState("idle");
  const [benovSelMember,setBenovSelMember] = useState("");
  // Contribution log: {memberId, date, category, amount, note}
  const [contribLog,setContribLog] = useState([]);
  const [contribModal,setContribModal] = useState(false);
  const [contribF,setContribF] = useState({memberId:"",date:new Date().toISOString().split("T")[0],category:"monthlySavings",amount:"",note:""});
  // Dividend payout records
  const [dividendPayouts,setDividendPayouts] = useState([]);
  const [dividendModal,setDividendModal] = useState(false);
  // Expense approval threshold
  const EXPENSE_APPROVAL_THRESHOLD = 100000; // expenses >= 100k need Admin approval
  const [benovClaimType,setBenovClaimType] = useState("death");
  const [benovRetention,setBenovRetention] = useState("compensate");
  const [supaKeyInput,setSupaKeyInput] = useState(getSupaKey());
  const [pinMgmt,setPinMgmt]         = useState({});
  const [approvalQueue,setApprovalQueue] = useState([]); // pending items across all workflows
  const [rejectNote,setRejectNote]       = useState("");
  const [rejectTarget,setRejectTarget]   = useState(null);     // role->newPin input
  const [pinMsg,setPinMsg]           = useState({});      // role->success/error message
  const [pinConfirm,setPinConfirm]   = useState({});      // role->confirmPin input
  const [showPins,setShowPins]       = useState({});      // role->bool show/hide
  const [dbLoaded,setDbLoaded] = useState(false);
  const [spModal,setSpModal] = useState(false);
  const [spF,setSpF] = useState({
    isMember:true, memberId:"",
    companyName:"", tin:"", directorName:"", phone:"", serviceType:"", description:"",
    registeredDate:new Date().toISOString().split("T")[0],
    regFee:0, regFeePaid:false, approvalStatus:"pending", approvedByMemberId:"",
    expiryDate:"",
  });
  const [editSp,setEditSp] = useState(null);
  const [receipts,setReceipts] = useState(INIT_RECEIPTS);
  const [pending,setPending]   = useState(INIT_PENDING); // pending approval queue
  const [expModal,setExpModal] = useState(false);
  const [editExp,setEditExp]   = useState(null);
  const [expF,setExpF]         = useState({...emptyE});
  const [investments,setInvestments] = useState(INIT_INVESTMENTS);
  const [ledger,setLedger]           = useState([]); // double-entry ledger
  const [auditLog,setAuditLog]       = useState([]); // immutable audit trail
  const [schedules,setSchedules]     = useState({}); // repayment schedules keyed by loanId
  const [dividendRun,setDividendRun] = useState(null); // last dividend calculation

  const [invModal,setInvModal] = useState(false);
  const [editInv,setEditInv]   = useState(null);
  const [invF,setInvF]         = useState({...emptyInv});
  const [search,setSearch]  = useState("");
  const [pdfGen,setPdfGen]  = useState(null);
  const [sharedPDF,setSharedPDF] = useState(null);
  const [emailSending,setEmailSending] = useState({});
  const [emailSetup,setEmailSetup]     = useState(false);
  const [profId,setProfId]  = useState(null);
  const [profEdit,setProfEdit] = useState(false);
  const [profF,setProfF]       = useState(null);
  const [confirmOpt,setConfirmOpt] = useState(false);
  const [lModal,setLModal]  = useState(false);
  const [editL,setEditL]    = useState(null);
  const [lF,setLF]          = useState(emptyL);
  const [payModal,setPayModal]   = useState(false);
  const [payF,setPayF]           = useState({...emptyPay});
  const [addMModal,setAddMModal] = useState(false);
  const [addMF,setAddMF]    = useState({name:"",email:"",whatsapp:"",phone:"",address:"",nin:"",photoUrl:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,shareUnitsInput:0,voluntaryDeposit:0,joinDate:new Date().toISOString().split("T")[0],referralSource:"",referredById:"",payMode:"cash",bankName:"",bankAccount:"",depositorName:"",mobileNumber:"",transactionId:"",initialPaymentReceived:false,initialPaymentNote:""});

  // ── Live FX rates ──
  const [fxRates,setFxRates]=useState(null);
  const [fxLoading,setFxLoading]=useState(true);
  const [liveTime,setLiveTime]=useState(new Date());

  // ── Live clock — ticks every second ──
  useEffect(()=>{
    const t=setInterval(()=>setLiveTime(new Date()),1000);
    return ()=>clearInterval(t);
  },[]);

  // ── Session timeout: auto-logout after 10 min idle ──
  useEffect(()=>{
    if(!authUser) return;
    let timer;
    const reset=()=>{ clearTimeout(timer); timer=setTimeout(()=>{ setAuthUser(null); alert("Your session expired after "+SESSION_MINUTES+" minutes of inactivity. Please log in again."); }, SESSION_MINUTES*60*1000); };
    const events=["mousedown","mousemove","keydown","touchstart","scroll","click"];
    events.forEach(e=>window.addEventListener(e,reset,{passive:true}));
    reset();
    return ()=>{ clearTimeout(timer); events.forEach(e=>window.removeEventListener(e,reset)); };
  },[authUser]);

  // ── Load all data from Supabase on first mount ──
  useEffect(()=>{
    const key=getSupaKey();
    if(!key||dbLoaded) return;
    setSyncStatus("loading");
    loadAllFromSupabase()
      .then(data=>{
        // Safe initial load: DB is source of truth.
        // INIT_ data is only used if DB returns nothing (first ever launch).
        // Merge strategy: DB records win; INIT records not in DB are kept (safety net).
        if(data.members&&data.members.length>0){
          const hasValid=data.members.some(m=>(m.membership||0)>0||(m.monthlySavings||0)>0);
          if(hasValid){
            setMembers(prev=>{
              const dbIds=new Set(data.members.map(m=>m.id));
              // Keep any local members not yet in DB (just registered, not yet synced)
              const localOnly=prev.filter(m=>!dbIds.has(m.id));
              return [...data.members,...localOnly];
            });
          }
        }
        if(data.loans&&data.loans.length>=0){
          setLoans(prev=>{
            const dbIds=new Set(data.loans.map(l=>l.id));
            const localOnly=prev.filter(l=>!dbIds.has(l.id));
            return [...data.loans,...localOnly];
          });
        }
        if(data.expenses&&data.expenses.length>=0){
          const hasValid=data.expenses.length===0||data.expenses.some(e=>(e.amount||0)>0);
          if(hasValid){
            setExpenses(prev=>{
              const dbIds=new Set(data.expenses.map(e=>e.id));
              const localOnly=prev.filter(e=>!dbIds.has(e.id));
              return [...data.expenses,...localOnly];
            });
          }
        }
        if(data.investments&&data.investments.length>=0) setInvestments(data.investments);
        if(data.serviceProviders&&data.serviceProviders.length>0) setServiceProviders(data.serviceProviders);
        if(data.ledger&&data.ledger.length>0) setLedger(data.ledger);
        if(data.auditLog&&data.auditLog.length>0) setAuditLog(data.auditLog);
        if(data.contribLog&&data.contribLog.length>0) setContribLog(data.contribLog);
        if(data.dividendPayouts&&data.dividendPayouts.length>0) setDividendPayouts(data.dividendPayouts);
        setDbLoaded(true); setSyncStatus("synced");
        replayOfflineQueue(setSyncStatus);
      })
      .catch(e=>{ console.error("Supabase load failed:",e.message); setSyncStatus("idle"); });
  },[supaKeyInput]);

  // ── When internet returns: replay queue then re-pull all data ──
  useEffect(()=>{
    const h=async()=>{
      setSyncStatus("syncing");
      // First push any queued offline changes
      await replayOfflineQueue(setSyncStatus);
      // Then pull fresh data from DB to catch anything others saved while we were offline
      try{
        const data=await loadAllFromSupabase();
        if(data.members&&data.members.length>0){
          setMembers(prev=>{
            const dbIds=new Set(data.members.map(m=>m.id));
            return [...data.members,...prev.filter(m=>!dbIds.has(m.id))];
          });
        }
        if(data.loans&&data.loans.length>=0){
          setLoans(prev=>{
            const dbIds=new Set(data.loans.map(l=>l.id));
            return [...data.loans,...prev.filter(l=>!dbIds.has(l.id))];
          });
        }
        if(data.expenses&&data.expenses.length>=0){
          setExpenses(prev=>{
            const dbIds=new Set(data.expenses.map(e=>e.id));
            return [...data.expenses,...prev.filter(e=>!dbIds.has(e.id))];
          });
        }
        if(data.investments&&data.investments.length>=0) setInvestments(data.investments);
        if(data.contribLog&&data.contribLog.length>=0) setContribLog(data.contribLog);
        if(data.dividendPayouts&&data.dividendPayouts.length>=0) setDividendPayouts(data.dividendPayouts);
        setSyncStatus("synced");
      }catch(e){ console.warn("Post-reconnect pull failed:",e.message); }
    };
    window.addEventListener("online",h);
    return ()=>window.removeEventListener("online",h);
  },[]);

  // ── Cross-device sync: poll Supabase every 15 seconds ──
  // When another device saves a record, this pulls it in automatically
  useEffect(()=>{
    const key=getSupaKey();
    if(!key||!authUser) return; // only poll when logged in with a key
    const poll=async()=>{
      try{
        // Fetch latest data silently in background
        const [freshMembers,freshLoans,freshExpenses,freshInvestments,freshSettings]=await Promise.all([
          supaFetch("members"),
          supaFetch("loans"),
          supaFetch("expenses"),
          supaFetch("investments"),
          supaFetch("settings").catch(()=>[]),
        ]);
        // Apply any PIN changes made on other devices
        if(Array.isArray(freshSettings)){
          freshSettings.forEach(row=>{
            if(row.key&&row.key.startsWith("pin_")&&row.value){
              savePin(row.key.replace("pin_",""),row.value);
            }
          });
        }
        // SAFE MERGE: DB is the source of truth. Only update state if DB has valid data.
        // NEVER let a poll with fewer records wipe records only in local state —
        // local state is merged with DB (DB wins on conflict, local additions are preserved
        // until they appear in the next poll after being saved).
        if(freshMembers&&freshMembers.length>0&&freshMembers.some(m=>(m.membership||0)+(m.monthlySavings||0)+(m.membership||0)>0)){
          const sanitised=freshMembers.map(sanitiseMember);
          // Merge: keep local members that haven't reached DB yet
          setMembers(prev=>{
            const dbIds=new Set(sanitised.map(m=>m.id));
            const localOnly=prev.filter(m=>!dbIds.has(m.id));
            return [...sanitised,...localOnly];
          });
        }
        if(freshLoans&&freshLoans.length>=0){
          const sanitised=freshLoans.map(sanitiseLoan);
          setLoans(prev=>{
            const dbIds=new Set(sanitised.map(l=>l.id));
            const localOnly=prev.filter(l=>!dbIds.has(l.id));
            return [...sanitised,...localOnly];
          });
        }
        if(freshExpenses&&freshExpenses.length>=0&&(freshExpenses.length===0||freshExpenses.some(e=>(e.amount||0)>0))){
          const sanitised=freshExpenses.map(sanitiseExpense);
          setExpenses(prev=>{
            const dbIds=new Set(sanitised.map(e=>e.id));
            const localOnly=prev.filter(e=>!dbIds.has(e.id));
            return [...sanitised,...localOnly];
          });
        }
        if(freshInvestments&&freshInvestments.length>=0){
          const sanitised=freshInvestments.map(sanitiseInvestment);
          setInvestments(prev=>{
            const dbIds=new Set(sanitised.map(i=>i.id));
            const localOnly=prev.filter(i=>!dbIds.has(i.id));
            return [...sanitised,...localOnly];
          });
        }
        // Also pull contribution log and dividend payouts
        const [freshContrib,freshDividends]=await Promise.all([
          supaFetch("contrib_log").catch(()=>null),
          supaFetch("dividend_payouts").catch(()=>null),
        ]);
        if(freshContrib&&freshContrib.length>=0){
          setContribLog(prev=>{
            const dbIds=new Set(freshContrib.map(c=>c.id));
            return [...freshContrib,...prev.filter(c=>!dbIds.has(c.id))];
          });
        }
        if(freshDividends&&freshDividends.length>=0) setDividendPayouts(freshDividends);
      }catch(e){
        // Silent fail — don't show error for background poll
        console.debug("Background sync poll failed:",e.message);
      }
    };
    // Poll immediately on login, then every 15 seconds
    poll();
    const interval=setInterval(poll, SYNC_INTERVAL_MS);
    return ()=>clearInterval(interval);
  },[authUser, supaKeyInput]);

  useEffect(()=>{
    fetch("https://open.er-api.com/v6/latest/UGX")
      .then(r=>r.json())
      .then(data=>{
        if(data&&data.rates){
          const r=data.rates;
          const inv=x=>x>0?(1/x):null;
          setFxRates([
            {label:"UGX/USD",rate:inv(r.USD)?inv(r.USD).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,","):"—",color:"#1565c0"},
            {label:"UGX/KES",rate:inv(r.KES)?inv(r.KES).toFixed(1):"—",color:"#2e7d32"},
            {label:"UGX/TZS",rate:inv(r.TZS)?inv(r.TZS).toFixed(2):"—",color:"#e65100"},
            {label:"UGX/EUR",rate:inv(r.EUR)?inv(r.EUR).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,","):"—",color:"#6a1b9a"},
            {label:"UGX/GBP",rate:inv(r.GBP)?inv(r.GBP).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,","):"—",color:"#00695c"},
          ]);
        }
      })
      .catch(()=>setFxRates([
        {label:"UGX/USD",rate:"3,720",color:"#1565c0"},
        {label:"UGX/KES",rate:"28.5",color:"#2e7d32"},
        {label:"UGX/TZS",rate:"0.64",color:"#e65100"},
        {label:"UGX/EUR",rate:"4,050",color:"#6a1b9a"},
        {label:"UGX/GBP",rate:"4,720",color:"#00695c"},
      ]))
      .finally(()=>setFxLoading(false));
  },[]);
  const FX_RATES=fxRates||[];

  const loansCalc = useMemo(()=>loans.map(l=>({...l,...calcLoan(l)})),[loans]);
  const fmems  = useMemo(()=>members.filter(m=>m.name.toLowerCase().includes(search.toLowerCase())),[members,search]);
  const floans = useMemo(()=>loansCalc.filter(l=>l.memberName.toLowerCase().includes(search.toLowerCase())),[loansCalc,search]);
  const savT   = useMemo(()=>({
    membership:members.reduce((s,m)=>s+(m.membership||0),0),
    annualSub:members.reduce((s,m)=>s+(m.annualSub||0),0),
    monthly:members.reduce((s,m)=>s+(m.monthlySavings||0),0),
    welfare:members.reduce((s,m)=>s+(m.welfare||0),0),
    shares:members.reduce((s,m)=>s+(m.shares||0),0),
    voluntary:members.reduce((s,m)=>s+(m.voluntaryDeposit||0),0),
    total:members.reduce((s,m)=>s+totBanked(m),0)  // includes voluntaryDeposit via totBanked
  }),[members]);
  const lStat = useMemo(()=>{
    const act=loansCalc.filter(l=>l.status!=="paid"),pdd=loansCalc.filter(l=>l.status==="paid");
    return{act:act.length,disbursed:loans.reduce((s,l)=>s+(l.amountLoaned||0),0),outstanding:act.reduce((s,l)=>s+l.balance,0),intAccrued:loansCalc.reduce((s,l)=>s+l.totalInterest,0),profit:pdd.reduce((s,l)=>s+l.profit,0)};
  },[loansCalc,loans]);

  const totalExpenses  = useMemo(()=>expenses.reduce((s,e)=>s+(+e.amount||0),0),[expenses]);
  // True cash in bank = all deposits + loan profit realised - all expenses paid out
  // (outstanding loans are already deployed as cash, not deducted from bank)
  const cashInBank     = useMemo(()=>{
    // BIDA Coop Income = all member savings - all expenses (bank charges already included in expenses)
    const bidaIncome    = savT.total - totalExpenses;
    // Subtract loans still outstanding (principal not yet recovered)
    const outstanding   = loans
      .filter(l=>l.status!=="paid")
      .reduce((s,l)=>s+(+l.amountLoaned||0),0);
    // Add interest actually earned on fully repaid loans
    const interestEarned = loans
      .filter(l=>l.status==="paid")
      .reduce((s,l)=>s+calcLoan(l).profit,0);
    // Add investment returns if any
    const invReturns    = investments.reduce((s,i)=>s+(+i.interestEarned||0),0);
    const invMade       = investments.filter(i=>i.status==="active").reduce((s,i)=>s+(+i.amount||0),0);
    return bidaIncome - outstanding + interestEarned + invReturns - invMade;
  },[savT.total,totalExpenses,loans,investments]);
  const netCash        = cashInBank; // alias kept for compatibility
  const totalInvested  = useMemo(()=>investments.filter(i=>i.status==="active").reduce((s,i)=>s+(+i.amount||0),0),[investments]);
  const totalInvInterest = useMemo(()=>investments.reduce((s,i)=>s+(+i.interestEarned||0),0),[investments]);
  // 40% of investment interest distributed to members; 60% retained in pool
  const distributableInterest = useMemo(()=>Math.round(totalInvInterest*0.4),[totalInvInterest]);
  const retainedInterest      = useMemo(()=>Math.round(totalInvInterest*0.6),[totalInvInterest]);
  // Each member's share of distributable interest = their % of pool × distributable
  const memberInvShare = (m) => savT.total>0 ? Math.round((totBanked(m)/savT.total)*distributableInterest) : 0;

  const profMember = useMemo(()=>profId?members.find(m=>m.id===profId):null,[profId,members]);
  const profLoans  = useMemo(()=>profId?loansCalc.filter(l=>l.memberId===profId):[],[profId,loansCalc]);
  const allTotals  = useMemo(()=>members.map(m=>totBanked(m)).sort((a,b)=>b-a),[members]);
  const profRank   = useMemo(()=>profMember?allTotals.indexOf(totBanked(profMember))+1:null,[profMember,allTotals]);
  const profPct    = useMemo(()=>(!profMember||!savT.total)?0:((totBanked(profMember)/savT.total)*100).toFixed(1),[profMember,savT]);

  // ── 5-day due date detection ──────────────────────────────────────────────
  const today = useMemo(()=>{const d=new Date();d.setHours(0,0,0,0);return d;},[]);
  const dueSoonLoans = useMemo(()=>loansCalc.filter(l=>{
    if(l.status==="paid"||!l.dateBanked)return false;
    const issued=new Date(l.dateBanked);
    const due=new Date(issued.getFullYear(),issued.getMonth()+(l.term||12),issued.getDate());
    const daysLeft=Math.floor((due-today)/(1000*60*60*24));
    return daysLeft>=0&&daysLeft<=5;
  }),[loansCalc,today]);

  const daysLeft = (loan)=>{
    const issued=new Date(loan.dateBanked);
    const due=new Date(issued.getFullYear(),issued.getMonth()+(loan.term||12),issued.getDate());
    return Math.floor((due-today)/(1000*60*60*24));
  };

  const openProfile=(m)=>{setProfId(m.id);setProfEdit(false);setProfF({...m});setConfirmOpt(false);};
  const closeProfile=()=>{setProfId(null);setProfEdit(false);setProfF(null);setConfirmOpt(false);setSharedPDF(null);};
  const saveProfile=()=>{
    if(!profF.name.trim())return;
    const before=members.find(m=>m.id===profId);
    const monthlySavings=+profF.monthlySavings||0;
    // Preserve manual welfare if set, otherwise auto-calc 40%
    const welfare=(+profF.welfare>0)?+profF.welfare:autoWelfare(monthlySavings);
    const updated={
      ...before||{},
      ...profF,
      photoUrl:profF.photoUrl||"",
      phone:profF.phone||"",
      nin:profF.nin||"",
      address:profF.address||"",
      whatsapp:profF.whatsapp||"",
      membership:+profF.membership||0,
      annualSub:+profF.annualSub||0,
      monthlySavings,
      welfare,
      shares:+profF.shares||0,
      voluntaryDeposit:+profF.voluntaryDeposit||0,
      nextOfKin:profF.nextOfKin||before?.nextOfKin||null,
      // preserve approval trail from DB — never overwrite
      approvalTrail:before?.approvalTrail||[],
      approvalStatus:before?.approvalStatus||"approved",
      pendingCommissions:before?.pendingCommissions||[],
    };
    setMembers(prev=>prev.map(m=>m.id===profId?updated:m));
    postAudit(mkAudit("edit","member",profId,before,updated,authUser?.role,authUser?.name));
    saveRecord("members",updated,setSyncStatus,(errMsg)=>{
      setMembers(prev=>prev.map(m=>m.id===profId?before:m));
      alert("⚠️ Profile NOT saved to database.\n\nError: "+errMsg+"\n\nChanges have been reverted. Check your internet connection and try again.\nIf this keeps happening, run complete_schema.sql in Supabase.");
    });
    setProfEdit(false);
  };
  const optOutMember=()=>{
    setLoans(prev=>prev.filter(l=>l.memberId!==profId));
    setMembers(prev=>prev.filter(m=>m.id!==profId));
    closeProfile();
  };
  const saveInv=()=>{
    if(!invF.platform||!invF.amount)return;
    const rec={...invF,amount:+invF.amount||0,interestEarned:+invF.interestEarned||0,id:editInv||(investments.length>0?Math.max(...investments.map(i=>i.id||0))+1:1)};
    const prevInvSnapshot=[...investments];
    if(editInv) setInvestments(prev=>prev.map(i=>i.id===editInv?rec:i));
    else setInvestments(prev=>[...prev,rec]);
    saveRecord("investments",rec,setSyncStatus,(errMsg)=>{
      setInvestments(prevInvSnapshot);
      alert("⚠️ Investment NOT saved.\n\nError: "+errMsg+"\n\nChanges reverted. Please try again.");
    });
    setInvModal(false);setEditInv(null);setInvF({...emptyInv,dateInvested:new Date().toISOString().split("T")[0]});
  };
  const delInv=(id)=>{if(window.confirm("Delete this investment record?")){setInvestments(prev=>prev.filter(i=>i.id!==id));deleteRecord("investments",id,setSyncStatus);}};
  const openAddInv=()=>{setEditInv(null);setInvF({...emptyInv,dateInvested:new Date().toISOString().split("T")[0]});setInvModal(true);};
  const openEditInv=(inv)=>{setEditInv(inv.id);setInvF({...inv});setInvModal(true);};
  const saveAddM=()=>{
    if(!addMF.name.trim())return;
    const id=Math.max(...members.map(m=>m.id),0)+1;
    const joinDate=addMF.joinDate||new Date().toISOString().split("T")[0];
    // Enforce 40% welfare auto-calc from monthly savings if not manually set
    const monthlySavings=+addMF.monthlySavings||0;
    const welfare=(+addMF.welfare>0)?+addMF.welfare:autoWelfare(monthlySavings);
    // Voluntary deposit goes to savings total (counted in totBanked)
    const voluntaryDeposit=+addMF.voluntaryDeposit||0;
    // Build approval trail inline so it is always synced
    const trail=[mkApprovalStep(1,authUser||{role:"treasurer",name:"Treasurer"},"approved","Member registration initiated")];
    const newMember={
      id,
      name:addMF.name.trim(),
      email:addMF.email||"",
      whatsapp:addMF.whatsapp||"",
      phone:addMF.phone||"",
      address:addMF.address||"",
      nin:addMF.nin||"",
      photoUrl:addMF.photoUrl||"",
      membership:+addMF.membership||0,
      annualSub:+addMF.annualSub||0,
      monthlySavings,
      welfare,
      shares:+addMF.shares||0,
      voluntaryDeposit,
      joinDate,
      referredByMemberId:addMF.referralSource==="member"?+addMF.referredById||null:null,
      referralSource:addMF.referralSource||"",
      approvalStatus:"step1_done",
      approvalTrail:trail,
      pendingCommissions:[],
      referralCommission:0,
      nextOfKin:addMF.nextOfKin||null,
      initialPaymentReceived:!!addMF.initialPaymentReceived,
      payMode:addMF.payMode||"cash",
      bankName:addMF.bankName||"",
      bankAccount:addMF.bankAccount||"",
      depositorName:addMF.depositorName||"",
      mobileNumber:addMF.mobileNumber||"",
      transactionId:addMF.transactionId||"",
    };
    let updatedMembers=[...members,newMember];
    // Commission: 1% of referrer's (monthlySavings + welfare) — payable after 1 month
    if(addMF.referralSource==="member"&&addMF.referredById){
      const refId=+addMF.referredById;
      const referrer=members.find(m=>m.id===refId);
      const newAnnualSub=+addMF.annualSub||0;
      if(referrer&&newAnnualSub>=50000){
        const commBase=(referrer.monthlySavings||0)+(referrer.welfare||0);
        const commission=Math.round(commBase*0.01);
        const payableDate=new Date(joinDate);
        payableDate.setMonth(payableDate.getMonth()+1);
        const payableDateStr=payableDate.toISOString().split("T")[0];
        const newCommission={newMemberId:id,newMemberName:addMF.name.trim(),amount:commission,earnedDate:joinDate,payableDate:payableDateStr,paid:false,base:commBase};
        const updatedReferrer={...referrer,referralCommission:(referrer.referralCommission||0)+commission,pendingCommissions:[...(referrer.pendingCommissions||[]),newCommission]};
        updatedMembers=updatedMembers.map(m=>m.id===refId?updatedReferrer:m);
        saveRecord("members",updatedReferrer,setSyncStatus);
      }
    }
    setMembers(updatedMembers);
    // Sync — trail is already baked into newMember object
    saveRecord("members",newMember,setSyncStatus,(errMsg)=>{
      setMembers(prev=>prev.filter(m=>m.id!==newMember.id));
      alert("⚠️ New member NOT saved to database.\n\nError: "+errMsg+"\n\nThe member has been removed from your local view. Please check your connection and try again.");
    });
    postAudit([mkAudit("create","member",id,null,newMember,authUser?.role,authUser?.name)]);
    setAddMModal(false);
    setAddMF({name:"",email:"",whatsapp:"",phone:"",address:"",nin:"",photoUrl:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,shareUnitsInput:0,voluntaryDeposit:0,joinDate:new Date().toISOString().split("T")[0],referralSource:"",referredById:"",payMode:"cash",bankName:"",bankAccount:"",depositorName:"",mobileNumber:"",transactionId:"",initialPaymentReceived:false,initialPaymentNote:"",nextOfKin:null});
  };
  const openPayModal=(loan)=>{setPayF({...emptyPay,loanId:loan.id,date:new Date().toISOString().split("T")[0]});setPayModal(true);};
  const savePay=()=>{
    if(!payF.amount||!payF.loanId)return;
    const amt=+payF.amount||0;
    const loanBefore=loans.find(l=>l.id===payF.loanId);
    setLoans(prev=>prev.map(l=>{
      if(l.id!==payF.loanId)return l;
      const newPaid=(l.amountPaid||0)+amt;
      const calc=calcLoan({...l,amountPaid:newPaid});
      const nowPaid=calc.balance<=0;
      const updated={...l,amountPaid:newPaid,status:nowPaid?"paid":l.status,datePaid:nowPaid?(payF.date||new Date().toISOString().split("T")[0]):l.datePaid,
        payments:[...(l.payments||[]),{...payF,amount:amt,id:Date.now()}]};
      saveRecord("loans",updated,setSyncStatus,(errMsg)=>{
        setLoans(prev=>prev.map(l=>l.id===payF.loanId?loanBefore:l));
        alert("⚠️ Loan repayment NOT saved.\n\nError: "+errMsg+"\n\nPayment reverted. Please try again.");
      });
      return updated;
    }));
    setPayModal(false);setPayF({...emptyPay});
  };
  const openAddL=()=>{setEditL(null);setLF({...emptyL});setLModal(true);};
  const openEditL=(l)=>{setEditL(l.id);setLF({...l});setLModal(true);};
  const onAmt=(v)=>{const a=+v||0;setLF(f=>({...f,amountLoaned:v,processingFeePaid:Math.round(procFee(a))}));};
  const saveL=async()=>{
    const a=+lF.amountLoaned||0;
    const p={...lF,amountLoaned:a,processingFeePaid:+lF.processingFeePaid||Math.round(procFee(a)),amountPaid:+lF.amountPaid||0};
    const mem=members.find(m=>m.id===+lF.memberId);
    if(mem)p.memberName=mem.name;
    if(!p.memberName)return;
    let savedLoan;
    if(editL){
      const before=loans.find(l=>l.id===editL);
      savedLoan={...before,...p,id:editL};
      setLoans(prev=>prev.map(l=>l.id===editL?savedLoan:l));
      saveRecord("loans",savedLoan,setSyncStatus,(errMsg)=>{
        setLoans(prev=>prev.map(l=>l.id===editL?before:l));
        alert("⚠️ Loan changes NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
      });
      postAudit([mkAudit("edit","loan",editL,before,savedLoan,authUser?.role,authUser?.name)]);
    } else {
      const id=Math.max(...loans.map(l=>l.id),0)+1;
      // Treasurer initiates: step 1 auto-applied
      const trail=[mkApprovalStep(1,authUser||{role:"treasurer",name:"Treasurer"},"approved","Initiated by Treasurer")];
      savedLoan={id,...p,approvalStatus:"step1_done",approvalTrail:trail,initiatedBy:authUser?.name||"Treasurer",payments:[]};
      setLoans(prev=>[...prev,savedLoan]);
      saveRecord("loans",savedLoan,setSyncStatus,(errMsg)=>{
        setLoans(prev=>prev.filter(l=>l.id!==savedLoan.id));
        alert("⚠️ New loan NOT saved.\n\nError: "+errMsg+"\n\nRemoved from view. Please try again.");
      });
      postLoanLedger(savedLoan,authUser);
      postAudit([mkAudit("create","loan",id,null,savedLoan,authUser?.role,authUser?.name)]);
    }
    setLModal(false);
    // Note: loan PDF is generated ONLY after full 4-step approval
    // When Auditor approves (step 4), PDF auto-generates — see handleApprove
  };
  const delL=(id)=>{if(window.confirm("Delete this loan?")){setLoans(prev=>prev.filter(l=>l.id!==id));deleteRecord("loans",id,setSyncStatus);}};
  const markPd=(id)=>{
    const loanBefore=loans.find(l=>l.id===id);
    setLoans(prev=>prev.map(l=>{
      if(l.id!==id)return l;
      const dp=new Date().toISOString().split("T")[0];
      const c=calcLoan({...l,datePaid:dp,status:"paid"});
      const updated={...l,status:"paid",amountPaid:c.totalDue,datePaid:dp};
      saveRecord("loans",updated,setSyncStatus,(errMsg)=>{
        setLoans(prev=>prev.map(l=>l.id===id?loanBefore:l));
        alert("⚠️ Loan settlement NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
      });
      return updated;
    }));
  };

  // ── Contribution log handlers ────────────────────────────────────────────
  const saveContrib=()=>{
    if(!contribF.memberId||!contribF.amount||!contribF.date) return;
    const id=Date.now();
    const rec={id,memberId:+contribF.memberId,date:contribF.date,category:contribF.category,amount:+contribF.amount||0,note:contribF.note||"",recordedBy:authUser?.name||"System",recordedAt:new Date().toISOString()};
    const memberBefore=members.find(m=>m.id===+contribF.memberId);
    setContribLog(prev=>[...prev,rec]);
    saveRecord("contrib_log",rec,setSyncStatus,(errMsg)=>{
      setContribLog(prev=>prev.filter(c=>c.id!==rec.id));
      setMembers(prev=>prev.map(m=>m.id===+contribF.memberId?memberBefore:m));
      alert("⚠️ Contribution NOT saved.\n\nError: "+errMsg+"\n\nContribution and member total reverted. Please try again.");
    });
    // Also update the member's running total for that category
    setMembers(prev=>prev.map(m=>{
      if(m.id!==+contribF.memberId) return m;
      const updated={...m,[contribF.category]:(+m[contribF.category]||0)+(+contribF.amount||0)};
      saveRecord("members",updated,setSyncStatus,(errMsg)=>{
        setMembers(prev=>prev.map(m=>m.id===+contribF.memberId?memberBefore:m));
        alert("⚠️ Member total NOT updated.\n\nError: "+errMsg+"\n\nMember total reverted. Please try again.");
      });
      return updated;
    }));
    setContribModal(false);
    setContribF({memberId:"",date:new Date().toISOString().split("T")[0],category:"monthlySavings",amount:"",note:""});
  };
  const delContrib=(id)=>{
    if(!window.confirm("Delete this contribution entry?")) return;
    setContribLog(prev=>prev.filter(c=>c.id!==id));
    deleteRecord("contrib_log",id,setSyncStatus);
  };

  // ── Dividend payout handlers ──────────────────────────────────────────────
  const saveDividendPayout=(run)=>{
    if(!run||!run.distributable) return;
    const id=Date.now();
    const rec={
      id,
      runDate:new Date().toISOString().split("T")[0],
      grossSurplus:run.grossSurplus,
      statutory:run.statutory,
      operational:run.operational,
      distributable:run.distributable,
      memberPayouts:JSON.stringify(run.perMember.filter(m=>m.totalDividend>0).map(m=>({id:m.id,name:m.name,amount:m.totalDividend,shareDividend:m.shareDividend,savingsDividend:m.savingsDividend}))),
      totalMembers:run.perMember.filter(m=>m.totalDividend>0).length,
      recordedBy:authUser?.name||"System",
      status:"declared",
    };
    setDividendPayouts(prev=>[...prev,rec]);
    saveRecord("dividend_payouts",rec,setSyncStatus,(errMsg)=>{
      setDividendPayouts(prev=>prev.filter(p=>p.id!==rec.id));
      alert("⚠️ Dividend payout record NOT saved.\n\nError: "+errMsg+"\n\nRecord removed. Please try again.");
    });
    postAudit([mkAudit("create","dividend",id,null,rec,authUser?.role,authUser?.name)]);
    setDividendModal(false);
  };

  // ── Expense handlers ──────────────────────────────────────────────────────
  const openAddExp=()=>{setEditExp(null);setExpF({...emptyE});setExpModal(true);};
  const openEditExp=(e)=>{setEditExp(e.id);setExpF({...e});setExpModal(true);};
  const saveExp=()=>{
    if(!expF.activity||!expF.activity.trim()||!expF.amount)return;
    const amt=+expF.amount||0;
    // Expenses >= UGX 100,000 require Admin approval before being counted as authorised
    // Treasurer and Finance Manager can record them but they are flagged "pending_approval"
    // Administrator approves directly from the expense list
    const needsApproval = amt >= EXPENSE_APPROVAL_THRESHOLD;
    const isAdmin = authUser?.role==="admin";
    const expApprovalStatus = needsApproval && !isAdmin ? "pending_approval" : "approved";
    const rec={
      ...expF,
      amount:amt,
      expApprovalStatus,
      expApprovedBy: (!needsApproval||isAdmin) ? (authUser?.name||"") : "",
      expApprovedAt: (!needsApproval||isAdmin) ? new Date().toISOString() : "",
    };
    if(editExp){
      const before=expenses.find(e=>e.id===editExp);
      const updated={...before,...rec};
      setExpenses(prev=>prev.map(e=>e.id===editExp?updated:e));
      saveRecord("expenses",updated,setSyncStatus,(errMsg)=>{
        setExpenses(prev=>prev.map(e=>e.id===editExp?before:e));
        alert("⚠️ Expense changes NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
      });
      postAudit([mkAudit("edit","expense",editExp,before,updated,authUser?.role,authUser?.name)]);
    } else {
      const id=(expenses.length>0?Math.max(...expenses.map(e=>e.id||0)):0)+1;
      const newRec={id,...rec};
      setExpenses(prev=>[...prev,newRec]);
      saveRecord("expenses",newRec,setSyncStatus,(errMsg)=>{
        setExpenses(prev=>prev.filter(e=>e.id!==newRec.id));
        alert("⚠️ New expense NOT saved.\n\nError: "+errMsg+"\n\nRemoved from view. Please try again.");
      });
      postExpenseLedger(newRec,authUser);
    }
    setExpModal(false);
    setEditExp(null);
    setExpF({...emptyE,date:new Date().toISOString().split("T")[0]});
  };

  // Approve a large expense — Admin only
  const approveExpense=(expId)=>{
    if(authUser?.role!=="admin"){alert("Only the Administrator can approve expenses.");return;}
    setExpenses(prev=>prev.map(e=>{
      if(e.id!==expId) return e;
      const expBefore={...e};
      const updated={...e,expApprovalStatus:"approved",expApprovedBy:authUser.name,expApprovedAt:new Date().toISOString()};
      saveRecord("expenses",updated,setSyncStatus,(errMsg)=>{
        setExpenses(prev=>prev.map(e=>e.id===expId?expBefore:e));
        alert("⚠️ Expense approval NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
      });
      postAudit([mkAudit("approve","expense",expId,{expApprovalStatus:"pending_approval"},{expApprovalStatus:"approved"},authUser.role,authUser.name)]);
      return updated;
    }));
  };

  // Reject a large expense — Admin only
  const rejectExpense=(expId,reason)=>{
    if(authUser?.role!=="admin") return;
    setExpenses(prev=>prev.map(e=>{
      if(e.id!==expId) return e;
      const expBefore2={...e};
      const updated={...e,expApprovalStatus:"rejected",expApprovedBy:authUser.name,expApprovedAt:new Date().toISOString(),expRejectionReason:reason||""};
      saveRecord("expenses",updated,setSyncStatus,(errMsg)=>{
        setExpenses(prev=>prev.map(e=>e.id===expId?expBefore2:e));
        alert("⚠️ Expense rejection NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
      });
      return updated;
    }));
  };
  const delExp=(id)=>{if(window.confirm("Delete this expense?")){setExpenses(prev=>prev.filter(e=>e.id!==id));deleteRecord("expenses",id,setSyncStatus);}};

  // ── Email / WA / SMS dispatch ─────────────────────────────────────────────
  const dispatchEmail=async(key,toEmail,subject,textBody,pdfBlob,pdfFilename)=>{
    setEmailSending(s=>({...s,[key]:"sending"}));
    try{
      const ab=await pdfBlob.arrayBuffer();const bytes=new Uint8Array(ab);let bin="";
      for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
      const base64=btoa(bin);
      const res=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:toEmail,subject,text:textBody,attachment:{content:base64,filename:pdfFilename}})});
      if(res.status===404){setEmailSetup(true);setEmailSending(s=>({...s,[key]:"nosetup"}));window.open("mailto:"+toEmail+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(textBody));return;}
      if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.error||"Send failed ("+res.status+")");}
      setEmailSending(s=>({...s,[key]:"ok"}));
      setTimeout(()=>setEmailSending(s=>({...s,[key]:undefined})),4000);
    }catch(e){console.error("Email error:",e);setEmailSending(s=>({...s,[key]:"err"}));setTimeout(()=>setEmailSending(s=>({...s,[key]:undefined})),5000);}
  };

  const dispatchSMS=async(key,toPhone,message)=>{
    setEmailSending(s=>({...s,[key]:"sending"}));
    try{
      const res=await fetch("/api/send-sms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:toPhone,message})});
      if(res.status===404){setEmailSending(s=>({...s,[key]:"nosetup"}));setEmailSetup(true);return;}
      if(!res.ok)throw new Error("SMS failed ("+res.status+")");
      setEmailSending(s=>({...s,[key]:"sms_ok"}));
      setTimeout(()=>setEmailSending(s=>({...s,[key]:undefined})),4000);
    }catch(e){console.error("SMS error:",e);setEmailSending(s=>({...s,[key]:"err"}));setTimeout(()=>setEmailSending(s=>({...s,[key]:undefined})),5000);}
  };

  // WA — tries /api/send-whatsapp, falls back to wa.me deep link
  const dispatchWA=async(key,phone,message)=>{
    setEmailSending(s=>({...s,[key]:"sending"}));
    try{
      const res=await fetch("/api/send-whatsapp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:waNum(phone),message})});
      if(res.status===404){window.open(waLink(phone,message),"_blank");setEmailSending(s=>({...s,[key]:"ok"}));setTimeout(()=>setEmailSending(s=>({...s,[key]:undefined})),3000);return;}
      if(!res.ok)throw new Error("WA failed");
      setEmailSending(s=>({...s,[key]:"ok"}));
      setTimeout(()=>setEmailSending(s=>({...s,[key]:undefined})),3000);
    }catch(e){setEmailSending(s=>({...s,[key]:"err"}));setTimeout(()=>setEmailSending(s=>({...s,[key]:undefined})),4000);}
  };

  const sendSavingsEmail=async(m)=>{const key="sav_"+m.id;const{subj,body}=buildSavingsEmail(m);const blob=await generateMemberPDF(m,loansCalc.filter(l=>l.memberId===m.id),members,loans,true);await dispatchEmail(key,m.email,subj,body,blob,"BIDA_Statement_"+m.name.replace(/\s+/g,"_")+".pdf");};
  const sendLoanEmail=async(mem,loan)=>{const key="loan_"+loan.id;const{subj,body}=buildLoanEmail(mem,loan);const blob=await generateMemberPDF(mem,loansCalc.filter(l=>l.memberId===mem.id),members,loans,true);await dispatchEmail(key,mem.email,subj,body,blob,"BIDA_Loan_"+mem.name.replace(/\s+/g,"_")+".pdf");};
  const sendDueEmail=async(mem,loan)=>{const key="due_"+loan.id;const{subj,body}=buildDueEmail(mem,loan);const blob=await generateMemberPDF(mem,loansCalc.filter(l=>l.memberId===mem.id),members,loans,true);await dispatchEmail(key,mem.email,subj,body,blob,"BIDA_Due_"+mem.name.replace(/\s+/g,"_")+".pdf");};
  const sendSavingsSMS=(m)=>dispatchSMS("sms_sav_"+m.id,m.whatsapp,buildSMSSavingsMsg(m));
  const sendLoanSMS=(mem,loan)=>dispatchSMS("sms_loan_"+loan.id,mem.whatsapp,buildSMSLoanMsg(mem,loan));
  const sendDueSMS=(mem,loan)=>dispatchSMS("sms_due_"+loan.id,mem.whatsapp,buildSMSDueMsg(mem,loan,daysLeft(loan)));
  const sendAllSavings=async()=>{for(const m of members.filter(m=>m.email)){await sendSavingsEmail(m);await new Promise(r=>setTimeout(r,300));}};
  const sendAllSavingsSMS=async()=>{for(const m of members.filter(m=>m.whatsapp)){await sendSavingsSMS(m);await new Promise(r=>setTimeout(r,200));}};

  const lFPreview=useMemo(()=>{
    if(!lF.amountLoaned||!lF.dateBanked)return null;
    return calcLoan({amountLoaned:+lF.amountLoaned||0,dateBanked:lF.dateBanked,datePaid:lF.datePaid||null,amountPaid:+lF.amountPaid||0,status:lF.status,term:+lF.term||12});
  },[lF]);

  const handlePDF=async(type)=>{
    setPdfGen(type);setSharedPDF(null);
    const filenames={savings:"BIDA_Savings_Report.pdf",loans:"BIDA_Loans_Report.pdf",expenses:"BIDA_Expenses_Report.pdf",projections:"BIDA_Projections_Report.pdf"};
    const labels={savings:"Savings Report",loans:"Loans Report",expenses:"Expenses Report",projections:"Projections Report"};
    try{
      const blob=await generatePDF(type,members,loans,expenses,true);
      // Show modal — user taps Download button to save the file
      setSharedPDF({blob,filename:filenames[type],label:labels[type],type,show:true});
    }catch(e){console.error("PDF error:",e);alert("PDF failed: "+e.message);}
    finally{setPdfGen(null);}
  };
  const handleMemberPDF=async(m)=>{
    setPdfGen("member_"+m.id);setSharedPDF(null);
    try{
      const filename="BIDA_Statement_"+m.name.replace(/\s+/g,"_")+".pdf";
      const blob=await generateMemberPDF(m,profLoans,members,loans,true);
      setSharedPDF({blob,filename,label:m.name+" Statement",type:"member",memberId:m.id,show:true,waNumber:waNum(m.whatsapp||m.phone||"")});
    }catch(e){console.error("PDF error:",e);alert("PDF failed: "+e.message);}
    finally{setPdfGen(null);}
  };


  // ── Supabase sync helpers ──
  const syncMember=(m)=>saveRecord("members",m,setSyncStatus);
  const syncLedgerEntry=(e)=>saveRecord("ledger",{...e,id:String(e.id)},setSyncStatus);
  const syncAuditEntry=(e)=>saveRecord("audit_log",{...e,id:String(e.id)},setSyncStatus);
  const syncLoan=(l)=>saveRecord("loans",l,setSyncStatus);
  const syncExpense=(e)=>saveRecord("expenses",e,setSyncStatus);
  const syncInvestment=(i)=>saveRecord("investments",i,setSyncStatus);
  const syncSP=(sp)=>saveRecord("service_providers",{...sp,id:sp.id||String(sp.memberId||"")+sp.serviceType},setSyncStatus);
  const delMember=(id)=>{setMembers(p=>p.filter(m=>m.id!==id));deleteRecord("members",id,setSyncStatus);};
  const delLoanR=(id)=>{setLoans(p=>p.filter(l=>l.id!==id));deleteRecord("loans",id,setSyncStatus);};
  const delExpR=(id)=>{setExpenses(p=>p.filter(e=>e.id!==id));deleteRecord("expenses",id,setSyncStatus);};
  const delInvR=(id)=>{setInvestments(p=>p.filter(i=>i.id!==id));deleteRecord("investments",id,setSyncStatus);};


  // ── Fintech helpers ──
  const postLedger=(entries)=>setLedger(p=>[...p,...(Array.isArray(entries)?entries:[entries])]);
  const postAudit=(entries)=>setAuditLog(p=>[...p,...(Array.isArray(entries)?entries:[entries])]);

  // Build repayment schedule for a loan
  const buildSchedule=(loan)=>{
    const c=calcLoan(loan);
    const schedule=[];
    let balance=loan.amountLoaned;
    const start=new Date(loan.dateBanked);
    for(let i=1;i<=c.term;i++){
      const dueDate=new Date(start.getFullYear(),start.getMonth()+i,start.getDate());
      const interest=loan.method==="reducing"?Math.round(balance*0.06):Math.round(loan.amountLoaned*0.04);
      const principal=loan.method==="reducing"?Math.round(c.monthlyPayment-interest):Math.round(loan.amountLoaned/c.term);
      balance=Math.max(0,balance-principal);
      schedule.push({
        installment:i,
        dueDate:dueDate.toISOString().split("T")[0],
        principal,interest,
        payment:c.monthlyPayment,
        balance,
        status:"pending",
      });
    }
    return schedule;
  };

  // Post ledger entry when new loan is issued
  const postLoanLedger=(loan,actor)=>{
    postLedger([
      mkEntry("loan_disbursement",loan.id,"Loan disbursed to "+loan.memberName,loan.amountLoaned,0,"loan_book",actor?.role,actor?.name),
      mkEntry("loan_disbursement",loan.id,"Loan proceeds from pool",0,loan.amountLoaned,"savings_pool",actor?.role,actor?.name),
    ]);
    postAudit(mkAudit("create","loan",loan.id,null,loan,actor?.role,actor?.name));
    setSchedules(p=>({...p,[loan.id]:buildSchedule(loan)}));
  };

  // Post ledger entry when expense is recorded
  const postExpenseLedger=(exp,actor)=>{
    postLedger(mkEntry("expense",exp.id,exp.activity,+exp.amount,0,"expense_account",actor?.role,actor?.name));
    postAudit(mkAudit("create","expense",exp.id,null,exp,actor?.role,actor?.name));
  };

  // Post ledger entry for savings deposit
  const postSavingsLedger=(member,amount,actor)=>{
    postLedger(mkEntry("savings_deposit",member.id,"Savings deposit — "+member.name,0,amount,"savings_pool",actor?.role,actor?.name));
  };

  // Reversal (compensating transaction — never edits original)
  const postReversal=(originalEntryId,reason,actor)=>{
    postLedger(mkEntry("reversal",originalEntryId,"REVERSAL: "+reason,0,0,"savings_pool",actor?.role,actor?.name));
    postAudit(mkAudit("reversal","ledger",originalEntryId,null,{reason},actor?.role,actor?.name));
  };


  // ── Approval workflow handlers ──────────────────────────────────────────

  const handleApprove = async(entityType, entityId, currentStatus, note) => {
    const next = getNextStep(currentStatus);
    if(!next || !authUser) return;
    const newStatus = advanceStatus(currentStatus);
    const step = mkApprovalStep(next.step, authUser, "approved", note||"");
    const isFinal = newStatus === "approved";

    if(entityType === "loan") {
      let finalLoan = null;
      setLoans(prev=>prev.map(l=>{
        if(l.id!==entityId) return l;
        const trail=[...(l.approvalTrail||[]),step];
        const updated={...l,approvalStatus:newStatus,approvalTrail:trail};
        if(isFinal) { updated.status="active"; finalLoan=updated; }
        const loanSnapApprove={...l,approvalStatus:currentStatus,approvalTrail:l.approvalTrail||[]};
        saveRecord("loans",updated,setSyncStatus,(errMsg)=>{
          setLoans(prev=>prev.map(l=>l.id===entityId?loanSnapApprove:l));
          alert("⚠️ Loan approval NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
        });
        return updated;
      }));
      postAudit([mkAudit("approve","loan",entityId,{status:currentStatus},{status:newStatus,step},authUser.role,authUser.name)]);
      // AUTO-GENERATE LOAN AGREEMENT PDF when Auditor gives final stamp
      if(isFinal && finalLoan){
        const mem = members.find(m=>m.id===finalLoan.memberId);
        if(mem){
          try{
            const blob=await generateLoanPDF(finalLoan,mem,calcLoan(finalLoan));
            const fname="BIDA_LoanAgreement_"+(mem.name||"").replace(/\s+/g,"_")+".pdf";
            const url=URL.createObjectURL(blob);
            const a=document.createElement("a");
            a.href=url;a.download=fname;
            a.style.cssText="position:fixed;top:-200px;left:-200px;opacity:0";
            document.body.appendChild(a);a.click();
            setTimeout(()=>{URL.revokeObjectURL(url);try{document.body.removeChild(a);}catch(e){}},8000);
            alert("✅ Loan fully approved! Loan Agreement PDF downloading now.");
          }catch(e){console.error("Loan PDF error:",e);}
        }
      }
    }
    if(entityType === "member") {
      setMembers(prev=>prev.map(m=>{
        if(m.id!==entityId) return m;
        const trail=[...(m.approvalTrail||[]),step];
        const updated={...m,approvalStatus:newStatus,approvalTrail:trail};
        const memSnapApprove={...m,approvalStatus:currentStatus,approvalTrail:m.approvalTrail||[]};
        saveRecord("members",updated,setSyncStatus,(errMsg)=>{
          setMembers(prev=>prev.map(m=>m.id===entityId?memSnapApprove:m));
          alert("⚠️ Member approval NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
        });
        return updated;
      }));
      postAudit([mkAudit("approve","member",entityId,{status:currentStatus},{status:newStatus,step},authUser.role,authUser.name)]);
    }
  };

  const handleReject = (entityType, entityId, currentStatus, note) => {
    if(!authUser || !note) return;
    const next = getNextStep(currentStatus);
    const step = mkApprovalStep(next?.step||0, authUser, "rejected", note);

    if(entityType === "loan") {
      setLoans(prev=>prev.map(l=>{
        if(l.id!==entityId) return l;
        const trail=[...(l.approvalTrail||[]),step];
        const loanSnapReject={...l};
        const updated={...l,approvalStatus:"rejected",approvalTrail:trail};
        saveRecord("loans",updated,setSyncStatus,(errMsg)=>{
          setLoans(prev=>prev.map(l=>l.id===entityId?loanSnapReject:l));
          alert("⚠️ Loan rejection NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
        });
        return updated;
      }));
    }
    if(entityType === "member") {
      setMembers(prev=>prev.map(m=>{
        if(m.id!==entityId) return m;
        const trail=[...(m.approvalTrail||[]),step];
        const memSnapReject={...m};
        const updated={...m,approvalStatus:"rejected",approvalTrail:trail};
        saveRecord("members",updated,setSyncStatus,(errMsg)=>{
          setMembers(prev=>prev.map(m=>m.id===entityId?memSnapReject:m));
          alert("⚠️ Member rejection NOT saved.\n\nError: "+errMsg+"\n\nReverted. Please try again.");
        });
        return updated;
      }));
    }
    postAudit([mkAudit("reject",entityType,entityId,{status:currentStatus},{note},authUser.role,authUser.name)]);
    setRejectTarget(null); setRejectNote("");
  };

  // Items waiting for THIS user's action
  const myPendingItems = useMemo(()=>{
    if(!authUser) return [];
    const items = [];
    loans.forEach(l=>{
      const next=getNextStep(l.approvalStatus||"draft");
      if(next && next.role===authUser.role) {
        const mem=members.find(m=>m.id===l.memberId);
        items.push({type:"loan",id:l.id,label:"Loan — "+(mem?.name||l.memberName),amount:l.amountLoaned,status:l.approvalStatus,item:l,memberName:mem?.name||l.memberName});
      }
    });
    members.forEach(m=>{
      if(m.id && m.approvalStatus && m.approvalStatus!=="approved" && m.approvalStatus!=="rejected") {
        const next=getNextStep(m.approvalStatus);
        if(next && next.role===authUser.role) {
          items.push({type:"member",id:m.id,label:"New Member — "+m.name,amount:null,status:m.approvalStatus,item:m,memberName:m.name});
        }
      }
    });
    return items;
  },[authUser,loans,members]);

  const mn=MONTHS[new Date().getMonth()],yr=new Date().getFullYear();

  const LoanRuleInfo=()=>(
    <div className="method-toggle">
      <span className="method-toggle-label">Interest Rules:</span>
      <span style={{fontSize:11,color:"var(--b700)",fontFamily:"var(--mono)"}}>
        &lt; UGX 7m → <strong>4% flat</strong> &nbsp;|&nbsp; ≥ UGX 7m → <strong>6% reducing balance</strong>
      </span>
    </div>
  );

  // ── Status badge helper ───────────────────────────────────────────────────
  const ESt=({k})=>{const s=emailSending[k];return s==="ok"?<span className="estatus-ok">✓ Sent</span>:s==="sms_ok"?<span className="estatus-sms-ok">✓ SMS</span>:s==="err"?<span className="estatus-err">✗ Failed</span>:s==="nosetup"?<span className="estatus-nosetup">⚠ Setup</span>:s==="sending"?<span className="estatus-sending">⏳</span>:null;};

  const loginRoleOptions=[
    {value:"treasurer",label:"Treasurer"},
    {value:"financemanager",label:"Finance Manager"},
    {value:"admin",label:"Administrator"},
    {value:"auditor",label:"Auditor"},
  ];
  const doLogin=()=>{
    if(loginLockedUntil&&Date.now()<loginLockedUntil){const mins=Math.ceil((loginLockedUntil-Date.now())/60000);setLoginErr("🔒 Too many failed attempts. Try again in "+mins+" minute"+(mins>1?"s":"")+".");return;}
    const users=buildUsers();const u=users[loginRole];const savedPin=getSavedPin(loginRole);
    if(u&&loginPin===savedPin){
      setLoginAttempts(0);setLoginLockedUntil(null);setAuthUser({...u});setLoginErr("");setLoginPin("");
      setTimeout(()=>postAudit([mkAudit("login","system","session",null,{role:u.role},u.role,u.name)]),100);
    } else {
      const na=loginAttempts+1;setLoginAttempts(na);
      if(na>=5){setLoginLockedUntil(Date.now()+15*60*1000);setLoginAttempts(0);setLoginErr("🔒 5 failed attempts. Locked for 15 minutes.");}
      else{setLoginErr("Wrong PIN. "+(5-na)+" attempt"+(5-na!==1?"s":"")+" remaining before lockout.");}
    }
  };

  return (
    <React.Fragment>
      <style>{CSS}</style>
      <style>{`body{margin:0;font-family:'Outfit',sans-serif;}`}</style>

      {/* ── LOGIN SCREEN ── */}
      {!authUser&&(
        <div style={{minHeight:"100vh",background:"linear-gradient(135deg,var(--b900),var(--b700))",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#fff",borderRadius:20,padding:"32px 28px",width:"100%",maxWidth:380,boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
            <div style={{textAlign:"center",marginBottom:24}}>
              <svg width="48" height="48" viewBox="0 0 80 80" fill="none" style={{marginBottom:10}}>
                <defs><linearGradient id="lg2" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#1E88E5"/><stop offset="100%" stopColor="#0D47A1"/></linearGradient></defs>
                <polygon points="40,3 75,21.5 75,58.5 40,77 5,58.5 5,21.5" fill="url(#lg2)" stroke="#42A5F5" strokeWidth="1.5"/>
                <rect x="19" y="40" width="10" height="15" rx="2.5" fill="#90CAF9" opacity="0.85"/>
                <rect x="32" y="31" width="10" height="24" rx="2.5" fill="#64B5F6"/>
                <rect x="45" y="22" width="10" height="33" rx="2.5" fill="#fff"/>
                <polygon points="50,17 56,23 44,23" fill="#fff"/>
              </svg>
              <div style={{fontSize:22,fontWeight:900,color:"var(--b800)",letterSpacing:2}}>BIDA</div>
              <div style={{fontSize:11,color:"var(--tmuted)",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>Co-Operative Multi-Purpose Society</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:10,fontWeight:700,fontFamily:"var(--mono)",color:"var(--tmuted)",textTransform:"uppercase",letterSpacing:.7,display:"block",marginBottom:6}}>Sign in as</label>
              <div style={{display:"flex",gap:8}}>
                {[["treasurer","🏦 Treasurer"],["financemanager","💼 Finance Mgr"],["admin","🔑 Admin"],["auditor","🔍 Auditor"]].map(([r,lbl])=>(
                  <button key={r} onClick={()=>setLoginRole(r)} style={{flex:1,padding:"10px",borderRadius:10,border:loginRole===r?"2px solid var(--b600)":"2px solid var(--bdr)",background:loginRole===r?"var(--b100)":"#fff",cursor:"pointer",fontSize:12,fontWeight:loginRole===r?700:400,color:loginRole===r?"var(--b700)":"var(--tm)"}}>{lbl}</button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:10,fontWeight:700,fontFamily:"var(--mono)",color:"var(--tmuted)",textTransform:"uppercase",letterSpacing:.7,display:"block",marginBottom:6}}>PIN</label>
              <input type="password" value={loginPin} onChange={e=>setLoginPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="Enter your PIN" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid var(--bdr)",fontSize:18,fontFamily:"var(--mono)",outline:"none",letterSpacing:4,textAlign:"center"}}/>
            </div>
            {loginErr&&<div style={{background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#c62828",marginBottom:12,textAlign:"center"}}>{loginErr}</div>}
            <button onClick={doLogin} style={{width:"100%",padding:"13px",borderRadius:10,background:"linear-gradient(135deg,var(--b600),var(--b800))",color:"#fff",border:"none",fontSize:15,fontWeight:700,cursor:"pointer"}}>Sign In →</button>
            <div style={{textAlign:"center",marginTop:14,fontSize:10,color:"var(--tmuted)"}}>Authorised personnel only · BIDA Co-operative</div>
          </div>
        </div>
      )}

      {authUser&&<React.Fragment>
      <div className="app">
        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <header className="hdr">
          <div className="hdr-top">
            <div className="brand">
              <svg width="30" height="30" viewBox="0 0 80 80" fill="none">
                <defs><linearGradient id="lg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#1E88E5"/><stop offset="100%" stopColor="#0D47A1"/></linearGradient></defs>
                <polygon points="40,3 75,21.5 75,58.5 40,77 5,58.5 5,21.5" fill="url(#lg)" stroke="#42A5F5" strokeWidth="1.5"/>
                <rect x="19" y="40" width="10" height="15" rx="2.5" fill="#90CAF9" opacity="0.85"/>
                <rect x="32" y="31" width="10" height="24" rx="2.5" fill="#64B5F6"/>
                <rect x="45" y="22" width="10" height="33" rx="2.5" fill="#fff"/>
                <polygon points="50,17 56,23 44,23" fill="#fff"/>
              </svg>
              <div><div className="brand-name">BIDA</div><div className="brand-sub">Co-Operative Multi-Purpose Society</div></div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              {/* ── SYNC STATUS DOT ── */}
              <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(0,0,0,.2)",borderRadius:20,padding:"3px 10px",border:"1px solid rgba(255,255,255,.1)"}}>
                <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,
                  background:syncStatus==="synced"?"#69f0ae":syncStatus==="syncing"||syncStatus==="loading"?"#ffcc02":syncStatus==="offline"?"#ef5350":syncStatus==="error"?"#ef5350":"#607d8b",
                  boxShadow:syncStatus==="synced"?"0 0 6px #69f0ae":syncStatus==="syncing"||syncStatus==="loading"?"0 0 6px #ffcc02":"none",
                  animation:syncStatus==="syncing"||syncStatus==="loading"?"pu .8s ease-in-out infinite":"none"
                }}/>
                <span style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.8)",fontFamily:"var(--mono)",whiteSpace:"nowrap"}}>
                  {syncStatus==="synced"?"LIVE":syncStatus==="syncing"?"SAVING…":syncStatus==="loading"?"LOADING…":syncStatus==="offline"?"OFFLINE":syncStatus==="error"?"ERROR":"NO SYNC"}
                </span>
              </div>
              <button onClick={()=>setAuthUser(null)} style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.2)",borderRadius:8,padding:"4px 10px",color:"#fff",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"var(--mono)",whiteSpace:"nowrap"}}>
                {authUser?.role==="admin"?"🔑":authUser?.role==="auditor"?"🔍":authUser?.role==="finance_mgr"?"💼":"🏦"} {authUser?.name} · Logout
              </button>
            </div>
          </div>
          <div className="hdr-nav">
            <nav className="nav">
              <button className={"nbtn"+(tab==="savings"?" on":"")} onClick={()=>{setTab("savings");setSearch("");}}>💰 Savings</button>
              <button className={"nbtn"+(tab==="loans"?" on":"")} onClick={()=>{setTab("loans");setSearch("");}}>📋 Loans</button>
              <button className={"nbtn"+(tab==="reminders"?" on":"")} onClick={()=>{setTab("reminders");setSearch("");}}>
                ✉️ Remind{dueSoonLoans.length>0&&<span style={{background:"#ef5350",color:"#fff",borderRadius:"50%",fontSize:9,fontWeight:900,padding:"1px 5px",marginLeft:4}}>{dueSoonLoans.length}</span>}
              </button>
              <button className={"nbtn"+(tab==="expenses"?" on":"")} onClick={()=>{setTab("expenses");setSearch("");}} style={{position:"relative"}}>
                🧾 Expenses
                {expenses.filter(e=>e.expApprovalStatus==="pending_approval").length>0&&(
                  <span style={{position:"absolute",top:-4,right:-4,background:"#e65100",color:"#fff",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:9}}>
                    {expenses.filter(e=>e.expApprovalStatus==="pending_approval").length}
                  </span>
                )}
              </button>
              <button className={"nbtn"+(tab==="investments"?" on":"")} onClick={()=>{setTab("investments");setSearch("");}}>📈 Invest</button>
              <button className={"nbtn"+(tab==="reports"?" on":"")} onClick={()=>{setTab("reports");setSearch("");}}>📄 Reports</button>
              <button className={"nbtn"+(tab==="approvals"?" on":"")} onClick={()=>{setTab("approvals");setSearch("");}} style={{position:"relative"}}>
                ✅ Approvals
                {myPendingItems.length>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#e65100",color:"#fff",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:9}}>{myPendingItems.length}</span>}
              </button>
              <button className={"nbtn"+(tab==="benevolent"?" on":"")} onClick={()=>{setTab("benevolent");setSearch("");}}>🕊 Benevolent</button>
              <button className={"nbtn"+(tab==="audit"?" on":"")} onClick={()=>{setTab("audit");setSearch("");}}>🔒 Audit</button>
              <button className={"nbtn"+(tab==="settings"?" on":"")} onClick={()=>{setTab("settings");setSearch("");}}>⚙️ Settings</button>
            </nav>
          </div>
        </header>

        <main className="main">

          {/* ── SAVINGS TAB (MAIN DASHBOARD) ─────────────────────────────── */}
          {tab==="savings" && (
            <React.Fragment>
              {/* ── LIVE DATE & TIME BANNER ── */}
              <div style={{background:"linear-gradient(135deg,#0a1931,#0d3461)",borderRadius:13,padding:"13px 16px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:"#69f0ae",boxShadow:"0 0 8px #69f0ae",animation:"pu 1.5s ease-in-out infinite",flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,.4)",textTransform:"uppercase",letterSpacing:1,marginBottom:2}}>BIDA Co-operative Management System · Live</div>
                    <div style={{fontSize:15,fontWeight:800,color:"#fff",lineHeight:1.2}}>
                      {liveTime.toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}
                    </div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.4)",marginTop:3}}>
                      {authUser?.name} · {(authUser?.role||"").replace(/_/g," ").toUpperCase()}
                    </div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:32,fontWeight:900,color:"#90caf9",fontFamily:"var(--mono)",letterSpacing:3,lineHeight:1}}>
                    {liveTime.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
                  </div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,.35)",marginTop:4,fontFamily:"var(--mono)"}}>
                    {liveTime.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
                  </div>
                </div>
              </div>
              <div className="ptitle"><div className="ptdot"/>Dashboard — Member Savings Ledger</div>

              {/* ── TOP FINANCIAL SUMMARY ── */}
              <div style={{background:"linear-gradient(135deg,#0d3461,#1565c0)",borderRadius:13,padding:"14px 16px",marginBottom:12,color:"#fff"}}>
                <div style={{fontWeight:800,fontSize:13,marginBottom:10,opacity:.9,letterSpacing:.5,textTransform:"uppercase",fontFamily:"var(--mono)"}}>💳 BIDA Fund Summary</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
                  {[
                    ["Total Banked",fmt(savT.total),"#90caf9","All member deposits"],
                    ["Operational Expenses",fmt(expenses.filter(e=>e.category!=="banking").reduce((s,e)=>s+(+e.amount||0),0)),"#ef9a9a","Excl. bank charges"],
                    ["Bank Charges",fmt(expenses.filter(e=>e.category==="banking").reduce((s,e)=>s+(+e.amount||0),0)),"#ffcc80","Separate from ops"],
                    ["Loan Profit",fmt(lStat.profit),"#a5d6a7","Realised returns"],
                    ["Cash in Bank",fmt(cashInBank),cashInBank<0?"#ef5350":"#69f0ae","Net position"],
                    ["Outstanding",fmt(lStat.outstanding),"#ce93d8","Active loan balances"],
                  ].map(([l,v,c,sub])=>(
                    <div key={l} style={{background:"rgba(255,255,255,.1)",borderRadius:9,padding:"9px 11px"}}>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.6)",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:900,color:c,fontFamily:"var(--mono)"}}>{v}</div>
                      {sub&&<div style={{fontSize:9,color:"rgba(255,255,255,.45)",marginTop:2}}>{sub}</div>}
                    </div>
                  ))}
                </div>
                {cashInBank<0&&<div style={{marginTop:10,background:"rgba(239,83,80,.25)",border:"1px solid rgba(239,83,80,.5)",borderRadius:8,padding:"6px 10px",fontSize:10,color:"#ffcdd2",fontWeight:700}}>⚠️ Cash in bank is negative — expenses exceed total deposits + profit. Review immediately.</div>}
              </div>

              {/* ── STATS CARDS ── */}
              <div className="stats">
                <div className="card"><div className="clabel">Members</div><div className="cval">{members.length}</div></div>
                <div className="card ck"><div className="clabel">Total Banked</div><div className="cval ok">{fmt(savT.total)}</div></div>
                <div className="card"><div className="clabel">Monthly Savings</div><div className="cval">{fmt(savT.monthly)}</div></div>
                <div className="card"><div className="clabel">Welfare Pool</div><div className="cval">{fmt(savT.welfare)}</div></div>
                {savT.voluntary>0&&<div className="card ck"><div className="clabel">Voluntary Deposits</div><div className="cval ok">{fmt(savT.voluntary)}</div><div className="csub">Extra savings — in total</div></div>}
                <div className="card cd" title="Includes operational costs + bank transactional charges">
                  <div className="clabel">Total Expenses</div>
                  <div className="cval danger">{fmt(totalExpenses)}</div>
                  <div className="csub">incl. {fmt(expenses.filter(e=>e.category==="banking").reduce((s,e)=>s+(+e.amount||0),0))} bank charges</div>
                </div>
                <div className="card" style={{borderTop:"3px solid "+(cashInBank<0?"#c62828":"#43a047")}}><div className="clabel">Cash in Bank</div><div className={"cval"+(cashInBank<0?" danger":" ok")}>{fmt(cashInBank)}</div><div className="csub">Banked + Profit − Expenses</div></div>
                {totalInvInterest>0&&<div className="card ck"><div className="clabel">Investment Returns</div><div className="cval ok">{fmt(totalInvInterest)}</div><div className="csub">40% members · 60% pool</div></div>}
              </div>

              {/* ── SAVINGS/EXPENSES CHART ── */}
              <SavingsExpensesChart savingsData={SAVINGS_CHART_DATA} expensesData={EXPENSES_CHART_DATA}/>


              <div className="toolbar">
                <div className="tl"><span className="ttitle">All Members</span><span className="tcount">{fmems.length}</span></div>
                <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                  <div className="swrap"><span className="sico">🔍</span><input className="sinput" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
                  <button className="btn bpdf sm" onClick={()=>handlePDF("savings")} disabled={!!pdfGen}>{pdfGen==="savings"?"⏳...":"📥 PDF"}</button>
                  <button className="btn bp sm" onClick={()=>setAddMModal(true)}>＋ Add</button>
                </div>
              </div>
              <div className="twrap">
                <table>
                  <thead><tr><th>#</th><th>Name</th><th>Membership</th><th>Annual Sub</th><th>Monthly</th><th>Welfare</th><th>Shares</th><th>Total Banked</th><th>Max Borrow</th></tr></thead>
                  <tbody>
                    {fmems.length===0&&<tr><td colSpan={9}><div className="empty"><div className="eico">📭</div>No members found.</div></td></tr>}
                    {fmems.map((m,i)=>(
                      <tr key={m.id}>
                        <td className="sn">{i+1}</td>
                        <td><span className="nc" onClick={()=>openProfile(m)}>{m.name}</span></td>
                        <td className="mc">{fmt(m.membership)}</td>
                        <td className="mc">{fmt(m.annualSub)}</td>
                        <td className="mc">{fmt(m.monthlySavings)}</td>
                        <td className="mc">{fmt(m.welfare)}</td>
                        <td className="mc">{fmt(m.shares)}</td>
                        <td className="mct">{fmt(totBanked(m))}</td>
                        <td style={{fontFamily:"var(--mono)",fontSize:11,color:"#1565c0",fontWeight:700}}>{fmt(borrowLimit(m,loans))}</td>
                      </tr>
                    ))}
                    {!search&&<tr className="trow"><td/><td>TOTALS</td><td>{fmt(savT.membership)}</td><td>{fmt(savT.annualSub)}</td><td>{fmt(savT.monthly)}</td><td>{fmt(savT.welfare)}</td><td>{fmt(savT.shares)}</td><td>{fmt(savT.total)}</td><td/></tr>}
                  </tbody>
                </table>
              </div>
              <p style={{fontSize:10,color:"var(--tmuted)",marginTop:7,fontFamily:"var(--mono)"}}>💡 Tap a member name to open their profile, edit details, or download a personal statement.</p>
            </React.Fragment>
          )}

          {/* ── LOANS TAB ────────────────────────────────────────────────── */}
          {tab==="loans" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>Loan Register</div>
              <LoanRuleInfo/>
              <div className="int-rule">
                <span style={{fontSize:18,flexShrink:0}}>📐</span>
                <div className="int-rule-text">
                  <strong>Interest Rules (automatic):</strong> Loans under UGX 7,000,000 → 4% flat, terms: 3/6/9/12/18/24 months. Loans ≥ UGX 7,000,000 → 6% reducing balance, fixed 12-month term. Processing fee: UGX 25,000 + 1%. Borrow limit: 60% of (monthly savings + welfare).
                </div>
              </div>
              <div className="stats">
                <div className="card cw"><div className="clabel">Active Loans</div><div className="cval warn">{lStat.act}</div></div>
                <div className="card"><div className="clabel">Disbursed</div><div className="cval">{fmt(lStat.disbursed)}</div></div>
                <div className="card cd"><div className="clabel">Outstanding</div><div className="cval danger">{fmt(lStat.outstanding)}</div></div>
                <div className="card cd"><div className="clabel">Interest Accrued</div><div className="cval danger">{fmt(lStat.intAccrued)}</div></div>
                <div className="card ck"><div className="clabel">Profit Realised</div><div className="cval ok">{fmt(lStat.profit)}</div></div>
              </div>
              <div className="toolbar">
                <div className="tl"><span className="ttitle">All Loans</span><span className="tcount">{floans.length}</span></div>
                <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                  <div className="swrap"><span className="sico">🔍</span><input className="sinput" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
                  <button className="btn bpdf sm" onClick={()=>handlePDF("loans")} disabled={!!pdfGen}>{pdfGen==="loans"?"⏳...":"📥 PDF"}</button>
                  <button className="btn bp sm" onClick={openAddL}>＋ Loan</button>
                </div>
              </div>
              <div className="twrap">
                <table>
                  <thead><tr><th>#</th><th>Member</th><th>Issued</th><th>Principal</th><th className="hi">Method</th><th className="hi">Term</th><th className="hi">Monthly Pay</th><th className="hi">Elapsed</th><th className="hi">Int/Mo</th><th className="hi">Total Int.</th><th className="hi">Total Due</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {floans.length===0&&<tr><td colSpan={15}><div className="empty"><div className="eico">📭</div>No loans.</div></td></tr>}
                    {floans.map((l,i)=>{
                      const ov=l.status!=="paid"&&l.months>l.term;
                      const rowBg=l.status==="paid"?"#f1f8e9":ov?"#ffebee":undefined;
                      return (
                        <tr key={l.id} style={{background:rowBg}}>
                          <td className="sn">{i+1}</td>
                          <td>
                            <span className="nc" onClick={()=>{const m=members.find(m=>m.id===l.memberId);if(m){setTab("savings");setTimeout(()=>openProfile(m),50);}}}>{l.memberName}</span>
                            {l.status!=="paid"&&(l.approvalStatus==="approved"||!l.approvalStatus)&&<button className="btn bk xs" style={{marginLeft:6,fontSize:9}} onClick={()=>openPayModal(l)}>+ Pay</button>}
                          </td>
                          <td className="mc">{fmtD(l.dateBanked)}</td>
                          <td className="mc">{fmt(l.amountLoaned)}</td>
                          <td className="hi" style={{textAlign:"center"}}><span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:700,color:l.method==="reducing"?"#1565c0":"#37474f"}}>{l.method==="reducing"?"6% RB":"4% Flat"}</span></td>
                          <td className="hi" style={{textAlign:"center",fontFamily:"var(--mono)",fontWeight:700,fontSize:11}}>{l.term}mo</td>
                          <td className="hi mct">{fmt(l.monthlyPayment)}</td>
                          <td className="hi" style={{textAlign:"center"}}><span className={"int-pill"+(ov?" over":"")}>{l.months}mo{ov?" ⚠":""}</span></td>
                          <td className="hi mc">{fmt(l.monthlyInt)}</td>
                          <td className="hi mcd">{fmt(l.totalInterest)}</td>
                          <td className="hi mct">{fmt(l.totalDue)}</td>
                          <td className="mc">{fmt(l.amountPaid)}</td>
                          <td className={l.balance>0?"bp-neg":"bp-pos"}>{fmt(l.balance)}</td>
                          <td><span className={"badge "+(l.status==="paid"?"bpaid":ov?"bover":"bactive")}>{l.status==="paid"?"✓ Paid":ov?"⚠ Overdue":"● Active"}</span></td>
                          <td><div className="abtn">
                            {l.approvalStatus==="approved"||!l.approvalStatus
                              ?<React.Fragment>
                                <button className="btn bg xs" onClick={()=>openEditL(l)}>✏️</button>
                                {l.status!=="paid"&&<button className="btn bk xs" onClick={()=>markPd(l.id)}>✓</button>}
                              </React.Fragment>
                              :<span style={{fontSize:9,color:"#e65100",fontFamily:"var(--mono)"}}>⏳ Pending</span>
                            }
                            <button className="btn bd xs" onClick={()=>delL(l.id)}>🗑</button>
                          </div></td>
                        </tr>
                      );
                    })}
                    {!search&&loansCalc.length>0&&<tr className="trow">
                      <td colSpan={3}>TOTALS</td>
                      <td>{fmt(loans.reduce((s,l)=>s+(l.amountLoaned||0),0))}</td>
                      <td className="hi"/><td className="hi"/><td className="hi"/><td className="hi"/><td className="hi"/>
                      <td className="hi">{fmt(loansCalc.reduce((s,l)=>s+l.totalInterest,0))}</td>
                      <td className="hi">{fmt(loansCalc.reduce((s,l)=>s+l.totalDue,0))}</td>
                      <td>{fmt(loansCalc.reduce((s,l)=>s+l.amountPaid,0))}</td>
                      <td colSpan={3}/>
                    </tr>}
                  </tbody>
                </table>
              </div>
            </React.Fragment>
          )}

          {/* ── APPROVALS TAB ─────────────────────────────────────────── */}
          {tab==="approvals" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>✅ Approval Queue</div>

              {/* Role context banner */}
              <div style={{background:"linear-gradient(135deg,#0d3461,#1565c0)",borderRadius:12,padding:"12px 16px",marginBottom:12,color:"#fff"}}>
                <div style={{fontWeight:800,fontSize:13,marginBottom:4}}>
                  You are logged in as: <span style={{color:"#90caf9"}}>{authUser?.name}</span>
                </div>
                <div style={{fontSize:11,opacity:.8,lineHeight:1.7}}>
                  {(()=>{
                    const roleDesc={
                      treasurer:"You initiate loans and member registrations. Once submitted, the item moves to Finance Manager for numbers review. Money is NOT issued until all 4 steps complete.",
                      finance_mgr:"You review the numbers — savings compliance, borrow limits, liquidity. Approve to pass to Admin or reject with a reason to send back to Treasurer.",
                      admin:"You give governance approval — confirm policy compliance and documentation. Approve to pass to Auditor or reject with a reason.",
                      auditor:"You give the FINAL STAMP. Once you approve: ✅ Loan becomes active, 💰 Money can be issued, 📄 Official PDF is auto-generated with all 4 signatures and timestamps."
                    };
                    return roleDesc[authUser?.role]||"Review pending items below.";
                  })()}
                </div>
              </div>

              {/* 4-step flow diagram */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"12px 16px",marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:12,color:"var(--b800)",marginBottom:10}}>Approval Process</div>
                <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                  {APPROVAL_STEPS.map((s,i)=>(
                    <React.Fragment key={s.step}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                        <div style={{width:36,height:36,borderRadius:"50%",background:authUser?.role===s.role?"#1565c0":"var(--b50)",border:"2px solid "+(authUser?.role===s.role?"#1565c0":"var(--bdr)"),display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:13,color:authUser?.role===s.role?"#fff":"var(--b700)"}}>
                          {s.step}
                        </div>
                        <div style={{fontSize:9,fontWeight:600,color:authUser?.role===s.role?"#1565c0":"var(--tmuted)",textAlign:"center",maxWidth:60}}>{s.label}</div>
                      </div>
                      {i<APPROVAL_STEPS.length-1&&<div style={{flex:1,height:2,background:"var(--bdr)",minWidth:8,maxWidth:40}}/>}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* My pending items */}
              {myPendingItems.length===0?(
                <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"30px 16px",textAlign:"center"}}>
                  <div style={{fontSize:32,marginBottom:8}}>✅</div>
                  <div style={{fontWeight:700,fontSize:14,color:"var(--b800)",marginBottom:4}}>Nothing pending for you</div>
                  <div style={{fontSize:11,color:"var(--tmuted)"}}>Items requiring your action will appear here.</div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {myPendingItems.map((item,idx)=>{
                    const st=APPROVAL_STATUS[item.status]||APPROVAL_STATUS.draft;
                    const next=getNextStep(item.status);
                    const trail=item.item.approvalTrail||[];
                    return (
                      <div key={idx} style={{background:"#fff",border:"1.5px solid var(--bdr)",borderRadius:12,padding:"14px 16px"}}>
                        {/* Header */}
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
                          <div>
                            <div style={{fontWeight:800,fontSize:14,color:"var(--b800)"}}>{item.label}</div>
                            {item.amount&&<div style={{fontSize:12,color:"var(--tmuted)",marginTop:2}}>Amount: <strong>{fmt(item.amount)}</strong></div>}
                            <div style={{marginTop:4}}><span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:st.bg,color:st.color,fontWeight:700}}>{st.label}</span></div>
                          </div>
                          <div style={{fontSize:10,color:"var(--tmuted)",textAlign:"right"}}>
                            {item.type==="loan"?"📋 Loan Application":"👤 Member Registration"}
                          </div>
                        </div>

                        {/* Approval trail so far */}
                        {trail.length>0&&(
                          <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"8px 12px",marginBottom:10}}>
                            <div style={{fontSize:9,fontWeight:700,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,marginBottom:6}}>Approval trail</div>
                            {trail.map((t,ti)=>(
                              <div key={ti} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",borderBottom:ti<trail.length-1?"1px solid var(--bdr)":"none",flexWrap:"wrap"}}>
                                <div style={{width:20,height:20,borderRadius:"50%",background:t.decision==="approved"?"#e8f5e9":"#ffebee",border:"1.5px solid "+(t.decision==="approved"?"#a5d6a7":"#ffcdd2"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0}}>{t.decision==="approved"?"✓":"✗"}</div>
                                <div style={{flex:1}}>
                                  <span style={{fontWeight:700,fontSize:11,color:"var(--b800)"}}>Step {t.step} — {t.name}</span>
                                  <span style={{fontSize:10,color:"var(--tmuted)",marginLeft:6}}>{t.date} {t.time}</span>
                                  {t.note&&<div style={{fontSize:10,color:"var(--tmuted)",fontStyle:"italic"}}>"{t.note}"</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Loan detail preview */}
                        {item.type==="loan"&&(()=>{
                          const l=item.item;
                          const c=calcLoan(l);
                          return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                            {[["Principal",fmt(l.amountLoaned)],["Term",l.term+"mo"],["Monthly Pay",fmt(c.monthlyPayment)],["Total Due",fmt(c.totalDue)],["Purpose",l.loanPurpose||"—"],["Type",(l.loanType||"personal")]].map(([lb,v])=>(
                              <div key={lb} style={{background:"var(--b50)",borderRadius:7,padding:"5px 9px"}}>
                                <div style={{fontSize:9,color:"var(--tmuted)",textTransform:"uppercase"}}>{lb}</div>
                                <div style={{fontWeight:700,fontSize:11,color:"var(--b700)"}}>{v}</div>
                              </div>
                            ))}
                          </div>;
                        })()}

                        {/* Action buttons */}
                        {next&&(
                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            <div style={{fontWeight:700,fontSize:11,color:"var(--b700)"}}>Your action as {next.label} (Step {next.step}):</div>
                            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                              <button className="btn bp sm" onClick={()=>handleApprove(item.type,item.id,item.status,"")}>
                                ✅ {next.verb} &amp; Pass to Next Step
                              </button>
                              <button className="btn bd sm" onClick={()=>setRejectTarget({type:item.type,id:item.id,status:item.status})}>
                                ❌ Reject &amp; Return
                              </button>
                            </div>
                            {/* Reject modal inline */}
                            {rejectTarget&&rejectTarget.id===item.id&&(
                              <div style={{background:"#ffebee",border:"1.5px solid #ef9a9a",borderRadius:9,padding:"10px 12px"}}>
                                <div style={{fontSize:11,fontWeight:700,color:"#c62828",marginBottom:6}}>Reason for rejection (required):</div>
                                <textarea value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="e.g. Insufficient savings base, missing guarantor details..." style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #ef9a9a",fontSize:11,resize:"vertical",minHeight:60,outline:"none"}}/>
                                <div style={{display:"flex",gap:7,marginTop:8}}>
                                  <button className="btn bd sm" disabled={!rejectNote.trim()} onClick={()=>handleReject(item.type,item.id,item.status,rejectNote)}>Confirm Rejection</button>
                                  <button className="btn bg sm" onClick={()=>{setRejectTarget(null);setRejectNote("");}}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* All loans status overview */}
              {(canDo(authUser,"view"))&&(
                <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginTop:12}}>
                  <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10}}>All Loan Applications — Status</div>
                  {loans.length===0?<div style={{color:"var(--tmuted)",fontSize:11}}>No loans yet.</div>:
                  loans.map((l,i)=>{
                    const st=APPROVAL_STATUS[l.approvalStatus||"draft"]||APPROVAL_STATUS.draft;
                    const mem=members.find(m=>m.id===l.memberId);
                    return (
                      <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<loans.length-1?"1px solid var(--bdr)":"none",gap:8,flexWrap:"wrap"}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:12,color:"var(--b800)"}}>{mem?.name||l.memberName} — {fmt(l.amountLoaned)}</div>
                          <div style={{fontSize:10,color:"var(--tmuted)"}}>{fmtD(l.dateBanked)} · {l.loanPurpose||"—"}</div>
                        </div>
                        <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:st.bg,color:st.color,fontWeight:700,flexShrink:0}}>{st.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          )}

          {/* ── BENEVOLENT FUND TAB ─────────────────────────────────────── */}
          {tab==="benevolent" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>🕊 BIDA Benevolent Fund</div>

              {/* Policy Banner */}
              <div style={{background:"linear-gradient(135deg,#1a237e,#283593)",borderRadius:13,padding:"14px 16px",marginBottom:12,color:"#fff"}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>BIDA Member Protection Policy</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:8,marginBottom:10}}>
                  {[
                    ["🕊 Passing","Family receives 70% of total invested (principal + interest). Remaining 30% negotiated with board. NOK may retain account.","#ef9a9a"],
                    ["🏥 Serious Illness","Member entitled to support based on their share of the pool. Calculated after investment returns. BIDA retains operational capacity.","#ffcc80"],
                    ["🔒 Protected","At least 70% guaranteed payout to beneficiary. BIDA compensates fully upon board agreement.","#a5d6a7"],
                  ].map(([t,d,c])=>(
                    <div key={t} style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:9,padding:"10px 12px"}}>
                      <div style={{fontWeight:700,fontSize:12,color:c,marginBottom:4}}>{t}</div>
                      <div style={{fontSize:10,opacity:.8,lineHeight:1.6}}>{d}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,opacity:.6,borderTop:"1px solid rgba(255,255,255,.15)",paddingTop:8,lineHeight:1.6}}>
                  ⚠ Payout requires board approval. Percentage of shares and dividends realised are included in the calculation. NOK can be a BIDA member or non-member.
                </div>
              </div>

              {/* Benevolent Fund Stats */}
              {(()=>{
                const eligibleMembers = members.filter(m=>m.nextOfKin&&(m.nextOfKin.name||"").trim());
                const noNOK = members.filter(m=>!m.nextOfKin||(!(m.nextOfKin.name||"").trim()));
                const totalPool = savT.total;
                return (
                  <div className="stats" style={{marginBottom:12}}>
                    <div className="card ck"><div className="clabel">Members with NOK</div><div className="cval ok">{eligibleMembers.length}</div><div className="csub">Benevolent-ready</div></div>
                    <div className="card cw"><div className="clabel">Missing NOK</div><div className="cval warn">{noNOK.length}</div><div className="csub">Cannot activate fund</div></div>
                    <div className="card ck"><div className="clabel">Total Pool</div><div className="cval ok">{fmt(totalPool)}</div><div className="csub">Basis for calculations</div></div>
                    <div className="card"><div className="clabel">Min Payout (70%)</div><div className="cval">{fmt(Math.round(totalPool*0.70/Math.max(members.length,1)))}</div><div className="csub">Per member avg</div></div>
                  </div>
                );
              })()}

              {/* Members Missing NOK — urgent */}
              {(()=>{
                const noNOK = members.filter(m=>!m.nextOfKin||(!(m.nextOfKin.name||"").trim()));
                if(noNOK.length===0) return null;
                return (
                  <div style={{background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                    <div style={{fontWeight:800,fontSize:13,color:"#e65100",marginBottom:8}}>⚠ {noNOK.length} Members Have No Next of Kin on File</div>
                    <div style={{fontSize:11,color:"#795548",marginBottom:10,lineHeight:1.6}}>These members cannot benefit from the Benevolent Fund until NOK details are added. Ask them to update their profiles.</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {noNOK.map(m=>(
                        <button key={m.id} onClick={()=>{openProfile(m);setTimeout(()=>setProfEdit(true),100);}} style={{padding:"5px 11px",borderRadius:20,background:"#fff3e0",border:"1px solid #ffcc80",fontSize:11,fontWeight:700,color:"#e65100",cursor:"pointer"}}>
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Benevolent Claim Calculator */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10}}>💰 Benevolent Payout Calculator</div>
                <div style={{fontSize:11,color:"var(--tmuted)",marginBottom:12,lineHeight:1.6}}>
                  Select a member and claim type to calculate the payout. This is a calculator only — it does not disburse funds. Board must approve before any payout.
                </div>
                {(()=>{
                  const selMemberId=benovSelMember;
                  const setSelMemberId=setBenovSelMember;
                  const claimType=benovClaimType;
                  const setClaimType=setBenovClaimType;
                  const retention=benovRetention;
                  const setRetention=setBenovRetention;
                  const m = members.find(mb=>mb.id===+selMemberId);
                  // ── Calculation basis ──
                  // 1. Member's total savings (all categories)
                  const totalSavings = m ? totBanked(m) : 0;
                  // 2. Member's share of investment returns (by share capital ratio)
                  const totalShareCapital = Math.max(members.reduce((s,mb)=>s+(mb.shares||0),0),1);
                  const shareRatio = m ? (m.shares||0)/totalShareCapital : 0;
                  const invReturnsShare = Math.round(totalInvInterest * shareRatio);
                  // 3. Member's pool contribution ratio (by savings)
                  const poolRatio = (savT.total>0&&m) ? totBanked(m)/savT.total : 0;
                  // 4. Total base for DEATH = all savings + share of investment returns
                  const deathBase = totalSavings + invReturnsShare;
                  // 5. Total base for ILLNESS = 50% of their pool share value (BIDA retains capacity)
                  const illnessBase = Math.round(cashInBank * poolRatio * 0.50);
                  const totalBase = claimType==="death" ? deathBase : illnessBase;
                  // 6. Guaranteed minimum: 70% for passing, full amount for illness (already 50%)
                  const minPayout = claimType==="death" ? Math.round(deathBase * 0.70) : illnessBase;
                  const remaining30 = deathBase - minPayout; // the 30% board decides on
                  const fullPayout = deathBase; // if board agrees 100%
                  const nok = m?.nextOfKin||null;
                  return (
                    <div>
                      <div className="fgrid">
                        <div className="fg ff">
                          <label className="fl">Select Member</label>
                          <select className="fi" value={selMemberId} onChange={e=>setSelMemberId(e.target.value)}>
                            <option value="">— Select member —</option>
                            {members.map(mb=>(
                              <option key={mb.id} value={mb.id}>{mb.name} {mb.nextOfKin&&mb.nextOfKin.name?"✓":"⚠ No NOK"}</option>
                            ))}
                          </select>
                        </div>
                        <div className="fg ff">
                          <label className="fl">Claim Type</label>
                          <div style={{display:"flex",gap:8,marginTop:4}}>
                            {[["death","🕊 Passing"],["illness","🏥 Serious Illness"]].map(([v,lbl])=>(
                              <button key={v} type="button" onClick={()=>setClaimType(v)} style={{flex:1,padding:"8px",borderRadius:9,border:claimType===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:claimType===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:12,fontWeight:claimType===v?700:400,color:claimType===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {m&&(
                        <React.Fragment>
                          {/* NOK info */}
                          {nok&&nok.name?(
                            <div style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                              <div style={{fontWeight:700,fontSize:12,color:"#1b5e20",marginBottom:4}}>✅ Next of Kin on File</div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:11}}>
                                {[["Name",nok.name],["Phone",nok.phone||"—"],["Relationship",nok.relationship||"—"],["NIN",nok.nin||"—"],["Address",nok.address||"—"],["BIDA Member",nok.isMember?"Yes":"No"]].map(([lb,v])=>(
                                  <div key={lb}><span style={{color:"var(--tmuted)"}}>{lb}: </span><strong>{v}</strong></div>
                                ))}
                              </div>
                            </div>
                          ):(
                            <div style={{background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:9,padding:"8px 12px",marginBottom:10,fontSize:11,color:"#c62828"}}>
                              ⚠ No next of kin on file for {m.name}. Edit their profile to add NOK before activating benevolent fund.
                            </div>
                          )}
                          {/* Breakdown */}
                          <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"12px 14px",marginBottom:10}}>
                            <div style={{fontWeight:700,fontSize:12,color:"var(--b800)",marginBottom:8}}>📊 Payout Breakdown — {m.name}</div>
                            {(claimType==="death"?[
                              ["Member total savings",fmt(totalSavings),"var(--td)"],
                              ["Share of investment returns ("+Math.round(shareRatio*100)+"% of pool returns "+fmt(totalInvInterest)+")",fmt(invReturnsShare),"#1565c0"],
                              ["Total death claim base",fmt(deathBase),"var(--b800)"],
                              ["Minimum guaranteed payout (70%)",fmt(minPayout),"#1b5e20"],
                              ["Remaining 30% — board decision",fmt(remaining30),retention==="compensate"?"#1b5e20":"#e65100"],
                              ["Full payout if board agrees 100%",fmt(fullPayout),"#1565c0"],
                            ]:[
                              ["Member total savings",fmt(totalSavings),"var(--td)"],
                              ["Member's pool share ("+Math.round(poolRatio*100)+"%)",fmt(Math.round(cashInBank*poolRatio)),"var(--td)"],
                              ["Illness support (50% of pool share)",fmt(illnessBase),"#1b5e20"],
                              ["Member retains membership","Active — continues contributing","#1565c0"],
                            ]).map(([lb,v,c],i)=>(
                              <div key={lb} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:i<5?"1px solid var(--bdr)":"none",fontWeight:i===2||i===5?700:400}}>
                                <span style={{fontSize:11,color:"var(--td)"}}>{lb}</span>
                                <span style={{fontFamily:"var(--mono)",fontSize:12,fontWeight:700,color:c}}>{v}</span>
                              </div>
                            ))}
                          </div>
                          {/* Retention option for death claims */}
                          {claimType==="death"&&(
                            <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                              <div style={{fontWeight:700,fontSize:12,color:"var(--b800)",marginBottom:8}}>Remaining 30% — Board Decision</div>
                              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                {[
                                  ["compensate","✅ Full compensation — NOK receives 100%","Pay out the remaining 30% to next of kin as goodwill"],
                                  ["retain_account","🔄 NOK retains account — Takes on membership","NOK becomes a BIDA member and inherits the account"],
                                ].map(([v,lbl,sub])=>(
                                  <button key={v} type="button" onClick={()=>setRetention(v)} style={{flex:1,minWidth:180,padding:"10px 12px",borderRadius:9,border:retention===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:retention===v?"var(--b100)":"#fff",cursor:"pointer",textAlign:"left"}}>
                                    <div style={{fontWeight:700,fontSize:12,color:retention===v?"var(--b700)":"var(--td)"}}>{lbl}</div>
                                    <div style={{fontSize:10,color:"var(--tmuted)",marginTop:2,lineHeight:1.5}}>{sub}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Illness payout note */}
                          {claimType==="illness"&&(
                            <div style={{background:"#fff3e0",border:"1px solid #ffcc80",borderRadius:9,padding:"10px 12px",marginBottom:10,fontSize:11,color:"#e65100",lineHeight:1.6}}>
                              <strong>🏥 Illness Support Logic:</strong> Member receives support equal to 50% of their pool share value. This is calculated after all active investments and loan positions. BIDA retains capacity to remain operational. The member continues their membership after recovery.
                            </div>
                          )}
                          <div style={{background:claimType==="death"?"linear-gradient(135deg,#1b5e20,#2e7d32)":"linear-gradient(135deg,#0d3461,#1565c0)",borderRadius:10,padding:"12px 16px",color:"#fff"}}>
                            <div style={{fontSize:10,opacity:.7,textTransform:"uppercase",letterSpacing:.7,marginBottom:4}}>
                              {claimType==="death"?"Recommended Payout to "+((nok&&nok.name)||"Next of Kin"):"Support Entitlement for "+m.name}
                            </div>
                            <div style={{fontSize:26,fontWeight:900,fontFamily:"var(--mono)"}}>{fmt(claimType==="death"?(retention==="compensate"?fullPayout:minPayout):illnessBase)}</div>
                            <div style={{fontSize:10,opacity:.7,marginTop:4}}>
                              {claimType==="death"
                                ?retention==="compensate"?"Full 100% — board agreed all funds to NOK":"70% guaranteed + NOK retains remaining 30% account"
                                :"50% of member pool share — member retains membership after recovery"
                              }
                            </div>
                            <div style={{marginTop:10,fontSize:10,opacity:.6,lineHeight:1.6,borderTop:"1px solid rgba(255,255,255,.2)",paddingTop:8}}>
                              ⚠ This is a CALCULATION ONLY. Actual disbursement requires written board resolution, identity verification of next of kin, and formal documentation. Contact the BIDA board to initiate an official claim.
                            </div>
                          </div>
                        </React.Fragment>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Members with NOK on file */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px"}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10}}>👥 All Members — Benevolent Status</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr style={{background:"var(--b50)"}}>
                      {["#","Member","Total Invested","Min Payout (70%)","NOK Name","Relationship","NOK Phone","Status"].map(h=>(
                        <th key={h} style={{padding:"8px 10px",textAlign:h==="Total Invested"||h==="Min Payout (70%)"?"right":"left",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",borderBottom:"1.5px solid var(--bdr)"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {members.map((m,i)=>{
                        const nok=m.nextOfKin||null;
                        const hasNOK=nok&&(nok.name||"").trim();
                        const tb=totBanked(m);
                        const minPayout=Math.round(tb*0.70);
                        return (
                          <tr key={m.id} style={{borderBottom:"1px solid #eef5ff",background:hasNOK?"":"#fffde7"}}>
                            <td style={{padding:"7px 10px",fontSize:10,color:"var(--tmuted)"}}>{i+1}</td>
                            <td style={{padding:"7px 10px"}}><span className="nc" onClick={()=>openProfile(m)}>{m.name}</span></td>
                            <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",fontWeight:700,fontSize:11}}>{fmt(tb)}</td>
                            <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",fontWeight:700,fontSize:11,color:"#1b5e20"}}>{fmt(minPayout)}</td>
                            <td style={{padding:"7px 10px",fontSize:11,fontWeight:hasNOK?600:400,color:hasNOK?"var(--td)":"var(--tmuted)"}}>{hasNOK?nok.name:"—"}</td>
                            <td style={{padding:"7px 10px",fontSize:11,color:"var(--tmuted)"}}>{hasNOK?nok.relationship||"—":"—"}</td>
                            <td style={{padding:"7px 10px",fontSize:11,fontFamily:"var(--mono)",color:"var(--tmuted)"}}>{hasNOK?nok.phone||"—":"—"}</td>
                            <td style={{padding:"7px 10px"}}>
                              {hasNOK
                                ?<span style={{fontSize:9,background:"#e8f5e9",color:"#1b5e20",border:"1px solid #a5d6a7",borderRadius:20,padding:"2px 8px",fontWeight:700}}>✅ Protected</span>
                                :<button onClick={()=>{openProfile(m);setTimeout(()=>setProfEdit(true),100);}} style={{fontSize:9,background:"#fff3e0",color:"#e65100",border:"1px solid #ffcc80",borderRadius:20,padding:"2px 8px",fontWeight:700,cursor:"pointer"}}>⚠ Add NOK</button>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </React.Fragment>
          )}


          {/* ── AUDIT & LEDGER TAB ──────────────────────────────────────── */}
          {tab==="audit" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>🔒 Audit Trail, Ledger &amp; Finance</div>

              {/* Financial Statements */}
              {(()=>{
                const pool=savT.total;
                const outstanding=lStat.outstanding;
                const loanProfit=lStat.profit;
                const invTotal=investments.reduce((s,i)=>s+(+i.amount||0),0);
                const invReturns=investments.reduce((s,i)=>s+(+i.interestEarned||0),0);
                const grossIncome=loanProfit+invReturns;
                const netIncome=grossIncome-totalExpenses;
                const totalAssets=cashInBank+outstanding+invTotal;
                const equity=totalAssets-pool;
                return (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(270px,1fr))",gap:12,marginBottom:12}}>
                    <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px"}}>
                      <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10,paddingBottom:6,borderBottom:"2px solid var(--bdr2)"}}>📊 Income Statement</div>
                      {[["Loan Interest Income",loanProfit,"#2e7d32"],["Investment Returns",invReturns,"#2e7d32"],["Gross Income",grossIncome,"#1565c0"],["Less: Total Expenses",-totalExpenses,"#c62828"],["Net Surplus",netIncome,netIncome>=0?"#2e7d32":"#c62828"]].map(([l,v,c],i)=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:i===3?"2px solid var(--bdr2)":"1px solid var(--bdr)",fontWeight:i>=2?700:400}}>
                          <span style={{fontSize:11,color:"var(--td)"}}>{l}</span>
                          <span style={{fontFamily:"var(--mono)",fontSize:11,color:c}}>{v<0?"("+fmt(Math.abs(v))+")":fmt(v)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px"}}>
                      <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10,paddingBottom:6,borderBottom:"2px solid var(--bdr2)"}}>🏦 Balance Sheet</div>
                      <div style={{fontSize:10,fontWeight:700,color:"var(--b700)",marginBottom:4}}>ASSETS</div>
                      {[["Cash in Bank",cashInBank],["Loan Book (Outstanding)",outstanding],["Investments",invTotal],["Total Assets",totalAssets]].map(([l,v],i)=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:i===2?"2px solid var(--bdr2)":"1px solid var(--bdr)",fontWeight:i===3?700:400}}>
                          <span style={{fontSize:11,color:"var(--td)"}}>{l}</span>
                          <span style={{fontFamily:"var(--mono)",fontSize:11,color:i===3?"#1565c0":"var(--td)"}}>{fmt(v)}</span>
                        </div>
                      ))}
                      <div style={{fontSize:10,fontWeight:700,color:"var(--b700)",margin:"8px 0 4px"}}>LIABILITIES &amp; EQUITY</div>
                      {[["Member Savings (Liability)",pool],["Retained Surplus",equity],["Total L+E",totalAssets]].map(([l,v],i)=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:i===1?"2px solid var(--bdr2)":"1px solid var(--bdr)",fontWeight:i===2?700:400}}>
                          <span style={{fontSize:11,color:"var(--td)"}}>{l}</span>
                          <span style={{fontFamily:"var(--mono)",fontSize:11,color:i===2?"#1565c0":equity<0&&i===1?"#c62828":"var(--td)"}}>{fmt(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Dividend Calculator */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:8}}>💰 Dividend &amp; Surplus Distribution</div>
                <div style={{fontSize:11,color:"var(--tmuted)",marginBottom:10,lineHeight:1.6}}>Calculates distributable surplus after 20% statutory reserve and 10% operational reserve. Distributed 60% by share capital and 40% by savings contribution.</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                <button className="btn bp sm" onClick={()=>setDividendRun(calcDividends(members,loans,expenses,investments,null))}>
                  ⚙️ Calculate Dividends
                </button>
                {dividendRun&&<button className="btn bk sm" onClick={()=>{if(window.confirm("Record this dividend run in the payout ledger?"))saveDividendPayout(dividendRun);}}>💾 Save Payout Record</button>}
                </div>
                {dividendRun&&(
                  <React.Fragment>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,margin:"12px 0"}}>
                      {[["Gross Surplus",fmt(dividendRun.grossSurplus),"#2e7d32"],["Statutory (20%)",fmt(dividendRun.statutory),"#e65100"],["Operational (10%)",fmt(dividendRun.operational),"#f57f17"],["Distributable",fmt(dividendRun.distributable),"#1565c0"]].map(([l,v,c])=>(
                        <div key={l} style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"9px 11px"}}>
                          <div style={{fontSize:9,color:"var(--tmuted)",textTransform:"uppercase",marginBottom:3}}>{l}</div>
                          <div style={{fontWeight:800,fontSize:13,color:c,fontFamily:"var(--mono)"}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                        <thead><tr style={{background:"var(--b50)"}}>
                          {["Member","Shares","Share Div","Savings Div","Total"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:h==="Member"?"left":"right",fontSize:9,fontFamily:"var(--mono)",color:"var(--b700)",fontWeight:600,textTransform:"uppercase"}}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {dividendRun.perMember.filter(m=>m.totalDividend>0).sort((a,b)=>b.totalDividend-a.totalDividend).map(m=>(
                            <tr key={m.id} style={{borderBottom:"1px solid var(--bdr)"}}>
                              <td style={{padding:"7px 10px",fontWeight:600}}>{m.name}</td>
                              <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)"}}>{fmtN(m.shares)}</td>
                              <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",color:"#2e7d32"}}>{fmt(m.shareDividend)}</td>
                              <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",color:"#1565c0"}}>{fmt(m.savingsDividend)}</td>
                              <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",fontWeight:800,color:"#0d3461"}}>{fmt(m.totalDividend)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </React.Fragment>
                )}
              </div>

              {/* Dividend Payout History */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10}}>💰 Dividend Payout History <span style={{fontWeight:400,fontSize:11,color:"var(--tmuted)"}}>({dividendPayouts.length} runs recorded)</span></div>
                {dividendPayouts.length===0?(
                  <div style={{fontSize:11,color:"var(--tmuted)",padding:"8px 0"}}>No dividend runs recorded yet. Calculate dividends in the section above and click "Save Payout Record" to log a run permanently.</div>
                ):(
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead><tr style={{background:"var(--b50)"}}>
                        {["Run Date","Members Paid","Gross Surplus","Statutory (20%)","Operational (10%)","Distributable","Recorded By","Status"].map(h=>(
                          <th key={h} style={{padding:"7px 10px",textAlign:h==="Members Paid"||h==="Status"?"center":"right",textAlignLast:h==="Run Date"||h==="Recorded By"?"left":"right",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",borderBottom:"1.5px solid var(--bdr)",whiteSpace:"nowrap"}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {[...dividendPayouts].sort((a,b)=>new Date(b.runDate)-new Date(a.runDate)).map(run=>(
                          <tr key={run.id} style={{borderBottom:"1px solid #eef5ff"}}>
                            <td style={{padding:"7px 10px",fontFamily:"var(--mono)",fontSize:10,whiteSpace:"nowrap"}}>{fmtD(run.runDate)}</td>
                            <td style={{padding:"7px 10px",textAlign:"center",fontWeight:700}}>{run.totalMembers}</td>
                            <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",fontSize:10}}>{fmt(run.grossSurplus)}</td>
                            <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",fontSize:10,color:"#e65100"}}>{fmt(run.statutory)}</td>
                            <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",fontSize:10,color:"#f57f17"}}>{fmt(run.operational)}</td>
                            <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"var(--mono)",fontWeight:700,color:"#1b5e20",fontSize:11}}>{fmt(run.distributable)}</td>
                            <td style={{padding:"7px 10px",fontSize:10,color:"var(--tmuted)",whiteSpace:"nowrap"}}>{run.recordedBy}</td>
                            <td style={{padding:"7px 10px",textAlign:"center"}}>
                              <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,background:run.status==="paid"?"#e8f5e9":"#e3f2fd",color:run.status==="paid"?"#1b5e20":"#1565c0",border:"1px solid "+(run.status==="paid"?"#a5d6a7":"#90caf9")}}>
                                {run.status==="paid"?"✅ Paid":"📋 Declared"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Double-Entry Ledger */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10}}>📒 Double-Entry Ledger <span style={{fontWeight:400,fontSize:11,color:"var(--tmuted)"}}>({ledger.length} entries — immutable)</span></div>
                {ledger.length===0
                  ?<div style={{color:"var(--tmuted)",fontSize:11,padding:"10px 0"}}>No ledger entries yet. Entries are created automatically when loans are issued, expenses recorded, or savings updated.</div>
                  :<div style={{maxHeight:250,overflowY:"auto"}}>
                    {[...ledger].reverse().map((e,i)=>(
                      <div key={i} style={{display:"flex",gap:8,padding:"7px 0",borderBottom:"1px solid var(--bdr)",fontSize:11,flexWrap:"wrap",alignItems:"center"}}>
                        <div style={{width:110,color:"var(--tmuted)",fontFamily:"var(--mono)",fontSize:9,flexShrink:0}}>{new Date(e.ts).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
                        <div style={{flex:1,fontWeight:600,minWidth:120}}>{e.description}</div>
                        {e.debit>0&&<span style={{fontFamily:"var(--mono)",fontSize:10,color:"#c62828",fontWeight:700}}>DR {fmt(e.debit)}</span>}
                        {e.credit>0&&<span style={{fontFamily:"var(--mono)",fontSize:10,color:"#2e7d32",fontWeight:700}}>CR {fmt(e.credit)}</span>}
                        <span style={{fontSize:9,color:"var(--tmuted)",background:"var(--b50)",padding:"1px 5px",borderRadius:4}}>{e.account}</span>
                        <span style={{fontSize:9,color:"var(--tmuted)"}}>{e.actorName}</span>
                      </div>
                    ))}
                  </div>
                }
              </div>

              {/* Audit Trail */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10}}>🔍 Audit Trail <span style={{fontWeight:400,fontSize:11,color:"var(--tmuted)"}}>({auditLog.length} events — read only)</span></div>
                {auditLog.length===0
                  ?<div style={{color:"var(--tmuted)",fontSize:11,padding:"10px 0"}}>No audit events yet. All logins, record changes, and approvals will appear here.</div>
                  :<div style={{maxHeight:250,overflowY:"auto"}}>
                    {[...auditLog].reverse().map((e,i)=>{
                      const colors={login:"#1565c0",create:"#1b5e20",edit:"#e65100",delete:"#c62828",approve:"#2e7d32",reversal:"#6a1b9a"};
                      const bg={login:"#e3f2fd",create:"#e8f5e9",edit:"#fff8e1",delete:"#ffebee",approve:"#e8f5e9",reversal:"#f3e5f5"};
                      return (
                        <div key={i} style={{display:"flex",gap:8,padding:"7px 0",borderBottom:"1px solid var(--bdr)",fontSize:11,flexWrap:"wrap",alignItems:"center"}}>
                          <div style={{width:110,color:"var(--tmuted)",fontFamily:"var(--mono)",fontSize:9,flexShrink:0}}>{new Date(e.ts).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
                          <span style={{fontSize:9,padding:"2px 7px",borderRadius:5,fontWeight:700,background:bg[e.action]||"#f5f5f5",color:colors[e.action]||"#555",flexShrink:0}}>{(e.action||"").toUpperCase()}</span>
                          <div style={{flex:1,fontWeight:600}}>{e.entity} {e.entityId}</div>
                          <div style={{fontSize:9,color:"var(--tmuted)"}}>{e.actorName} ({e.actorRole})</div>
                        </div>
                      );
                    })}
                  </div>
                }
              </div>
            </React.Fragment>
          )}

          {/* ── SETTINGS TAB ─────────────────────────────────────────────── */}
          {tab==="settings" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>⚙️ Settings &amp; Database</div>

              {/* ── PIN MANAGEMENT — Admin only ── */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"16px",marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14,color:"var(--b800)"}}>🔑 User PIN Management</div>
                    <div style={{fontSize:11,color:"var(--tmuted)",marginTop:2}}>Change PINs for each role. Only the Administrator should do this.</div>
                  </div>
                  {!canDo(authUser,"all")&&<div style={{fontSize:11,color:"#c62828",background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:7,padding:"4px 10px"}}>⛔ Admin access required to change PINs</div>}
                </div>

                {/* Warning if any role still has default PIN */}
                {Object.keys(USER_DEFS).some(r=>isPinDefault(r))&&(
                  <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:9,padding:"9px 12px",marginBottom:12,fontSize:11,color:"#e65100",lineHeight:1.6}}>
                    ⚠ <strong>Security warning:</strong> {Object.keys(USER_DEFS).filter(r=>isPinDefault(r)).map(r=>USER_DEFS[r].name).join(", ")} {Object.keys(USER_DEFS).filter(r=>isPinDefault(r)).length===1?"is":"are"} still using the default PIN. Change all PINs before going live.
                  </div>
                )}

                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
                  {Object.entries(USER_DEFS).map(([roleKey,u])=>{
                    const isDefault=isPinDefault(roleKey);
                    const msg=pinMsg[roleKey];
                    const newPin=pinMgmt[roleKey]||"";
                    const confirmPin=pinConfirm[roleKey]||"";
                    const show=showPins[roleKey];
                    return (
                      <div key={roleKey} style={{background:"var(--b50)",border:"1.5px solid "+(isDefault?"#ffe082":"#a5d6a7"),borderRadius:10,padding:"12px 14px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                          <div>
                            <div style={{fontWeight:700,fontSize:13,color:"var(--b800)"}}>{u.name}</div>
                            <div style={{fontSize:9,fontFamily:"var(--mono)",color:"var(--tmuted)",textTransform:"uppercase",letterSpacing:.5}}>{u.role}</div>
                          </div>
                          <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,background:isDefault?"#fff3e0":"#e8f5e9",color:isDefault?"#e65100":"#1b5e20",border:"1px solid "+(isDefault?"#ffcc80":"#a5d6a7")}}>
                            {isDefault?"⚠ Default PIN":"✅ Custom PIN"}
                          </span>
                        </div>

                        {canDo(authUser,"all")?(
                          <React.Fragment>
                            <div style={{marginBottom:6}}>
                              <label style={{fontSize:10,color:"var(--tmuted)",display:"block",marginBottom:3,fontFamily:"var(--mono)"}}>NEW PIN (min 4 digits)</label>
                              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                <input
                                  type={show?"text":"password"}
                                  value={newPin}
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  autoComplete="new-password"
                                  onChange={e=>setPinMgmt(p=>({...p,[roleKey]:e.target.value.replace(/[^0-9]/g,"").slice(0,8)}))}
                                  placeholder="e.g. 4821"
                                  style={{flex:1,padding:"8px 10px",borderRadius:8,border:"1.5px solid var(--bdr)",fontFamily:"var(--mono)",fontSize:16,letterSpacing:4,outline:"none"}}
                                />
                                <button type="button" onClick={()=>setShowPins(p=>({...p,[roleKey]:!p[roleKey]}))}
                                  style={{padding:"8px 10px",borderRadius:8,border:"1px solid var(--bdr)",background:"#fff",cursor:"pointer",fontSize:12}}>
                                  {show?"🙈":"👁"}
                                </button>
                              </div>
                            </div>
                            <div style={{marginBottom:8}}>
                              <label style={{fontSize:10,color:"var(--tmuted)",display:"block",marginBottom:3,fontFamily:"var(--mono)"}}>CONFIRM PIN</label>
                              <input
                                type={show?"text":"password"}
                                value={confirmPin}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoComplete="new-password"
                                onChange={e=>setPinConfirm(p=>({...p,[roleKey]:e.target.value.replace(/[^0-9]/g,"").slice(0,8)}))}
                                placeholder="Repeat PIN"
                                style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid "+(confirmPin&&newPin&&confirmPin!==newPin?"#ef9a9a":"var(--bdr)"),fontFamily:"var(--mono)",fontSize:14,letterSpacing:3,outline:"none"}}
                              />
                              {confirmPin&&newPin&&confirmPin!==newPin&&<div style={{fontSize:10,color:"#c62828",marginTop:3}}>PINs do not match</div>}
                            </div>
                            <button
                              type="button"
                              disabled={!newPin||newPin.length<4||newPin!==confirmPin}
                              onClick={()=>{
                                if(newPin.length<4){setPinMsg(p=>({...p,[roleKey]:{type:"error",text:"PIN must be at least 4 digits"}}));return;}
                                if(newPin!==confirmPin){setPinMsg(p=>({...p,[roleKey]:{type:"error",text:"PINs do not match"}}));return;}
                                savePin(roleKey,newPin);
                                postAudit([mkAudit("config_change","pin",roleKey,null,{role:roleKey,changed:true},authUser?.role,authUser?.name)]);
                                setPinMsg(p=>({...p,[roleKey]:{type:"ok",text:"✅ PIN updated successfully"}}));
                                setPinMgmt(p=>({...p,[roleKey]:""}));
                                setPinConfirm(p=>({...p,[roleKey]:""}));
                                setTimeout(()=>setPinMsg(p=>({...p,[roleKey]:null})),3000);
                              }}
                              style={{width:"100%",padding:"9px",borderRadius:8,background:newPin&&newPin.length>=4&&newPin===confirmPin?"linear-gradient(135deg,#1565c0,#0d3461)":"#e0e0e0",color:newPin&&newPin.length>=4&&newPin===confirmPin?"#fff":"#999",border:"none",cursor:newPin&&newPin.length>=4&&newPin===confirmPin?"pointer":"not-allowed",fontWeight:700,fontSize:12}}>
                              🔑 Update PIN for {u.name}
                            </button>
                            {msg&&<div style={{marginTop:6,fontSize:11,color:msg.type==="ok"?"#1b5e20":"#c62828",textAlign:"center"}}>{msg.text}</div>}
                          </React.Fragment>
                        ):(
                          <div style={{fontSize:11,color:"var(--tmuted)",fontStyle:"italic",padding:"8px 0"}}>Log in as Administrator to change this PIN.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Supabase Setup */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"16px",marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:14,color:"var(--b800)",marginBottom:4}}>🗄 Supabase Database Connection</div>
                <div style={{fontSize:11,color:"var(--tmuted)",marginBottom:12,lineHeight:1.6}}>
                  To enable sync on THIS device: paste the Supabase API key below. Every device (phone, tablet, laptop) needs this key entered once. Get it from: Supabase Dashboard → your project → Settings → API → copy the <strong>anon public</strong> key (starts with eyJ...).
                </div>
                <div style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:9,padding:"10px 13px",marginBottom:12,fontSize:11,color:"#1b5e20",lineHeight:1.7}}>
                  <strong>Project URL:</strong> https://oscuauaifgaeauzvkihu.supabase.co<br/>
                  <strong>Status:</strong> {syncStatus==="synced"?"✅ Connected and saving":"syncing"===syncStatus?"🔄 Syncing...":"loading"===syncStatus?"⏳ Loading data...":"offline"===syncStatus?"📵 Offline — will sync when connected":"⚠ Not connected — enter API key below"}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <input
                    type="password"
                    className="fi"
                    style={{flex:1,minWidth:200,fontFamily:"var(--mono)",fontSize:11}}
                    placeholder="Paste your Supabase anon/public API key here..."
                    value={supaKeyInput}
                    onChange={e=>setSupaKeyInput(e.target.value)}
                  />
                  <button className="btn bp sm" onClick={()=>{
                    setSupaKey(supaKeyInput);
                    setSyncStatus("loading");
                    loadAllFromSupabase()
                      .then(data=>{
                        if(data.members&&data.members.length>0) setMembers(data.members);
                        if(data.loans&&data.loans.length>=0) setLoans(data.loans);
                        if(data.expenses&&data.expenses.length>=0) setExpenses(data.expenses);
                        if(data.investments&&data.investments.length>=0) setInvestments(data.investments);
                        if(data.serviceProviders&&data.serviceProviders.length>0) setServiceProviders(data.serviceProviders);
                        if(data.contribLog&&data.contribLog.length>=0) setContribLog(data.contribLog);
                        if(data.dividendPayouts&&data.dividendPayouts.length>=0) setDividendPayouts(data.dividendPayouts);
                        setDbLoaded(true);setSyncStatus("synced");
                        alert("✅ Connected! All data loaded from Supabase.");
                      })
                      .catch(e=>{setSyncStatus("error");alert("Connection failed: "+e.message+"\n\nCheck that your Supabase project is active.");});
                  }}>Connect &amp; Load Data</button>
                  {getSupaKey()&&<button className="btn bg sm" onClick={()=>{setSupaKey("");setSupaKeyInput("");setSyncStatus("idle");alert("API key cleared.");}}>Disconnect</button>}
                </div>
                {syncStatus==="offline"&&(
                  <div style={{marginTop:10,background:"#fff8e1",border:"1px solid #ffe082",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#e65100"}}>
                    📵 You are offline. All changes are being saved locally and will sync automatically when your internet connection returns.
                  </div>
                )}
              </div>
              {/* Connected URL info */}
              <div style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:9,padding:"9px 14px",marginBottom:12,fontSize:11,color:"#1b5e20",fontFamily:"var(--mono)"}}>
                ✅ Connected to: <strong>gzoafxyinwysstpixlclw.supabase.co</strong> · Key active · Real-time sync every 15s
              </div>
              {/* Manual sync */}
              {getSupaKey()&&(
                <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--b800)",marginBottom:8}}>🔄 Manual Sync</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button className="btn bp sm" onClick={async()=>{
                      setSyncStatus("loading");
                      try{
                        const data=await loadAllFromSupabase();
                        // Safe merge — DB wins on conflict, local-only records preserved
                        if(data.members&&data.members.length>0){
                          setMembers(prev=>{
                            const dbIds=new Set(data.members.map(m=>m.id));
                            return [...data.members,...prev.filter(m=>!dbIds.has(m.id))];
                          });
                        }
                        if(data.loans&&data.loans.length>=0){
                          setLoans(prev=>{
                            const dbIds=new Set(data.loans.map(l=>l.id));
                            return [...data.loans,...prev.filter(l=>!dbIds.has(l.id))];
                          });
                        }
                        if(data.expenses&&data.expenses.length>=0){
                          setExpenses(prev=>{
                            const dbIds=new Set(data.expenses.map(e=>e.id));
                            return [...data.expenses,...prev.filter(e=>!dbIds.has(e.id))];
                          });
                        }
                        if(data.investments&&data.investments.length>=0) setInvestments(data.investments);
                        if(data.serviceProviders&&data.serviceProviders.length>0) setServiceProviders(data.serviceProviders);
                        if(data.contribLog&&data.contribLog.length>=0) setContribLog(data.contribLog);
                        if(data.dividendPayouts&&data.dividendPayouts.length>=0) setDividendPayouts(data.dividendPayouts);
                        setSyncStatus("synced");
                        alert("✅ All data refreshed from Supabase.");
                      }catch(e){
                        setSyncStatus("error");
                        alert("Refresh failed: "+e.message+"\n\nCheck your internet connection and try again.");
                      }
                    }}>↓ Pull latest from database</button>
                    <button className="btn bg sm" onClick={()=>replayOfflineQueue(setSyncStatus)}>↑ Push offline changes</button>
                  </div>
                </div>
              )}
            </React.Fragment>
          )}

          {tab==="reminders" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>Reminders & Notifications</div>

              {emailSetup&&(
                <div className="setup-banner">
                  <h3>⚙️ API not connected — follow these steps to enable one-click sending</h3>
                  <ol>
                    <li>Create a free <a href="https://sendgrid.com" target="_blank" rel="noreferrer">SendGrid</a> account → Settings → API Keys → copy key</li>
                    <li>In <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Vercel</a> → Settings → Environment Variables, add:<br/><code>SENDGRID_API_KEY</code>, <code>FROM_EMAIL</code> = bidacooperative@gmail.com, <code>FROM_NAME</code> = BIDA Co-operative Multi-Purpose Society</li>
                    <li>Create <a href="https://africastalking.com" target="_blank" rel="noreferrer">Africa's Talking</a> account → add: <code>AT_API_KEY</code>, <code>AT_USERNAME</code>, <code>AT_SENDER_ID</code>=BIDACOOP</li>
                    <li>For WhatsApp API: add <code>WA_TOKEN</code> (Meta WhatsApp Business API token) and <code>WA_PHONE_ID</code></li>
                    <li>Redeploy on Vercel — all channels activate immediately.</li>
                  </ol>
                </div>
              )}

              {/* ── 5-day due date alerts (automated) ── */}
              {dueSoonLoans.length>0&&(
                <div className="due-alert">
                  <div className="due-alert-title">🔔 Automated Due Date Alerts — {dueSoonLoans.length} loan{dueSoonLoans.length>1?"s":""} due within 5 days</div>
                  <div style={{fontSize:11,color:"#bf360c",marginBottom:10}}>These alerts are triggered automatically. Send reminders now via any channel.</div>
                  {dueSoonLoans.map(loan=>(
                    <DueLoanRow key={loan.id} loan={loan} members={members} emailSending={emailSending} sendDueEmail={sendDueEmail} sendDueSMS={sendDueSMS}/>
                  ))}
                </div>
              )}

              {/* ── Monthly savings reminders ── */}
              <div className="email-section">
                <div className="email-sec-title">💰 Monthly Savings — {mn} {yr}</div>
                <div className="email-sec-sub">Send reminders via Email (PDF attached), WhatsApp, or SMS.</div>
                <div className="send-all-bar">
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    <span style={{fontWeight:700,fontSize:12,color:"var(--b800)"}}>📨 {members.filter(m=>m.email).length} with email</span>
                    <span style={{fontWeight:700,fontSize:12,color:"#25D366"}}>💬 {members.filter(m=>m.whatsapp).length} with WhatsApp/SMS</span>
                    <span style={{fontSize:10,color:"var(--tmuted)"}}>{members.filter(m=>!m.email&&!m.whatsapp).length} unreachable — add contacts via profile ✏️</span>
                  </div>
                  <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                    <button className="btn bemail sm" onClick={sendAllSavings} disabled={!members.some(m=>m.email)||Object.values(emailSending).some(v=>v==="sending")}>📨 All Email ({members.filter(m=>m.email).length})</button>
                    <button className="btn bsms sm" onClick={sendAllSavingsSMS} disabled={!members.some(m=>m.whatsapp)||Object.values(emailSending).some(v=>v==="sending")}>📱 All SMS ({members.filter(m=>m.whatsapp).length})</button>
                  </div>
                </div>
                {members.map(m=>(
                  <div key={m.id} className="email-row">
                    <div className="email-member-info">
                      <Avatar name={m.name} size={28}/>
                      <div>
                        <div className="email-member-name">{m.name}</div>
                        <div className="contact-row">
                          {m.email?<span style={{fontSize:10,color:"var(--tmuted)",fontFamily:"var(--mono)"}}>{m.email}</span>:<span className="no-email-tag">No email</span>}
                          {m.whatsapp?<span className="wa-chip" onClick={()=>window.open(waLink(m.whatsapp),"_blank")}>{WA_SVG}{m.whatsapp}</span>:<span className="no-wa-tag">No WA</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                      <ESt k={"sav_"+m.id}/><ESt k={"sms_sav_"+m.id}/>
                      {m.email&&<button className="btn bemail xs" disabled={emailSending["sav_"+m.id]==="sending"} onClick={()=>sendSavingsEmail(m)}>{emailSending["sav_"+m.id]==="sending"?"⏳":"📨"}</button>}
                      {m.whatsapp&&<a className="btn bwa xs" href={waLink(m.whatsapp,buildWASavingsMsg(m))} target="_blank" rel="noreferrer">{WA_SVG}WA</a>}
                      {m.whatsapp&&<button className="btn bsms xs" disabled={emailSending["sms_sav_"+m.id]==="sending"} onClick={()=>sendSavingsSMS(m)}>{emailSending["sms_sav_"+m.id]==="sending"?"⏳":"📱"}</button>}
                      {!m.email&&!m.whatsapp&&<span style={{fontSize:10,color:"var(--tmuted)"}}>No contacts</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Loan reminders ── */}
              {loansCalc.filter(l=>l.status!=="paid").length>0&&(
                <div className="email-section">
                  <div className="email-sec-title">⚠️ Loan Settlement Reminders</div>
                  <div className="email-sec-sub">Send personalised loan balance reminders.</div>
                  {loansCalc.filter(l=>l.status!=="paid").map(l=>{
                    const mem=members.find(m=>m.id===l.memberId);if(!mem)return null;
                    const ov=l.months>l.term;
                    return (
                      <div key={l.id} className="email-row">
                        <div className="email-member-info">
                          <Avatar name={mem.name} size={28}/>
                          <div>
                            <div className="email-member-name">{mem.name}</div>
                            <div className="contact-row">
                              {mem.email?<span style={{fontSize:10,color:"var(--tmuted)",fontFamily:"var(--mono)"}}>{mem.email}</span>:<span className="no-email-tag">No email</span>}
                              {mem.whatsapp?<span className="wa-chip" onClick={()=>window.open(waLink(mem.whatsapp),"_blank")}>{WA_SVG}{mem.whatsapp}</span>:<span className="no-wa-tag">No WA</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{textAlign:"right",marginRight:6}}>
                          <div style={{fontFamily:"var(--mono)",fontSize:11,fontWeight:700,color:"#c62828"}}>{fmt(l.balance)}</div>
                          <span className={"badge "+(ov?"bover":"bactive")}>{ov?"⚠ Overdue":"● Active"}</span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                          <ESt k={"loan_"+l.id}/><ESt k={"sms_loan_"+l.id}/>
                          {mem.email&&<button className="btn bemail xs" disabled={emailSending["loan_"+l.id]==="sending"} onClick={()=>sendLoanEmail(mem,l)}>{emailSending["loan_"+l.id]==="sending"?"⏳":"📨"}</button>}
                          {mem.whatsapp&&<a className="btn bwa xs" href={waLink(mem.whatsapp,buildWALoanMsg(mem,l))} target="_blank" rel="noreferrer">{WA_SVG}WA</a>}
                          {mem.whatsapp&&<button className="btn bsms xs" disabled={emailSending["sms_loan_"+l.id]==="sending"} onClick={()=>sendLoanSMS(mem,l)}>{emailSending["sms_loan_"+l.id]==="sending"?"⏳":"📱"}</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          )}

          {/* ── EXPENSES TAB ─────────────────────────────────────────────── */}
          {tab==="expenses" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>Expenses Register</div>

              {/* Pending approval alert — shown to admin */}
              {(()=>{
                const pending=expenses.filter(e=>e.expApprovalStatus==="pending_approval");
                if(pending.length===0) return null;
                return (
                  <div style={{background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:11,padding:"11px 14px",marginBottom:12}}>
                    <div style={{fontWeight:800,fontSize:13,color:"#e65100",marginBottom:4}}>⏳ {pending.length} Expense{pending.length>1?"s":""} Awaiting Approval</div>
                    <div style={{fontSize:11,color:"#795548",marginBottom:10,lineHeight:1.6}}>
                      Expenses of UGX 100,000 and above require Administrator approval. {authUser?.role==="admin"?"Use the ✓ Approve / ✗ Reject buttons in the table below.":"Ask the Administrator to review these in the Expenses tab."}
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {pending.map(e=>(
                        <div key={e.id} style={{background:"#fff",border:"1px solid #ffcc80",borderRadius:8,padding:"6px 10px",fontSize:11}}>
                          <span style={{fontWeight:700,color:"#e65100"}}>{fmt(e.amount)}</span>
                          <span style={{color:"var(--tmuted)",marginLeft:6}}>{e.activity?.substring(0,30)}{(e.activity?.length||0)>30?"…":""}</span>
                          {authUser?.role==="admin"&&(
                            <React.Fragment>
                              <button onClick={()=>approveExpense(e.id)} style={{marginLeft:8,background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:6,padding:"2px 7px",fontSize:10,fontWeight:700,color:"#1b5e20",cursor:"pointer"}}>✓ Approve</button>
                              <button onClick={()=>{const r=window.prompt("Reason for rejection:");if(r)rejectExpense(e.id,r);}} style={{marginLeft:4,background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:6,padding:"2px 7px",fontSize:10,fontWeight:700,color:"#c62828",cursor:"pointer"}}>✗ Reject</button>
                            </React.Fragment>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Cash in Bank hero card */}
              <div style={{background:"linear-gradient(135deg,"+(cashInBank<0?"#b71c1c,#c62828":"#1b5e20,#2e7d32")+")",borderRadius:12,padding:"12px 16px",marginBottom:12,color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{fontSize:10,opacity:.75,textTransform:"uppercase",letterSpacing:.7,fontFamily:"var(--mono)"}}>💳 Cash in Bank (live)</div>
                  <div style={{fontSize:26,fontWeight:900,fontFamily:"var(--mono)",marginTop:2}}>{fmt(cashInBank)}</div>
                  <div style={{fontSize:10,opacity:.7,marginTop:3}}>Total Banked {fmt(savT.total)} + Profit {fmt(lStat.profit)} − Expenses {fmt(totalExpenses)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,opacity:.7}}>Transactions</div>
                  <div style={{fontSize:22,fontWeight:900}}>{expenses.length}</div>
                </div>
              </div>

              <div className="stats">
                <div className="card ck"><div className="clabel">Total Banked</div><div className="cval ok">{fmt(savT.total)}</div></div>
                <div className="card cd" title="Includes operational costs + bank transactional charges">
                  <div className="clabel">Total Expenses</div>
                  <div className="cval danger">{fmt(totalExpenses)}</div>
                  <div className="csub">incl. {fmt(expenses.filter(e=>e.category==="banking").reduce((s,e)=>s+(+e.amount||0),0))} bank charges</div>
                </div>
                <div className="card ck"><div className="clabel">Profit Realised</div><div className="cval ok">{fmt(lStat.profit)}</div></div>
                <div className="card" style={{borderTop:"3px solid "+(cashInBank<0?"#c62828":"#43a047")}}><div className="clabel">Cash in Bank</div><div className={"cval"+(cashInBank<0?" danger":" ok")}>{fmt(cashInBank)}</div><div className="csub">Banked + Profit − Expenses</div></div>
                <div className="card cw"><div className="clabel">Transactions</div><div className="cval warn">{expenses.length}</div></div>
              </div>

              {/* ── SERVICE PROVIDERS DIRECTORY ── */}
              <div style={{background:"linear-gradient(135deg,#1a237e,#283593)",borderRadius:12,padding:"13px 16px",marginBottom:12,color:"#fff"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:13}}>🏪 BIDA Service Provider Directory</div>
                    <div style={{fontSize:10,opacity:.7,marginTop:2}}>All payments to providers must go through the approval process — no casual payments.</div>
                  </div>
                  <button className="btn sm" style={{background:"rgba(255,255,255,.15)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",fontWeight:700}} onClick={()=>{setEditSp(null);setSpF({isMember:true,memberId:"",companyName:"",tin:"",directorName:"",phone:"",serviceType:"",description:"",registeredDate:new Date().toISOString().split("T")[0],regFee:0,regFeePaid:false,approvalStatus:"pending",approvedByMemberId:"",expiryDate:""});setSpModal(true);}}>＋ Register Provider</button>
                </div>
                {/* Policy pills */}
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                  {[["👤 BIDA Member","12 months mandate","#a5d6a7"],["🏢 Non-Member","6 months · UGX 25,000 fee","#ffcc80"],["✅ Compliant","Active monthly savings + annual sub","#90caf9"],["⚠ Non-Compliant","Cannot receive new contracts","#ef9a9a"]].map(([l,sub,c])=>(
                    <div key={l} style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:7,padding:"4px 10px",fontSize:9}}>
                      <span style={{fontWeight:700,color:c}}>{l}</span><span style={{opacity:.6,marginLeft:4}}>{sub}</span>
                    </div>
                  ))}
                </div>
                {serviceProviders.length===0
                  ?<div style={{background:"rgba(255,255,255,.08)",borderRadius:8,padding:"10px 12px",fontSize:11,color:"rgba(255,255,255,.6)",textAlign:"center"}}>No providers registered yet. Click + Register Provider to add one.</div>
                  :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
                    {serviceProviders.map((sp,idx)=>{
                      const m=sp.isMember?members.find(mb=>mb.id===sp.memberId):null;
                      const compliant=sp.isMember?(m&&isProviderCompliant(m)):true;
                      const active=spIsActive(sp);
                      const expiry=spExpiryDate(sp);
                      const displayName=sp.companyName||(m?m.name:"Unknown");
                      return (
                        <div key={idx} style={{background:active?(compliant?"rgba(255,255,255,.12)":"rgba(255,167,38,.15)"):"rgba(239,83,80,.15)",border:"1px solid "+(active?(compliant?"rgba(255,255,255,.2)":"rgba(255,167,38,.4)"):"rgba(239,83,80,.5)"),borderRadius:9,padding:"10px 11px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                            <div style={{fontWeight:700,fontSize:12,color:"#fff",flex:1}}>{displayName}</div>
                            <div style={{display:"flex",gap:4}}>
                              <button type="button" onClick={()=>{setEditSp(idx);setSpF({...sp});setSpModal(true);}} style={{background:"none",border:"none",color:"rgba(255,255,255,.5)",cursor:"pointer",fontSize:11,padding:0}}>✏️</button>
                              <button type="button" onClick={()=>{if(window.confirm("Remove "+displayName+"?"))setServiceProviders(prev=>prev.filter((_,i)=>i!==idx));}} style={{background:"none",border:"none",color:"rgba(239,83,80,.7)",cursor:"pointer",fontSize:11,padding:0}}>🗑</button>
                            </div>
                          </div>
                          <div style={{fontSize:9,opacity:.7,marginBottom:3}}>{sp.serviceType}</div>
                          {sp.directorName&&<div style={{fontSize:9,opacity:.65}}>Dir: {sp.directorName}</div>}
                          {sp.phone&&<div style={{fontSize:9,opacity:.65}}>📞 {sp.phone}</div>}
                          {sp.tin&&<div style={{fontSize:9,opacity:.55,fontFamily:"var(--mono)"}}>TIN: {sp.tin}</div>}
                          <div style={{marginTop:5,display:"flex",gap:4,flexWrap:"wrap"}}>
                            <span style={{fontSize:8,background:sp.isMember?"rgba(165,214,167,.3)":"rgba(255,204,128,.3)",color:sp.isMember?"#a5d6a7":"#ffcc80",borderRadius:5,padding:"1px 5px",fontWeight:700}}>{sp.isMember?"👤 Member":"🏢 Non-Member"}</span>
                            <span style={{fontSize:8,background:compliant?"rgba(165,214,167,.2)":"rgba(255,167,38,.2)",color:compliant?"#a5d6a7":"#ffcc80",borderRadius:5,padding:"1px 5px",fontWeight:700}}>{compliant?"✅ Compliant":"⚠ Non-compliant"}</span>
                            <span style={{fontSize:8,background:active?"rgba(144,202,249,.2)":"rgba(239,83,80,.2)",color:active?"#90caf9":"#ef9a9a",borderRadius:5,padding:"1px 5px",fontWeight:700}}>{active?"● Active":"✕ Expired"}</span>
                          </div>
                          {expiry&&<div style={{fontSize:8,opacity:.5,marginTop:3}}>Expires: {expiry.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}</div>}
                          {!sp.isMember&&!sp.regFeePaid&&<div style={{marginTop:4,fontSize:8,color:"#ffcc80",fontWeight:700}}>⚠ UGX 25,000 registration fee not paid</div>}
                        </div>
                      );
                    })}
                  </div>
                }
              </div>

              <div className="toolbar">
                <div className="tl"><span className="ttitle">Full Ledger</span><span className="tcount">{expenses.length}</span></div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  <button className="btn bpdf sm" onClick={()=>handlePDF("expenses")} disabled={!!pdfGen}>{pdfGen==="expenses"?"⏳...":"📥 PDF"}</button>
                  <button className="btn bp sm" onClick={openAddExp}>＋ Add Expense</button>
                </div>
              </div>

              {/* Full ledger table with running balance */}
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,overflow:"hidden"}}>
                {expenses.length===0&&<div className="empty" style={{padding:"30px"}}><div className="eico">🧾</div>No expenses recorded yet. Click + Add Expense to begin.</div>}
                {expenses.length>0&&(
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead>
                        <tr style={{background:"var(--b50)"}}>
                          <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)",whiteSpace:"nowrap"}}>#</th>
                          <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)",whiteSpace:"nowrap"}}>Date</th>
                          <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)"}}>Activity</th>
                          <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)"}}>Issued By</th>
                          <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)"}}>Category</th>
                          <th style={{padding:"8px 10px",textAlign:"right",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)",whiteSpace:"nowrap"}}>Amount</th>
                          <th style={{padding:"8px 10px",textAlign:"right",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)",whiteSpace:"nowrap"}}>Balance After</th>
                          <th style={{padding:"8px 10px",textAlign:"center",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,borderBottom:"1.5px solid var(--bdr)"}}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(()=>{
                          // Sort chronologically to compute running balance correctly
                          const sorted=[...expenses].sort((a,b)=>new Date(a.date)-new Date(b.date));
                          const _rr=loans.reduce((s,l)=>s+(+l.amountPaid||0),0);
                          const _dd=loans.filter(l=>l.approvalStatus==="approved"||!l.approvalStatus).reduce((s,l)=>s+(+l.amountLoaned||0),0);
                          const _ii=investments.reduce((s,i)=>s+(+i.amount||0),0);
                          const _ir=investments.reduce((s,i)=>s+(+i.interestEarned||0),0);
                          let running=savT.total+_rr+_ir-_dd-_ii;
                          const withBal=sorted.map(e=>{running-=(+e.amount||0);return{...e,balAfter:running};});
                          // Display newest first
                          return [...withBal].reverse().map((e,i)=>(
                            <tr key={e.id} style={{borderBottom:"1px solid #eef5ff"}} onMouseOver={ev=>ev.currentTarget.style.background="#f0f7ff"} onMouseOut={ev=>ev.currentTarget.style.background=""}>
                              <td style={{padding:"8px 10px",fontSize:10,fontFamily:"var(--mono)",color:"var(--tmuted)"}}>{sorted.length-i}</td>
                              <td style={{padding:"8px 10px",fontSize:11,fontFamily:"var(--mono)",color:"var(--tm)",whiteSpace:"nowrap"}}>{fmtD(e.date)}</td>
                              <td style={{padding:"8px 10px"}}>
                                <div style={{fontWeight:700,fontSize:12,color:"var(--b800)"}}>{e.activity}</div>
                                {e.purpose&&<div style={{fontSize:10,color:"var(--tmuted)",marginTop:1}}>📌 {e.purpose}</div>}
                                <div style={{marginTop:2}}>
                                  {e.payMode==="cash"&&<span className="exp-mode mode-cash">💵 Cash</span>}
                                  {e.payMode==="bank"&&<span className="exp-mode mode-bank">🏦 {e.bankName||"Bank"}</span>}
                                  {e.payMode==="mtn"&&<span className="exp-mode mode-mtn">📱 MTN MoMo</span>}
                                  {e.payMode==="airtel"&&<span className="exp-mode mode-airtel">📱 Airtel</span>}
                                </div>
                              </td>
                              <td style={{padding:"8px 10px"}}>
                                <div style={{fontSize:12,fontWeight:600,color:"var(--td)"}}>{e.issuedBy||"—"}</div>
                                {e.issuedByPhone&&<div style={{fontSize:10,color:"var(--tmuted)",fontFamily:"var(--mono)"}}>{e.issuedByPhone}</div>}
                                <div style={{fontSize:10,color:"var(--tmuted)"}}>{e.approvedBy?"✓ "+e.approvedBy:""}</div>
                              </td>
                              <td style={{padding:"8px 10px"}}>
                                {e.category&&<span style={{fontSize:9,background:"var(--b100)",color:"var(--b700)",borderRadius:7,padding:"2px 7px",fontFamily:"var(--mono)"}}>{e.category}</span>}
                              </td>
                              <td style={{padding:"8px 10px",textAlign:"right",fontWeight:900,fontSize:13,fontFamily:"var(--mono)",color:"#c62828",whiteSpace:"nowrap"}}>− {fmt(+e.amount||0)}</td>
                              <td style={{padding:"8px 10px",textAlign:"right",whiteSpace:"nowrap"}}>
                                <div style={{fontWeight:700,fontSize:12,fontFamily:"var(--mono)",color:e.balAfter<0?"#c62828":"#2e7d32"}}>{fmt(e.balAfter)}</div>
                                {e.balAfter<0&&<div style={{fontSize:9,color:"#c62828"}}>⚠ Overdraft</div>}
                              </td>
                              <td style={{padding:"8px 10px",textAlign:"center"}}>
                                {/* Approval badge for large expenses */}
                                {(+e.amount||0)>=EXPENSE_APPROVAL_THRESHOLD&&(
                                  <div style={{marginBottom:4}}>
                                    {e.expApprovalStatus==="pending_approval"?(
                                      <span style={{fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:10,background:"#fff8e1",color:"#e65100",border:"1px solid #ffe082",display:"block",marginBottom:3}}>⏳ Awaiting Admin</span>
                                    ):e.expApprovalStatus==="rejected"?(
                                      <span style={{fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:10,background:"#ffebee",color:"#c62828",border:"1px solid #ffcdd2",display:"block",marginBottom:3}}>❌ Rejected</span>
                                    ):(
                                      <span style={{fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:10,background:"#e8f5e9",color:"#1b5e20",border:"1px solid #a5d6a7",display:"block",marginBottom:3}}>✅ Approved</span>
                                    )}
                                  </div>
                                )}
                                <div style={{display:"flex",gap:4,justifyContent:"center",flexWrap:"wrap"}}>
                                  <button className="btn bg xs" onClick={()=>openEditExp(e)}>✏️</button>
                                  <button className="btn bd xs" onClick={()=>delExp(e.id)}>🗑</button>
                                  {/* Admin approve/reject for large pending expenses */}
                                  {e.expApprovalStatus==="pending_approval"&&authUser?.role==="admin"&&(
                                    <React.Fragment>
                                      <button className="btn bk xs" style={{fontSize:9}} onClick={()=>approveExpense(e.id)}>✓ Approve</button>
                                      <button className="btn bd xs" style={{fontSize:9}} onClick={()=>{const r=window.prompt("Reason for rejection:");if(r)rejectExpense(e.id,r);}}>✗ Reject</button>
                                    </React.Fragment>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ));
                        })()}
                        <tr style={{background:"linear-gradient(to right,var(--b100),var(--b50))"}}>
                          <td colSpan={5} style={{padding:"10px",fontWeight:700,fontFamily:"var(--mono)",fontSize:10,color:"var(--b800)"}}>TOTAL EXPENSES</td>
                          <td style={{padding:"10px",textAlign:"right",fontWeight:900,fontSize:14,fontFamily:"var(--mono)",color:"#c62828"}}>− {fmt(totalExpenses)}</td>
                          <td style={{padding:"10px",textAlign:"right",fontWeight:900,fontSize:14,fontFamily:"var(--mono)",color:cashInBank<0?"#c62828":"#2e7d32"}}>{fmt(cashInBank)}</td>
                          <td/>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </React.Fragment>
          )}

          {/* ── INVESTMENTS TAB ──────────────────────────────────────────── */}
          {tab==="investments" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>Investment Portfolio — BIDA Projects Fund</div>

              {/* Liquidity + Purpose Banner */}
              <div style={{background:"linear-gradient(135deg,#0d3461,#1565c0)",borderRadius:13,padding:"13px 16px",marginBottom:12,color:"#fff"}}>
                <div style={{fontWeight:800,fontSize:13,marginBottom:5}}>🏗️ Purpose &amp; Liquidity Policy</div>
                <div style={{fontSize:11,lineHeight:1.7,opacity:.92}}>
                  Investment returns fund <strong>BIDA co-operative projects</strong> — infrastructure, member welfare initiatives, and community development.
                  <strong style={{color:"#90caf9"}}> Liquidity Rule:</strong> Cash in bank must retain <strong style={{color:"#ffd54f"}}>at least 80%</strong> at all times. <strong>Maximum investable = 20% of cash in bank after expenses.</strong>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:7,marginTop:10}}>
                  {(()=>{
                    const repayments=loans.reduce((s,l)=>s+(+l.amountPaid||0),0);
              const disbursed=loans.filter(l=>l.approvalStatus==="approved"||!l.approvalStatus).reduce((s,l)=>s+(+l.amountLoaned||0),0);
              const invMade=investments.reduce((s,i)=>s+(+i.amount||0),0);
              const invRet=investments.reduce((s,i)=>s+(+i.interestEarned||0),0);
              const cashInBk=savT.total+repayments+invRet-disbursed-totalExpenses-invMade;
                    const maxInv=Math.round(cashInBk*0.20);
                    const rem=Math.max(0,maxInv-totalInvested);
                    const ok=cashInBk-totalInvested>=cashInBk*0.80;
                    return [
                      ["Cash in Bank",fmt(cashInBk),"#90caf9"],
                      ["Max Investable (20% of cash)",fmt(maxInv),"#ffd54f"],
                      ["Currently Invested",fmt(totalInvested),totalInvested>maxInv?"#ef9a9a":"#a5d6a7"],
                      ["Remaining Headroom",fmt(rem),rem===0?"#ef9a9a":"#c8e6c9"],
                      ["Liquid Reserve (80%)",fmt(Math.round(cashInBk*0.80)),ok?"#a5d6a7":"#ef9a9a"],
                    ].map(([l,v,c])=>(
                      <div key={l} style={{background:"rgba(255,255,255,.1)",borderRadius:8,padding:"7px 10px"}}>
                        <div style={{fontSize:9,color:"rgba(255,255,255,.6)",textTransform:"uppercase",letterSpacing:.5,marginBottom:2}}>{l}</div>
                        <div style={{fontSize:13,fontWeight:900,color:c,fontFamily:"var(--mono)"}}>{v}</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Stats */}
              <div className="stats">
                <div className="card ck"><div className="clabel">Total Invested</div><div className="cval ok">{fmt(totalInvested)}</div><div className="csub">Active positions</div></div>
                <div className="card ck"><div className="clabel">Total Interest Earned</div><div className="cval ok">{fmt(totalInvInterest)}</div></div>
                <div className="card"><div className="clabel">Retained (60%)</div><div className="cval">{fmt(retainedInterest)}</div><div className="csub">BIDA projects</div></div>
                <div className="card ck"><div className="clabel">To Members (40%)</div><div className="cval ok">{fmt(distributableInterest)}</div><div className="csub">By savings share</div></div>
                <div className="card"><div className="clabel">Fund Pool</div><div className="cval">{fmt(savT.total)}</div></div>
                <div className="card"><div className="clabel">Positions</div><div className="cval">{investments.length}</div></div>
              </div>

              {/* FX + MM Rates */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontWeight:700,fontSize:12,color:"var(--b800)",marginBottom:8}}>🌍 FX Rates (UGX indicative)</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {fxLoading?<div style={{fontSize:10,color:"var(--tmuted)",padding:"8px 0"}}>⏳ Loading live rates…</div>:FX_RATES.map(({label,rate,color})=>(
                      <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid var(--bdr)"}}>
                        <span style={{fontSize:10,fontFamily:"var(--mono)",color:"var(--tmuted)"}}>{label}</span>
                        <span style={{fontSize:12,fontWeight:800,color,fontFamily:"var(--mono)"}}>{rate}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontWeight:700,fontSize:12,color:"var(--b800)",marginBottom:8}}>💹 Money Market Rates (p.a.)</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {[["T-Bills 91d","14.2%"],["T-Bills 182d","15.8%"],["T-Bills 364d","16.9%"],["Stanbic MMF","13.5%"],["UAP Old Mutual","14.0%"],["Britam","13.8%"],["DFCU Fixed","12.5%"]].map(([l,r])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid var(--bdr)"}}>
                        <span style={{fontSize:10,fontFamily:"var(--mono)",color:"var(--tmuted)"}}>{l}</span>
                        <span style={{fontSize:12,fontWeight:800,color:"#1b5e20",fontFamily:"var(--mono)"}}>{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {distributableInterest>0&&(
                <div style={{background:"linear-gradient(135deg,#1b5e20,#2e7d32)",borderRadius:12,padding:"12px 16px",marginBottom:14,color:"#fff"}}>
                  <div style={{fontWeight:800,fontSize:13,marginBottom:6}}>📊 Member Dividend Distribution (40% of Interest)</div>
                  <div style={{fontSize:11,opacity:.85,marginBottom:8}}>Each member's share based on their % of total pool. 60% ({fmt(retainedInterest)}) retained for BIDA projects.</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:6,maxHeight:180,overflowY:"auto"}}>
                    {[...members].sort((a,b)=>totBanked(b)-totBanked(a)).slice(0,10).map(m=>(
                      <div key={m.id} style={{background:"rgba(255,255,255,.15)",borderRadius:8,padding:"6px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:11,fontWeight:700}}>{m.name.split(" ")[0]}</span>
                        <span style={{fontSize:12,fontWeight:900,fontFamily:"var(--mono)"}}>{fmt(memberInvShare(m))}</span>
                      </div>
                    ))}
                  </div>
                  {members.length>10&&<div style={{fontSize:10,opacity:.7,marginTop:6}}>Showing top 10 — view each member's profile for their full share.</div>}
                </div>
              )}

              <div className="toolbar">
                <div className="tl"><span className="ttitle">Investment Records</span><span className="tcount">{investments.length}</span></div>
                <button className="btn bp sm" onClick={openAddInv}>＋ Add Investment</button>
              </div>

              {investments.length===0&&<div className="empty"><div className="eico">📈</div>No investments recorded yet. Add your first position above.</div>}

              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {investments.map(inv=>(
                  <InvestmentCard key={inv.id} inv={inv} openEditInv={openEditInv} delInv={delInv}/>
                ))}
              </div>
            </React.Fragment>
          )}

          {/* ── REPORTS TAB ──────────────────────────────────────────────── */}
          {tab==="reports" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>PDF Reports & Analysis</div>
              <LoanRuleInfo/>
              <div className="pdf-panel">
                <div style={{fontWeight:700,fontSize:13,color:"var(--b800)",marginBottom:10}}>📄 Choose a report to generate and download</div>
                <div className="pdf-cards">
                  {[
                    {key:"savings",icon:"💰",title:"Savings Report",desc:"Full member savings ledger with borrowing limits and totals."},
                    {key:"loans",icon:"📋",title:"Loans Report",desc:"Loan register with method, term, monthly pay, interest, and profit."},
                    {key:"expenses",icon:"🧾",title:"Expenses Report",desc:"All expenses with payment details, approvals, and net balance."},
                    {key:"projections",icon:"📈",title:"12-Month Projections",desc:"Month-by-month savings growth and interest income forecast."},
                  ].map(({key,icon,title,desc})=>(
                    <div key={key} className="pdf-card" onClick={()=>handlePDF(key)}>
                      <div className="pdf-card-icon">{icon}</div>
                      <div className="pdf-card-title">{title}</div>
                      <div className="pdf-card-desc">{desc}</div>
                      <div style={{marginTop:9}}>
                        <button className="btn bpdf sm" disabled={!!pdfGen}>{pdfGen===key?"⏳ Generating...":"📥 Download"}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="stats">
                <div className="card ck"><div className="clabel">Fund Pool</div><div className="cval ok">{fmt(savT.total)}</div></div>
                <div className="card"><div className="clabel">Monthly Inflow</div><div className="cval">{fmt(savT.monthly)}</div></div>
                <div className="card cd"><div className="clabel">Outstanding</div><div className="cval danger">{fmt(lStat.outstanding)}</div></div>
                <div className="card cd"><div className="clabel">Expenses</div><div className="cval danger">{fmt(totalExpenses)}</div></div>
                <div className="card" style={{borderTop:"3px solid "+(cashInBank<0?"#c62828":"#43a047")}}><div className="clabel">Cash in Bank</div><div className={"cval"+(cashInBank<0?" danger":" ok")}>{fmt(cashInBank)}</div></div>
              </div>

              {/* Financial Statements */}
              {(()=>{
                const pool=savT.total;
                const outstanding=lStat.outstanding;
                const profit=lStat.profit;
                const invTotal=investments.reduce((s,i)=>s+(+i.amount||0),0);
                const invReturns=investments.reduce((s,i)=>s+(+i.interestEarned||0),0);
                const grossIncome=profit+invReturns;
                const netIncome=grossIncome-totalExpenses;
                const totalAssets=cashInBank+outstanding+invTotal;
                const totalLiabilities=pool; // members' savings are liabilities
                const equity=totalAssets-totalLiabilities;
                return (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginBottom:12}}>
                    {/* Income Statement */}
                    <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px"}}>
                      <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10,borderBottom:"2px solid var(--bdr2)",paddingBottom:6}}>📊 Income Statement</div>
                      {[["Loan Interest Income",profit,"#2e7d32"],["Investment Returns",invReturns,"#2e7d32"],["Gross Income",grossIncome,"#1565c0"],["Less: Total Expenses",-totalExpenses,"#c62828"],["Net Surplus / Deficit",netIncome,netIncome>=0?"#2e7d32":"#c62828"]].map(([l,v,c],i)=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:i===3?"2px solid var(--bdr2)":"1px solid var(--bdr)",fontWeight:i>=2?700:400}}>
                          <span style={{fontSize:11,color:"var(--td)"}}>{l}</span>
                          <span style={{fontFamily:"var(--mono)",fontSize:11,color:c}}>{v<0?"("+fmt(Math.abs(v))+")":fmt(v)}</span>
                        </div>
                      ))}
                    </div>
                    {/* Balance Sheet */}
                    <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"14px 16px"}}>
                      <div style={{fontWeight:800,fontSize:13,color:"var(--b800)",marginBottom:10,borderBottom:"2px solid var(--bdr2)",paddingBottom:6}}>🏦 Balance Sheet</div>
                      <div style={{fontSize:10,fontWeight:700,color:"var(--b700)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>Assets</div>
                      {[["Cash in Bank",cashInBank],["Loan Book (Outstanding)",outstanding],["Investments",invTotal],["Total Assets",totalAssets]].map(([l,v],i)=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:i===2?"2px solid var(--bdr2)":"1px solid var(--bdr)",fontWeight:i===3?700:400}}>
                          <span style={{fontSize:11,color:"var(--td)"}}>{l}</span>
                          <span style={{fontFamily:"var(--mono)",fontSize:11,color:i===3?"#1565c0":"var(--td)"}}>{fmt(v)}</span>
                        </div>
                      ))}
                      <div style={{fontSize:10,fontWeight:700,color:"var(--b700)",margin:"8px 0 4px",textTransform:"uppercase",letterSpacing:.5}}>Liabilities &amp; Equity</div>
                      {[["Member Savings (Liabilities)",totalLiabilities],["Retained Surplus / Equity",equity],["Total L+E",totalAssets]].map(([l,v],i)=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:i===1?"2px solid var(--bdr2)":"1px solid var(--bdr)",fontWeight:i===2?700:400}}>
                          <span style={{fontSize:11,color:"var(--td)"}}>{l}</span>
                          <span style={{fontFamily:"var(--mono)",fontSize:11,color:i===2?"#1565c0":equity<0&&i===1?"#c62828":"var(--td)"}}>{fmt(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {sharedPDF&&sharedPDF.type!=="member"&&sharedPDF.blob&&(
                <div style={{background:"#e8f5e9",border:"1.5px solid #a5d6a7",borderRadius:11,padding:"14px 16px",marginTop:10}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#1b5e20",marginBottom:8}}>✅ {sharedPDF.label} is ready</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <button onClick={()=>{if(!sharedPDF.blob)return;const u=URL.createObjectURL(sharedPDF.blob);const a=document.createElement("a");a.href=u;a.download=sharedPDF.filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(u);try{document.body.removeChild(a);}catch(e){}},5000);}} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"8px 16px",borderRadius:8,background:"linear-gradient(135deg,#c62828,#b71c1c)",color:"#fff",fontWeight:700,fontSize:12,border:"none",cursor:"pointer"}}>📥 Download PDF</button>
                    <button onClick={()=>{if(!sharedPDF.blob)return;const u=URL.createObjectURL(sharedPDF.blob);window.open(u,"_blank");setTimeout(()=>URL.revokeObjectURL(u),10000);}} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"8px 16px",borderRadius:8,background:"#fff",border:"1.5px solid var(--bdr2)",color:"var(--b700)",fontWeight:700,fontSize:12,cursor:"pointer"}}>🔍 Open in New Tab</button>
                    <button style={{display:"inline-flex",alignItems:"center",gap:5,padding:"8px 14px",borderRadius:8,background:"#25D366",color:"#fff",border:"none",fontWeight:700,fontSize:12,cursor:"pointer"}} onClick={async()=>{
                      if(!sharedPDF.blob)return;
                      const file=new File([sharedPDF.blob],sharedPDF.filename,{type:"application/pdf"});
                      if(navigator.canShare&&navigator.canShare({files:[file]})){
                        try{await navigator.share({files:[file],title:"BIDA — "+sharedPDF.label,text:"BIDA Co-operative "+sharedPDF.label+" — "+toStr()});}
                        catch(e){if(e.name!=="AbortError"){const u=URL.createObjectURL(sharedPDF.blob);window.open(u,"_blank");setTimeout(()=>URL.revokeObjectURL(u),10000);}}
                      } else {
                        const u=URL.createObjectURL(sharedPDF.blob);
                        const a=document.createElement("a");a.href=u;a.download=sharedPDF.filename;
                        document.body.appendChild(a);a.click();
                        setTimeout(()=>{URL.revokeObjectURL(u);try{document.body.removeChild(a);}catch(e){}},5000);
                        setTimeout(()=>window.open("https://web.whatsapp.com","_blank"),800);
                      }
                    }}>{WA_SVG} Share via WhatsApp</button>
                  </div>
                  <div style={{fontSize:10,color:"#2e7d32",marginTop:8,opacity:.8}}>Tip: If "Download" doesn't work in your browser, use "Open in New Tab" then save from there (Ctrl+S or right-click → Save).</div>
                </div>
              )}
            </React.Fragment>
          )}
        {/* ── PDF READY MODAL ── */}
        {sharedPDF&&sharedPDF.show&&(
          <div style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(13,52,97,.95)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>{if(e.target===e.currentTarget)setSharedPDF(null);}}>
            <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:400,textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
              <div style={{fontSize:48,marginBottom:8}}>📄</div>
              <div style={{fontWeight:900,fontSize:18,color:"#0d3461",marginBottom:4}}>{sharedPDF.label}</div>
              <div style={{fontSize:12,color:"#888",marginBottom:24}}>BIDA Co-operative · {new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})}</div>

              {/* PRIMARY: Download button — tap to save file */}
              <button
                onClick={()=>{
                  if(!sharedPDF.blob) return;
                  const url=URL.createObjectURL(sharedPDF.blob);
                  const a=document.createElement("a");
                  a.href=url; a.download=sharedPDF.filename;
                  document.body.appendChild(a); a.click();
                  setTimeout(()=>{URL.revokeObjectURL(url);try{document.body.removeChild(a);}catch(e){}},5000);
                }}
                style={{width:"100%",padding:"16px",borderRadius:12,background:"linear-gradient(135deg,#1565c0,#0d3461)",color:"#fff",fontWeight:900,fontSize:16,border:"none",cursor:"pointer",marginBottom:10,letterSpacing:.5}}>
                📥 Download PDF
              </button>

              {/* SECONDARY: Native share sheet — iOS saves to Files, Android shows share menu */}
              <button
                onClick={async()=>{
                  if(!sharedPDF.blob) return;
                  const file=new File([sharedPDF.blob],sharedPDF.filename,{type:"application/pdf"});
                  if(navigator.canShare&&navigator.canShare({files:[file]})){
                    try{ await navigator.share({files:[file],title:"BIDA Co-operative",text:"Please find your BIDA statement attached."}); }
                    catch(e){ if(e.name!=="AbortError") console.warn(e); }
                  } else {
                    // Open PDF in new tab — user can then share from there
                    const url=URL.createObjectURL(sharedPDF.blob);
                    window.open(url,"_blank");
                    setTimeout(()=>URL.revokeObjectURL(url),15000);
                  }
                }}
                style={{width:"100%",padding:"14px",borderRadius:12,background:"#128C7E",color:"#fff",fontWeight:800,fontSize:14,border:"none",cursor:"pointer",marginBottom:10}}>
                📤 Share / Save to Files (iPhone & Android)
              </button>

              {/* WHATSAPP: Opens WA with pre-filled text — user attaches PDF from Downloads */}
              {sharedPDF.waNumber&&(
                <a
                  href={"https://wa.me/"+sharedPDF.waNumber+"?text="+encodeURIComponent("Dear Member, please find your BIDA Co-operative statement attached. Download it from the link or check your Downloads folder.\n\n— BIDA Co-operative Multi-Purpose Society\nbidacooperative@gmail.com")}
                  target="_blank" rel="noreferrer"
                  style={{display:"block",width:"100%",padding:"14px",borderRadius:12,background:"#25D366",color:"#fff",fontWeight:800,fontSize:14,textDecoration:"none",marginBottom:10,boxSizing:"border-box",textAlign:"center"}}>
                  {WA_SVG} Send on WhatsApp
                </a>
              )}

              <button onClick={()=>setSharedPDF(null)} style={{width:"100%",padding:"12px",borderRadius:12,background:"#f5f5f5",color:"#666",fontWeight:600,fontSize:13,border:"none",cursor:"pointer"}}>
                Close
              </button>
            </div>
          </div>
        )}
        </main>
      </div>

      {/* ── MEMBER PROFILE MODAL ─────────────────────────────────────────── */}
      {profMember&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&closeProfile()}>
          <div className="modal wide">
            <div className="mhdr">
              <div style={{display:"flex",alignItems:"center",gap:9}}><Avatar name={profMember.name} size={34}/><div className="mtitle">{profMember.name}</div></div>
              <div style={{display:"flex",gap:7}}>
                {!profEdit&&<button className="btn bstmt sm" disabled={!!pdfGen} onClick={()=>handleMemberPDF(profMember)}>{pdfGen===("member_"+profMember.id)?"⏳...":"📄 Statement"}</button>}
                {!profEdit&&sharedPDF&&sharedPDF.type==="member"&&sharedPDF.memberId===profMember.id&&sharedPDF.blob&&(
                  <React.Fragment>
                    <button onClick={()=>{if(!sharedPDF.blob)return;const u=URL.createObjectURL(sharedPDF.blob);const a=document.createElement("a");a.href=u;a.download=sharedPDF.filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(u);try{document.body.removeChild(a);}catch(e){}},5000);}} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:7,background:"linear-gradient(135deg,#c62828,#b71c1c)",color:"#fff",fontWeight:700,fontSize:10,border:"none",cursor:"pointer"}}>📥 PDF</button>
                    <button onClick={()=>{if(!sharedPDF.blob)return;const u=URL.createObjectURL(sharedPDF.blob);window.open(u,"_blank");setTimeout(()=>URL.revokeObjectURL(u),10000);}} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:7,background:"#fff",border:"1.5px solid var(--bdr2)",color:"var(--b700)",fontWeight:700,fontSize:10,cursor:"pointer"}}>🔍</button>
                    <button className="btn sm" style={{background:"#25D366",color:"#fff",fontWeight:700}} onClick={()=>shareViaPDF(sharedPDF.blob,sharedPDF.filename,profMember.name)}>{WA_SVG} WA</button>
                  </React.Fragment>
                )}
                {!profEdit&&<button className="btn bg sm" onClick={()=>setProfEdit(true)}>✏️ Edit</button>}
                <button className="mclose" onClick={closeProfile}>✕</button>
              </div>
            </div>
            {!profEdit?(
              <React.Fragment>
                <div className="prof-hero">
                  <div style={{position:"relative",flexShrink:0}}>
                    <Avatar name={profMember.name} size={64} photoUrl={profMember.photoUrl}/>
                    <label title="Change photo" style={{position:"absolute",bottom:0,right:0,background:"rgba(0,0,0,.6)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11}}>
                      📷
                      <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=r=>setMembers(prev=>prev.map(m=>m.id===profId?{...m,photoUrl:r.target.result}:m));reader.readAsDataURL(file);}}/>
                    </label>
                  </div>
                  <div className="prof-info">
                    <div className="prof-name">{profMember.name}</div>
                    <div className="prof-meta">Since {profMember.joinDate?new Date(profMember.joinDate).toLocaleDateString("en-GB",{month:"long",year:"numeric"}):"—"} · ID #{profMember.id}</div>
                    {profMember.phone&&<div style={{fontSize:11,color:"var(--b300)",marginTop:2,fontFamily:"var(--mono)"}}>📞 {profMember.phone}</div>}
                    <div className="prof-email-disp">{profMember.email||<span style={{opacity:.5}}>No email on file</span>}</div>
                    {profMember.nin&&<div style={{fontSize:10,color:"rgba(255,255,255,.55)",marginTop:2,fontFamily:"var(--mono)"}}>NIN: {profMember.nin}</div>}
                    {profMember.address&&<div style={{fontSize:10,color:"rgba(255,255,255,.55)",marginTop:2}}>📍 {profMember.address}</div>}
                    {profMember.whatsapp
                      ?<div style={{marginTop:4}}><a href={waLink(profMember.whatsapp)} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,background:"rgba(37,211,102,.18)",border:"1px solid rgba(37,211,102,.35)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,color:"#25D366",textDecoration:"none",fontFamily:"var(--mono)"}}>{WA_SVG}{profMember.whatsapp}</a></div>
                      :<div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:3,fontFamily:"var(--mono)"}}>No WhatsApp on file</div>
                    }
                    <div className="prof-rank-badge">🏅 Rank #{profRank} of {members.length}</div>
                    {(()=>{
                      const spRoles=serviceProviders.filter(sp=>sp.isMember&&sp.memberId===profMember.id&&spIsActive(sp));
                      if(spRoles.length===0)return null;
                      return <div style={{marginTop:4,display:"flex",gap:4,flexWrap:"wrap"}}>
                        {spRoles.map((sp,i)=>(
                          <div key={i} style={{background:"rgba(255,193,7,.2)",border:"1px solid rgba(255,193,7,.5)",borderRadius:20,padding:"2px 9px",fontSize:10,fontWeight:700,color:"#ffd54f"}}>
                            🏪 Provider: {sp.serviceType}
                          </div>
                        ))}
                      </div>;
                    })()}
                    {/* Approval status badge on profile */}
                    {profMember.approvalStatus&&profMember.approvalStatus!=="approved"&&(()=>{
                      const st=APPROVAL_STATUS[profMember.approvalStatus];
                      return st?<div style={{marginTop:3,display:"inline-block",fontSize:9,padding:"2px 8px",borderRadius:20,background:st.bg,color:st.color,fontWeight:700}}>{st.label}</div>:null;
                    })()}
                    {profMember.referredByMemberId&&(()=>{
                      const referrer=members.find(m=>m.id===profMember.referredByMemberId);
                      return referrer?<div style={{marginTop:3,fontSize:10,color:"rgba(255,255,255,.6)"}}>Referred by: <strong style={{color:"#90caf9"}}>{referrer.name}</strong></div>:null;
                    })()}
                    {(()=>{
                      const referred=members.filter(m=>m.referredByMemberId===profMember.id);
                      if(referred.length>0) return <div style={{marginTop:4,background:"rgba(255,215,0,.2)",border:"1px solid rgba(255,215,0,.4)",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,color:"#ffd54f",display:"inline-block"}}>🎁 {referred.length} referral{referred.length>1?"s":""} · Commission: {fmt(profMember.referralCommission||0)}</div>;
                      return null;
                    })()}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.6)",marginBottom:2}}>TOTAL BANKED</div>
                    <div style={{fontSize:19,fontWeight:900,color:"#fff"}}>{fmt(totBanked(profMember))}</div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.6)",marginTop:4}}>{profPct}% of pool</div>
                    <div style={{marginTop:8,borderTop:"1px solid rgba(255,255,255,.15)",paddingTop:7}}>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.5)",marginBottom:2,letterSpacing:.5,textTransform:"uppercase"}}>{totBanked(profMember)<1000000?"×1.5 limit":"×2 limit"}</div>
                      <div style={{fontSize:15,fontWeight:900,color:"#90caf9"}}>{fmt(borrowLimit(profMember,loans))}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.4)",marginTop:1}}>max borrow</div>
                    </div>
                  </div>
                </div>
                {/* Initial payment status */}
                {profMember.approvalStatus&&profMember.approvalStatus!=="approved"&&(
                  <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:10,padding:"10px 14px",marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:12,color:"#e65100",marginBottom:4}}>⏳ Member Registration Pending Approval</div>
                    <div style={{fontSize:11,color:"#795548",lineHeight:1.6}}>
                      This member is awaiting approval through the 4-step process before being fully activated.
                      {profMember.initialPaymentReceived&&" ✅ Initial payments confirmed received."}
                      {!profMember.initialPaymentReceived&&" ⚠ Initial payment collection not yet confirmed."}
                    </div>
                    {(profMember.approvalTrail||[]).length>0&&(
                      <div style={{marginTop:8}}>
                        {(profMember.approvalTrail||[]).map((t,i)=>(
                          <div key={i} style={{fontSize:10,color:"var(--tmuted)",marginTop:3}}>
                            {t.decision==="approved"?"✓":"✗"} Step {t.step}: {t.name} — {t.date} {t.time}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="prof-section">
                  <div className="prof-section-title">Savings Breakdown</div>
                  <div className="prof-grid">
                    {[["Membership",profMember.membership],["Annual Sub",profMember.annualSub],["Monthly Savings",profMember.monthlySavings],["Welfare",profMember.welfare],["Shares",profMember.shares],["Total Banked",totBanked(profMember)]].map(([lb,v],i)=>(
                      <div key={lb} className="prof-item" style={i===5?{gridColumn:"1/-1",background:"var(--b100)",borderColor:"var(--bdr2)"}:{}}>
                        <div className="prof-item-label">{lb}</div>
                        <div className={"prof-item-val"+(i===5?" ok":"")}>{fmt(v)}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* ── NEXT OF KIN SECTION ── */}
                {(()=>{
                  const nok=profMember.nextOfKin||null;
                  return (
                    <div className="prof-section">
                      <div className="prof-section-title">👨‍👩‍👧 Next of Kin & Benevolent Fund</div>
                      {nok&&(nok.name||"").trim()?(
                        <React.Fragment>
                          <div style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                            <div style={{fontWeight:700,fontSize:11,color:"#1b5e20",marginBottom:6}}>✅ Benevolent Fund Active</div>
                            <div className="prof-grid">
                              {[["Name",nok.name],["Phone",nok.phone||"—"],["Relationship",nok.relationship||"—"],["NIN",nok.nin||"—"],["Address",nok.address||"—"],["BIDA Member",nok.isMember?"Yes":"No"]].map(([lb,v])=>(
                                <div key={lb} className="prof-item">
                                  <div className="prof-item-label">{lb}</div>
                                  <div className="prof-item-val">{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{marginTop:8,fontSize:10,color:"#2e7d32",lineHeight:1.6}}>
                              Min guaranteed payout: <strong>{fmt(Math.round(totBanked(profMember)*0.70))}</strong> (70% of {fmt(totBanked(profMember))})
                            </div>
                          </div>
                        </React.Fragment>
                      ):(
                        <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:9,padding:"10px 12px"}}>
                          <div style={{fontWeight:700,fontSize:11,color:"#e65100",marginBottom:4}}>⚠ No Next of Kin on File</div>
                          <div style={{fontSize:11,color:"#795548",lineHeight:1.6,marginBottom:8}}>This member cannot benefit from the BIDA Benevolent Fund until next of kin details are added.</div>
                          <button className="btn bp xs" onClick={()=>setProfEdit(true)}>✏️ Add NOK Details</button>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* ── REFERRAL SECTION ── */}
                {(()=>{
                  const referred=members.filter(m=>m.referredByMemberId===profMember.id);
                  const pending=(profMember.pendingCommissions||[]).filter(c=>!c.paid);
                  const paid=(profMember.pendingCommissions||[]).filter(c=>c.paid);
                  const today=new Date();
                  const nowPayable=pending.filter(c=>new Date(c.payableDate)<=today);
                  const notYet=pending.filter(c=>new Date(c.payableDate)>today);
                  const totalEarned=profMember.referralCommission||0;
                  const totalPaid=paid.reduce((s,c)=>s+c.amount,0);
                  const totalOwed=pending.reduce((s,c)=>s+c.amount,0);
                  if(referred.length===0&&totalEarned===0) return null;
                  return (
                    <div className="prof-section">
                      <div className="prof-section-title">🎁 Referral Programme</div>
                      {/* Summary cards */}
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
                        <div className="prof-item" style={{background:"#e8f5e9",borderColor:"#a5d6a7"}}>
                          <div className="prof-item-label">Members Referred</div>
                          <div className="prof-item-val ok" style={{fontSize:18}}>{referred.length}</div>
                        </div>
                        <div className="prof-item" style={{background:"#fff8e1",borderColor:"#ffe082"}}>
                          <div className="prof-item-label">Total Commission Earned</div>
                          <div className="prof-item-val" style={{color:"#f57f17"}}>{fmt(totalEarned)}</div>
                        </div>
                        <div className="prof-item" style={{background:totalOwed>0?"#fff3e0":"#f1f8e9",borderColor:totalOwed>0?"#ffcc80":"#c5e1a5"}}>
                          <div className="prof-item-label">Pending Payout</div>
                          <div className="prof-item-val" style={{color:totalOwed>0?"#e65100":"#2e7d32"}}>{fmt(totalOwed)}</div>
                        </div>
                      </div>
                      {/* Members referred list */}
                      {referred.length>0&&(
                        <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                          <div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:.7,marginBottom:8}}>Members Introduced to BIDA</div>
                          {referred.map(m=>{
                            const comm=(profMember.pendingCommissions||[]).find(c=>c.newMemberId===m.id);
                            const isPayable=comm&&new Date(comm.payableDate)<=today;
                            return (
                              <div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--bdr)",flexWrap:"wrap",gap:6}}>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <Avatar name={m.name} size={28} photoUrl={m.photoUrl}/>
                                  <div>
                                    <div style={{fontWeight:700,fontSize:12,color:"var(--b800)"}}>{m.name}</div>
                                    <div style={{fontSize:10,color:"var(--tmuted)"}}>Joined {m.joinDate?new Date(m.joinDate).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}</div>
                                  </div>
                                </div>
                                <div style={{textAlign:"right"}}>
                                  {comm&&<div style={{fontWeight:700,fontSize:11,color:isPayable?"#2e7d32":"#e65100",fontFamily:"var(--mono)"}}>{fmt(comm.amount)}</div>}
                                  {comm&&<div style={{fontSize:9,color:"var(--tmuted)"}}>
                                    {comm.paid?"✓ Paid":isPayable?"✅ Payable now":"⏳ Payable "+new Date(comm.payableDate).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
                                  </div>}
                                </div>
                                {comm&&!comm.paid&&isPayable&&(
                                  <button className="btn bk xs" onClick={()=>setMembers(prev=>{
                                              const upd=prev.map(mb=>mb.id===profMember.id?{...mb,pendingCommissions:(mb.pendingCommissions||[]).map(c=>c.newMemberId===m.id?{...c,paid:true}:c)}:mb);
                                              const changed=upd.find(mb=>mb.id===profMember.id);
                                              if(changed){
                                                const commSnap=prev.find(mb=>mb.id===profMember.id);
                                                saveRecord("members",changed,setSyncStatus,(errMsg)=>{
                                                  setMembers(prev=>prev.map(mb=>mb.id===profMember.id?commSnap:mb));
                                                  alert("⚠️ Commission mark-paid NOT saved.\n\nError: "+errMsg+"\n\nReverted.");
                                                });
                                              }
                                              return upd;
                                            })}>Mark Paid</button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Commission breakdown */}
                      {(profMember.pendingCommissions||[]).length>0&&(
                        <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:9,padding:"8px 12px",fontSize:10,color:"#5d4037",lineHeight:1.7}}>
                          <strong>💡 How commission is calculated:</strong> 1% of your (Monthly Savings + Welfare) at the time each new member joins. Commission is payable 1 month after the new member's join date.
                          {nowPayable.length>0&&<div style={{marginTop:4,fontWeight:700,color:"#e65100"}}>⚠ {nowPayable.length} commission{nowPayable.length>1?"s":""} ({fmt(nowPayable.reduce((s,c)=>s+c.amount,0))}) are now due for payment.</div>}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── MONTHLY SAVINGS ENCOURAGEMENT ── */}
                {(()=>{
                  const ms=profMember.monthlySavings||0;
                  const annSub=profMember.annualSub||0;
                  const welfare=profMember.welfare||0;
                  const expectedWelfare=Math.round(ms*0.30);
                  const welfareDiff=expectedWelfare-welfare;
                  const isLowSaver=ms<10000;
                  const isGoodSaver=ms>=50000;
                  const isExcellentSaver=ms>=30000;
                  const statusColor=isLowSaver?"#c62828":isGoodSaver?"#1b5e20":"#e65100";
                  const statusBg=isLowSaver?"#ffebee":isGoodSaver?"#e8f5e9":"#fff8e1";
                  const statusBdr=isLowSaver?"#ffcdd2":isGoodSaver?"#a5d6a7":"#ffe082";
                  const statusMsg=isLowSaver
                    ? "⚠️ Below minimum — monthly savings are under UGX 10,000. Please contribute at least UGX 10,000/month to remain in good standing."
                    : isGoodSaver
                    ? "✅ Excellent! Consistent monthly savings above UGX 50,000 qualifies you for higher loan limits and referral commissions."
                    : isExcellentSaver
                    ? "👍 Good standing. Consider increasing to UGX 50,000/month to unlock maximum benefits."
                    : "📌 Active contributor. Increasing monthly savings improves your borrowing capacity and fund pool share.";
                  const borrowBase=ms+welfare;
                  const borrowRate=Math.round((borrowLimit(profMember,loans)/Math.max(borrowBase,1))*100);
                  return (
                    <div className="prof-section">
                      <div className="prof-section-title">💰 Monthly Savings Status</div>
                      <div style={{background:statusBg,border:"1.5px solid "+statusBdr,borderRadius:10,padding:"10px 14px",marginBottom:8}}>
                        <div style={{fontWeight:700,fontSize:12,color:statusColor,marginBottom:4}}>
                          {isLowSaver?"🔴 Needs Attention":isGoodSaver?"🟢 Excellent Saver":isExcellentSaver?"🟡 Good Standing":"🟡 Active"}
                        </div>
                        <div style={{fontSize:11,color:statusColor,lineHeight:1.6}}>{statusMsg}</div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                        {[
                          ["Monthly Savings",fmt(ms),isLowSaver?"danger":"ok"],
                          ["Annual Subscription",fmt(annSub),annSub>=50000?"ok":"warn"],
                          ["Welfare (should be 30%)",fmt(welfare),welfareDiff>0?"warn":"ok"],
                          ["Expected Welfare (30%)",fmt(expectedWelfare),""],
                          ["Borrow Limit",fmt(borrowLimit(profMember,loans)),"ok"],
                          ["Savings × Borrow Rate",borrowRate+"%",""],
                        ].map(([lb,v,cls])=>(
                          <div key={lb} style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:8,padding:"7px 10px"}}>
                            <div style={{fontSize:9,color:"var(--tmuted)",fontFamily:"var(--mono)",textTransform:"uppercase",marginBottom:2}}>{lb}</div>
                            <div style={{fontWeight:700,fontSize:12,color:cls==="ok"?"#2e7d32":cls==="danger"?"#c62828":cls==="warn"?"#e65100":"var(--b700)"}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {annSub<50000&&<div style={{background:"#fff3e0",border:"1px solid #ffcc80",borderRadius:8,padding:"7px 10px",fontSize:10,color:"#e65100",marginBottom:6}}>⚠ Annual subscription is below UGX 50,000 — member will not qualify for referral commissions until this is met.</div>}
                      {welfareDiff>0&&<div style={{background:"#e3f2fd",border:"1px solid #90caf9",borderRadius:8,padding:"7px 10px",fontSize:10,color:"#1565c0"}}>💡 Welfare should be 30% of monthly savings. Suggested welfare top-up: {fmt(welfareDiff)} (30% of UGX {fmt(ms)} = {fmt(expectedWelfare)})</div>}
                    </div>
                  );
                })()}

                {/* Risk indicators */}
                {(()=>{
                  const risk=riskIndicators(profMember,loans);
                  if(risk.flags.length===0) return null;
                  return <div style={{background:risk.risk==="high"?"#ffebee":"#fff8e1",border:"1.5px solid "+(risk.risk==="high"?"#ef9a9a":"#ffe082"),borderRadius:10,padding:"10px 14px",marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:11,color:risk.risk==="high"?"#c62828":"#e65100",marginBottom:5}}>
                      {risk.risk==="high"?"🔴 High Risk Profile":"🟡 Medium Risk Profile"}
                    </div>
                    {risk.flags.map((f,i)=><div key={i} style={{fontSize:10,color:"#555",marginTop:2}}>• {f.msg}</div>)}
                  </div>;
                })()}
                <div className="prof-section">
                  <div className="prof-section-title">Pool Contribution vs Peers</div>
                  <div className="prof-bar-wrap">
                    <div className="prof-bar-label"><span>Share of fund pool</span><span style={{fontWeight:700,color:"var(--b700)"}}>{profPct}%</span></div>
                    <div className="prof-bar-track"><div className="prof-bar-fill" style={{width:Math.min(parseFloat(profPct)*4,100)+"%"}}/></div>
                  </div>
                  <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                    {[["Pool Total",fmt(savT.total)],["Avg/Member",fmt(Math.round(savT.total/members.length))],["Rank","#"+profRank+"/"+members.length],["vs Avg",(totBanked(profMember)>=Math.round(savT.total/members.length)?"+":"")+fmt(totBanked(profMember)-Math.round(savT.total/members.length))],["Max Borrow",fmt(borrowLimit(profMember,loans))]].map(([lb,v])=>(
                      <div key={lb} className="prof-item" style={{flex:1,minWidth:80}}>
                        <div className="prof-item-label">{lb}</div>
                        <div className="prof-item-val" style={{fontSize:12}}>{v}</div>
                      </div>
                    ))}
                    {memberInvShare(profMember)>0&&(
                      <div className="prof-item" style={{flex:1,minWidth:80,background:"#e8f5e9",borderColor:"#a5d6a7"}}>
                        <div className="prof-item-label">Inv. Interest Share</div>
                        <div className="prof-item-val ok" style={{fontSize:12}}>{fmt(memberInvShare(profMember))}</div>
                        <div style={{fontSize:9,color:"#2e7d32",marginTop:2}}>40% of returns</div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Contribution Log */}
                {(()=>{
                  const memberContribs=contribLog.filter(c=>c.memberId===profMember.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
                  const CONTRIB_LABELS={monthlySavings:"Monthly Savings",welfare:"Welfare",annualSub:"Annual Sub",membership:"Membership",shares:"Shares",voluntaryDeposit:"Voluntary Deposit"};
                  return (
                    <div className="prof-section">
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div className="prof-section-title" style={{marginBottom:0}}>📒 Contribution History ({memberContribs.length})</div>
                        <button className="btn bp xs" onClick={()=>{setContribF(f=>({...f,memberId:profMember.id}));setContribModal(true);}}>+ Record</button>
                      </div>
                      {memberContribs.length===0?(
                        <div style={{fontSize:11,color:"var(--tmuted)",padding:"8px 0"}}>No contributions logged yet. Use + Record to log monthly payments.</div>
                      ):(
                        <div style={{maxHeight:220,overflowY:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                            <thead><tr style={{background:"var(--b50)"}}>
                              {["Date","Category","Amount","Note",""].map(h=>(
                                <th key={h} style={{padding:"5px 7px",textAlign:h==="Amount"?"right":"left",fontSize:9,fontFamily:"var(--mono)",fontWeight:600,color:"var(--b700)",borderBottom:"1.5px solid var(--bdr)"}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {memberContribs.map(c=>(
                                <tr key={c.id} style={{borderBottom:"1px solid #eef5ff"}}>
                                  <td style={{padding:"5px 7px",fontFamily:"var(--mono)",fontSize:10,whiteSpace:"nowrap"}}>{fmtD(c.date)}</td>
                                  <td style={{padding:"5px 7px"}}><span style={{fontSize:9,background:"var(--b100)",color:"var(--b700)",borderRadius:6,padding:"1px 6px",fontWeight:600}}>{CONTRIB_LABELS[c.category]||c.category}</span></td>
                                  <td style={{padding:"5px 7px",textAlign:"right",fontFamily:"var(--mono)",fontWeight:700,color:"#1b5e20"}}>{fmt(c.amount)}</td>
                                  <td style={{padding:"5px 7px",fontSize:10,color:"var(--tmuted)"}}>{c.note||"—"}</td>
                                  <td style={{padding:"5px 7px"}}><button className="btn bd xs" style={{padding:"2px 6px",fontSize:9}} onClick={()=>delContrib(c.id)}>🗑</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Share Certificate */}
                {(profMember.shares||0)>0&&(
                  <div className="prof-section">
                    <div className="prof-section-title">📜 Share Certificate</div>
                    <div style={{background:"linear-gradient(135deg,#0d3461,#1565c0)",borderRadius:10,padding:"12px 14px",color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontSize:10,opacity:.7,textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}>Share Holding</div>
                        <div style={{fontSize:18,fontWeight:900,fontFamily:"var(--mono)"}}>{shareUnits(profMember)} unit{shareUnits(profMember)!==1?"s":""}</div>
                        <div style={{fontSize:11,opacity:.8,marginTop:2}}>= {fmt(profMember.shares)} share capital</div>
                      </div>
                      <button
                        className="btn sm"
                        style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",fontWeight:700}}
                        disabled={!!pdfGen}
                        onClick={async()=>{
                          setPdfGen("cert_"+profMember.id);
                          try{
                            const blob=await generateShareCertificate(profMember,shareUnits(profMember),profMember.shares);
                            const fname="BIDA_ShareCert_"+profMember.name.replace(/\s+/g,"_")+".pdf";
                            const url=URL.createObjectURL(blob);
                            const a=document.createElement("a");a.href=url;a.download=fname;
                            document.body.appendChild(a);a.click();
                            setTimeout(()=>{URL.revokeObjectURL(url);try{document.body.removeChild(a);}catch(e){}},5000);
                          }catch(e){alert("Certificate error: "+e.message);}
                          finally{setPdfGen(null);}
                        }}
                      >
                        {pdfGen===("cert_"+profMember.id)?"⏳...":"📜 Download Certificate"}
                      </button>
                    </div>
                  </div>
                )}

                {profLoans.length>0&&(
                  <div className="prof-section">
                    <div className="prof-section-title">Loan History ({profLoans.length})</div>
                    {profLoans.map(l=>(
                      <ProfLoanCard key={l.id} l={l} markPd={markPd} closeProfile={closeProfile} openEditL={openEditL}/>
                    ))}
                  </div>
                )}
                {(profMember.email||profMember.whatsapp)&&(
                  <div className="prof-section">
                    <div className="prof-section-title">Quick Actions</div>
                    <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                      <div style={{fontSize:10,color:"var(--tmuted)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:.6,marginBottom:6}}>Savings Reminder</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {profMember.email&&<button className="btn bemail sm" disabled={emailSending["sav_"+profMember.id]==="sending"} onClick={()=>sendSavingsEmail(profMember)}>{emailSending["sav_"+profMember.id]==="sending"?"⏳...":"📨 Email"}</button>}
                        {profMember.whatsapp&&<React.Fragment>
                          <button className="btn bwa sm" disabled={!!pdfGen} onClick={async()=>{
                            setPdfGen("wa_"+profMember.id);
                            try{
                              const blob=await generateMemberPDF(profMember,profLoans,members,loans,true);
                              const fname="BIDA_Statement_"+profMember.name.replace(/\s+/g,"_")+".pdf";
                              const file=new File([blob],fname,{type:"application/pdf"});
                              if(navigator.canShare&&navigator.canShare({files:[file]})){
                                await navigator.share({files:[file],title:"BIDA — "+profMember.name,text:buildWAStatementMsg(profMember)});
                              } else {
                                // Download PDF first then open WA with message
                                const url=URL.createObjectURL(blob);
                                const a=document.createElement("a");a.href=url;a.download=fname;
                                document.body.appendChild(a);a.click();
                                setTimeout(()=>{URL.revokeObjectURL(url);try{document.body.removeChild(a);}catch(e){}},5000);
                                setTimeout(()=>window.open(waLink(profMember.whatsapp,"PDF downloaded! Please attach from your Downloads folder.\n\n"+buildWAStatementMsg(profMember)),"_blank"),800);
                              }
                            }catch(e){if(e.name!=="AbortError")alert("WA share error: "+e.message);}
                            finally{setPdfGen(null);}
                          }}>{pdfGen===("wa_"+profMember.id)?"⏳":WA_SVG} WA PDF</button>
                          <a className="btn bwa sm" href={waLink(profMember.whatsapp,buildWASavingsMsg(profMember))} target="_blank" rel="noreferrer">{WA_SVG}WA Text</a>
                        <button className="btn bwa sm" style={{background:"#128C7E"}} disabled={!!pdfGen} onClick={async()=>{
  try{
    const blob=await generateMemberPDF(profMember,profLoans,members,loans,true);
    const filename="BIDA_Statement_"+profMember.name.replace(/\s+/g,"_")+".pdf";
    const file=new File([blob],filename,{type:"application/pdf"});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:"BIDA — "+profMember.name});
    } else {
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=filename;
      a.style.cssText="position:fixed;top:-200px;opacity:0";
      document.body.appendChild(a);a.click();
      setTimeout(()=>{URL.revokeObjectURL(url);try{document.body.removeChild(a);}catch(e){}},8000);
    }
  }catch(e){if(e.name!=="AbortError")alert("PDF error: "+e.message);}
}}>{WA_SVG}WA PDF</button>
                        <button className="btn bsms sm" disabled={emailSending["sms_sav_"+profMember.id]==="sending"} onClick={()=>sendSavingsSMS(profMember)}>{emailSending["sms_sav_"+profMember.id]==="sending"?"⏳...":"📱 SMS"}</button></React.Fragment>}
                      </div>
                    </div>
                    {profLoans.filter(l=>l.status!=="paid").map(l=>(
                      <div key={l.id} style={{background:"#fff8e1",border:"1px solid #ffcc80",borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                        <div style={{fontSize:10,color:"#bf360c",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:.6,marginBottom:6}}>Loan Reminder · Balance {fmt(l.balance)}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {profMember.email&&<button className="btn bemail sm" disabled={emailSending["loan_"+l.id]==="sending"} onClick={()=>sendLoanEmail(profMember,l)}>{emailSending["loan_"+l.id]==="sending"?"⏳...":"📨 Email"}</button>}
                          {profMember.whatsapp&&<React.Fragment><a className="btn bwa sm" href={waLink(profMember.whatsapp,buildWALoanMsg(profMember,l))} target="_blank" rel="noreferrer">{WA_SVG}WA Loan</a>
                          <button className="btn bsms sm" disabled={emailSending["sms_loan_"+l.id]==="sending"} onClick={()=>sendLoanSMS(profMember,l)}>{emailSending["sms_loan_"+l.id]==="sending"?"⏳...":"📱"}</button></React.Fragment>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="div"/>
                {!confirmOpt
                  ?<button className="btn bd sm" onClick={()=>setConfirmOpt(true)}>🚪 Remove Member</button>
                  :<div style={{background:"#ffebee",border:"1.5px solid #ef9a9a",borderRadius:9,padding:"12px 13px"}}>
                    <div style={{fontWeight:700,color:"#c62828",marginBottom:6}}>⚠️ Confirm Member Removal</div>
                    <div style={{fontSize:11,color:"var(--tm)",marginBottom:8}}>Removes <strong>{profMember.name}</strong> and all their loan records permanently.</div>
                    <div style={{background:"#fff",border:"1px solid #ffcdd2",borderRadius:7,padding:"8px 10px",marginBottom:9,fontSize:11}}>
                      <div style={{fontWeight:700,color:"var(--b800)",marginBottom:4}}>💰 Refund Calculation</div>
                      <div className="crow"><span className="cl">Total savings banked</span><span className="cv ok">{fmt(totBanked(profMember))}</span></div>
                      {lStat.profit>0&&<div className="crow"><span className="cl">Share of profit earned ({profPct}%)</span><span className="cv ok">{fmt(Math.round((totBanked(profMember)/savT.total)*lStat.profit))}</span></div>}
                      {memberInvShare(profMember)>0&&<div className="crow"><span className="cl">Investment interest share (40% distributed)</span><span className="cv ok">{fmt(memberInvShare(profMember))}</span></div>}
                      <div className="crow" style={{borderTop:"1px solid #ffcdd2",paddingTop:4,marginTop:3}}>
                        <span className="cl" style={{fontWeight:700}}>Estimated refund due</span>
                        <span className="cv ok" style={{fontSize:14,fontWeight:900}}>{fmt(totBanked(profMember)+Math.round((totBanked(profMember)/Math.max(savT.total,1))*lStat.profit)+memberInvShare(profMember))}</span>
                      </div>
                      <div style={{fontSize:9,color:"var(--tmuted)",marginTop:4}}>Note: Final refund subject to committee approval and any outstanding loan balances.</div>
                    </div>
                    <div style={{display:"flex",gap:7}}><button className="btn bd sm" onClick={optOutMember}>Yes, Remove</button><button className="btn bg sm" onClick={()=>setConfirmOpt(false)}>Cancel</button></div>
                  </div>
                }
              </React.Fragment>
            ):(
              <React.Fragment>
                <div className="fgrid">
                  <div className="fg ff" style={{display:"flex",alignItems:"center",gap:14,padding:"10px 12px",background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:10}}>
                    <Avatar name={profF.name||profMember.name} size={52} photoUrl={profF.photoUrl}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,fontWeight:700,fontFamily:"var(--mono)",color:"var(--tmuted)",textTransform:"uppercase",letterSpacing:.7,marginBottom:6}}>Member Photo</div>
                      <label style={{display:"inline-flex",alignItems:"center",gap:6,background:"linear-gradient(135deg,var(--b600),var(--b700))",color:"#fff",borderRadius:8,padding:"7px 13px",fontSize:11,fontWeight:700,cursor:"pointer"}}>📷 Upload Photo<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=r=>setProfF(f=>({...f,photoUrl:r.target.result}));reader.readAsDataURL(file);}}/></label>
                      {profF.photoUrl&&<button style={{marginLeft:8,background:"none",border:"1px solid #ffcdd2",borderRadius:7,padding:"5px 10px",fontSize:10,color:"#c62828",cursor:"pointer"}} onClick={()=>setProfF(f=>({...f,photoUrl:""}))}>✕ Remove</button>}
                    </div>
                  </div>
                  <div className="fg ff"><label className="fl">Full Name</label><input className="fi" value={profF.name} onChange={e=>setProfF(f=>({...f,name:e.target.value}))}/></div>
                  <div className="fg"><label className="fl">Telephone</label><input className="fi" type="tel" value={profF.phone||""} onChange={e=>setProfF(f=>({...f,phone:e.target.value}))} placeholder="0772 000 000"/></div>
                  <div className="fg"><label className="fl">WhatsApp</label><input className="fi" type="tel" value={profF.whatsapp||""} onChange={e=>setProfF(f=>({...f,whatsapp:e.target.value}))} placeholder="0772 000 000"/></div>
                  <div className="fg ff"><label className="fl">Email</label><input className="fi" type="email" value={profF.email||""} onChange={e=>setProfF(f=>({...f,email:e.target.value}))} placeholder="member@example.com"/></div>
                  <div className="fg"><label className="fl">National ID Number (NIN)</label><input className="fi" value={profF.nin||""} onChange={e=>setProfF(f=>({...f,nin:e.target.value}))} placeholder="e.g. CM90001234ABCD"/></div>
                  <div className="fg"><label className="fl">Join Date</label><input className="fi" type="date" value={profF.joinDate||""} onChange={e=>setProfF(f=>({...f,joinDate:e.target.value}))}/></div>
                  <div className="fg ff"><label className="fl">Physical Address</label><input className="fi" value={profF.address||""} onChange={e=>setProfF(f=>({...f,address:e.target.value}))} placeholder="Village, Parish, District"/></div>
                  <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,paddingTop:8,borderTop:"1px solid var(--bdr)"}}>💰 Contributions</div></div>
                  {[["Membership Fee","membership"],["Annual Sub","annualSub"],["Monthly Savings","monthlySavings"],["Welfare","welfare"],["Shares","shares"]].map(([lb,k])=>(
                    <div className="fg" key={k}><label className="fl">{lb} (UGX)</label><input className="fi" type="number" value={profF[k]||0} onChange={e=>setProfF(f=>({...f,[k]:e.target.value}))}/></div>
                  ))}
                  <div className="fg"><label className="fl">Voluntary Deposit (UGX)</label><input className="fi" type="number" value={profF.voluntaryDeposit||0} onChange={e=>setProfF(f=>({...f,voluntaryDeposit:+e.target.value||0}))}/><span className="fhint">Extra savings deposited by member — added to total</span></div>
                  <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,paddingTop:8,borderTop:"1px solid var(--bdr)"}}>👨‍👩‍👧 Next of Kin</div></div>
                  <div className="fg ff"><div style={{background:"#e3f2fd",border:"1px solid #90caf9",borderRadius:8,padding:"7px 11px",fontSize:10,color:"#1565c0",lineHeight:1.6}}>Required for Benevolent Fund. BIDA must know who to contact and support in case of member's death or serious illness.</div></div>
                  <div className="fg"><label className="fl">NOK Full Name</label><input className="fi" value={(profF.nextOfKin||{}).name||""} onChange={e=>setProfF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),name:e.target.value}}))}/></div>
                  <div className="fg"><label className="fl">NOK Phone</label><input className="fi" type="tel" value={(profF.nextOfKin||{}).phone||""} onChange={e=>setProfF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),phone:e.target.value}}))}/></div>
                  <div className="fg"><label className="fl">Relationship</label><input className="fi" value={(profF.nextOfKin||{}).relationship||""} onChange={e=>setProfF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),relationship:e.target.value}}))} placeholder="e.g. Spouse, Child, Sibling"/></div>
                  <div className="fg"><label className="fl">NOK NIN</label><input className="fi" value={(profF.nextOfKin||{}).nin||""} onChange={e=>setProfF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),nin:e.target.value}}))}/></div>
                  <div className="fg ff"><label className="fl">NOK Address</label><input className="fi" value={(profF.nextOfKin||{}).address||""} onChange={e=>setProfF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),address:e.target.value}}))} placeholder="Village, Parish, District"/></div>
                  <div className="fg ff"><label className="fl">Is NOK a BIDA Member?</label>
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      {[["yes","Yes — BIDA Member"],["no","No — Non-Member"]].map(([v,lbl])=>(
                        <button key={v} type="button" onClick={()=>setProfF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),isMember:v==="yes"}}))} style={{flex:1,padding:"7px",borderRadius:8,border:((profF.nextOfKin||{}).isMember===true&&v==="yes")||((profF.nextOfKin||{}).isMember===false&&v==="no")?"2px solid var(--b600)":"2px solid var(--bdr)",background:((profF.nextOfKin||{}).isMember===true&&v==="yes")||((profF.nextOfKin||{}).isMember===false&&v==="no")?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:700}}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="div"/>
                <div className="crow"><span className="cl">Total Banked</span><span className="cv ok">{fmt((+profF.membership||0)+(+profF.annualSub||0)+(+profF.monthlySavings||0)+(+profF.welfare||0)+(+profF.shares||0)+(+profF.voluntaryDeposit||0))}</span></div>
                <div className="fa"><button className="btn bg" onClick={()=>setProfEdit(false)}>Cancel</button><button className="btn bp" onClick={saveProfile}>Save</button></div>
              </React.Fragment>
            )}
          </div>
        </div>
      )}

      {/* ── ADD MEMBER MODAL ─────────────────────────────────────────────── */}
      {addMModal&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setAddMModal(false)}>
          <div className="modal wide">
            <div className="mhdr"><div className="mtitle">Add New Member</div><button className="mclose" onClick={()=>setAddMModal(false)}>✕</button></div>
            <div className="fgrid">
              <div className="fg ff" style={{display:"flex",alignItems:"center",gap:14,padding:"10px 12px",background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:10}}>
                <Avatar name={addMF.name||"New"} size={52} photoUrl={addMF.photoUrl||""}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,fontWeight:700,fontFamily:"var(--mono)",color:"var(--tmuted)",textTransform:"uppercase",letterSpacing:.7,marginBottom:6}}>Member Photo <span style={{fontWeight:400}}>(optional)</span></div>
                  <label style={{display:"inline-flex",alignItems:"center",gap:6,background:"linear-gradient(135deg,var(--b600),var(--b700))",color:"#fff",borderRadius:8,padding:"7px 13px",fontSize:11,fontWeight:700,cursor:"pointer"}}>📷 Upload<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=r=>setAddMF(f=>({...f,photoUrl:r.target.result}));reader.readAsDataURL(file);}}/></label>
                  {addMF.photoUrl&&<button style={{marginLeft:8,background:"none",border:"1px solid #ffcdd2",borderRadius:7,padding:"5px 10px",fontSize:10,color:"#c62828",cursor:"pointer"}} onClick={()=>setAddMF(f=>({...f,photoUrl:""}))}>✕</button>}
                </div>
              </div>
              {/* Personal details */}
              <div className="fg ff"><label className="fl">Full Name</label><input className="fi" value={addMF.name} onChange={e=>setAddMF(f=>({...f,name:e.target.value}))} placeholder="e.g. KATUNTU HANNAH"/></div>
              {/* How did they hear about BIDA */}
              {/* Initial Payment Section */}
              <div className="fg"><label className="fl">Voluntary Extra Deposit <span style={{fontSize:9,fontWeight:400,color:"var(--b500)"}}>— optional top-up savings</span></label>
                  <input className="fi" type="number" value={addMF.voluntaryDeposit||""} onChange={e=>setAddMF(f=>({...f,voluntaryDeposit:+e.target.value||0}))} placeholder="0 — member may deposit extra savings beyond regular contributions"/>
                </div>
                <div className="fg ff">
                <div style={{background:"#e8f5e9",border:"1.5px solid #a5d6a7",borderRadius:10,padding:"10px 14px",marginBottom:4}}>
                  <div style={{fontWeight:700,fontSize:12,color:"#1b5e20",marginBottom:6}}>💳 Initial Payments — Member pays INTO BIDA</div>
                  <div style={{fontSize:11,color:"#2e7d32",marginBottom:8,lineHeight:1.6}}>
                    The new member brings money <strong>to BIDA</strong>. Confirm the amounts below and tick when collected.
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    {[["Membership Fee",addMF.membership,50000],["Annual Subscription",addMF.annualSub,50000],["1st Month Savings",addMF.monthlySavings,10000]].map(([lb,v,min])=>(
                      <div key={lb} style={{background:"#fff",border:"1px solid #a5d6a7",borderRadius:8,padding:"7px 10px"}}>
                        <div style={{fontSize:9,color:"var(--tmuted)",textTransform:"uppercase",marginBottom:2}}>{lb}</div>
                        <div style={{fontWeight:800,fontSize:13,color:(+v||0)>=min?"#1b5e20":"#e65100",fontFamily:"var(--mono)"}}>{fmt(+v||0)}</div>
                        <div style={{fontSize:9,color:"var(--tmuted)"}}>Min: {fmt(min)}</div>
                      </div>
                    ))}
                    <div style={{background:"#fff",border:"1.5px solid #1565c0",borderRadius:8,padding:"7px 10px"}}>
                      <div style={{fontSize:9,color:"var(--tmuted)",textTransform:"uppercase",marginBottom:2}}>Total to Collect</div>
                      <div style={{fontWeight:900,fontSize:15,color:"#1565c0",fontFamily:"var(--mono)"}}>{fmt((+addMF.membership||0)+(+addMF.annualSub||0)+(+addMF.monthlySavings||0))}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(27,94,32,.1)",borderRadius:8,padding:"8px 12px"}}>
                    <input type="checkbox" id="initPaid" checked={!!addMF.initialPaymentReceived} onChange={e=>setAddMF(f=>({...f,initialPaymentReceived:e.target.checked}))} style={{width:16,height:16,cursor:"pointer"}}/>
                    <label htmlFor="initPaid" style={{fontSize:12,fontWeight:700,color:"#1b5e20",cursor:"pointer"}}>✅ Initial payments received and banked</label>
                  </div>
                  {!addMF.initialPaymentReceived&&<div style={{marginTop:6,fontSize:10,color:"#e65100"}}>⚠ Confirm receipt before submitting.</div>}
                </div>
              </div>

              {/* How did they hear about BIDA */}
              <div className="fg ff">
                <label className="fl">How did they hear about BIDA? <span style={{fontWeight:400,color:"var(--tmuted)"}}>(required)</span></label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
                  {[["member","👤 BIDA Member"],["community","🏘 Community"],["word_of_mouth","🗣 Word of Mouth"],["online","🌐 Online"],["other","📋 Other"]].map(([v,lbl])=>(
                    <button key={v} type="button" onClick={()=>setAddMF(f=>({...f,referralSource:v,referredById:v==="member"?f.referredById:""}))} style={{padding:"7px 12px",borderRadius:9,border:addMF.referralSource===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:addMF.referralSource===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:addMF.referralSource===v?700:400,color:addMF.referralSource===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
                  ))}
                </div>
                {addMF.referralSource==="member"&&(
                  <div style={{marginTop:8}}>
                    <label className="fl" style={{marginBottom:4,display:"block"}}>Which member referred them?</label>
                    <select className="fi" value={addMF.referredById||""} onChange={e=>setAddMF(f=>({...f,referredById:e.target.value}))}>
                      <option value="">— Select referring member —</option>
                      {members.map(m=><option key={m.id} value={m.id}>{m.name} — {fmt(totBanked(m))}</option>)}
                    </select>
                    {addMF.referredById&&(()=>{
                      const ref=members.find(m=>m.id===+addMF.referredById);
                      const newAnnSub=+addMF.annualSub||0;
                      const eligible=newAnnSub>=50000;
                      const commBase=ref?(ref.monthlySavings||0)+(ref.welfare||0):0;
                      const commission=eligible?Math.round(commBase*0.01):0;
                      const payDate=new Date(addMF.joinDate||new Date());payDate.setMonth(payDate.getMonth()+1);
                      return eligible
                        ? <div style={{marginTop:6,background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:7,padding:"6px 10px",fontSize:10,color:"#1b5e20",lineHeight:1.6}}>
                          🎉 <strong>{ref?.name}</strong> earns a referral commission of <strong>{fmt(commission)}</strong><br/>
                        Base: 1% of (monthly savings {fmt(ref?.monthlySavings||0)} + welfare {fmt(ref?.welfare||0)}) = {fmt(commBase)}<br/>
                        Payable after 1 month: <strong>{payDate.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})}</strong>
                        </div>
                        : <div style={{marginTop:6,background:"#fff3e0",border:"1px solid #ffcc80",borderRadius:7,padding:"6px 10px",fontSize:10,color:"#e65100",lineHeight:1.6}}>
                          ⚠ <strong>{ref?.name}</strong> will <strong>not</strong> receive a commission — new member must pay an annual subscription of at least UGX 50,000 (currently UGX {(+addMF.annualSub||0).toLocaleString()}).
                        </div>;
                    })()}
                  </div>
                )}
              </div>
              <div className="fg"><label className="fl">Telephone</label><input className="fi" type="tel" value={addMF.phone} onChange={e=>setAddMF(f=>({...f,phone:e.target.value}))} placeholder="0772 000 000"/></div>
              <div className="fg"><label className="fl">WhatsApp</label><input className="fi" type="tel" value={addMF.whatsapp} onChange={e=>setAddMF(f=>({...f,whatsapp:e.target.value}))} placeholder="0772 000 000"/><span className="fhint">07XX or 256XX</span></div>
              <div className="fg ff"><label className="fl">Email</label><input className="fi" type="email" value={addMF.email} onChange={e=>setAddMF(f=>({...f,email:e.target.value}))} placeholder="member@example.com"/></div>
              <div className="fg"><label className="fl">National ID Number (NIN)</label><input className="fi" value={addMF.nin} onChange={e=>setAddMF(f=>({...f,nin:e.target.value}))} placeholder="NIN e.g. CM90001234..."/></div>
              <div className="fg"><label className="fl">Join Date</label><input className="fi" type="date" value={addMF.joinDate} onChange={e=>setAddMF(f=>({...f,joinDate:e.target.value}))}/></div>
              <div className="fg ff"><label className="fl">Physical Address</label><input className="fi" value={addMF.address} onChange={e=>setAddMF(f=>({...f,address:e.target.value}))} placeholder="Village, Parish, District"/></div>

              {/* Next of Kin */}
              <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,margin:"4px 0 2px",borderTop:"1px solid var(--bdr)",paddingTop:10}}>👨‍👩‍👧 Next of Kin <span style={{fontWeight:400,color:"var(--tmuted)"}}>(required for Benevolent Fund)</span></div></div>
              <div className="fg ff"><div style={{background:"#fff3e0",border:"1px solid #ffcc80",borderRadius:8,padding:"7px 11px",fontSize:10,color:"#e65100",lineHeight:1.6}}>BIDA requires next-of-kin details to activate the Benevolent Fund for this member in case of death or serious illness.</div></div>
              <div className="fg"><label className="fl">NOK Full Name</label><input className="fi" value={(addMF.nextOfKin||{}).name||""} onChange={e=>setAddMF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),name:e.target.value}}))}/></div>
              <div className="fg"><label className="fl">NOK Phone</label><input className="fi" type="tel" value={(addMF.nextOfKin||{}).phone||""} onChange={e=>setAddMF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),phone:e.target.value}}))}/></div>
              <div className="fg"><label className="fl">Relationship to Member</label><input className="fi" value={(addMF.nextOfKin||{}).relationship||""} onChange={e=>setAddMF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),relationship:e.target.value}}))} placeholder="e.g. Spouse, Child, Parent, Sibling"/></div>
              <div className="fg"><label className="fl">NOK NIN</label><input className="fi" value={(addMF.nextOfKin||{}).nin||""} onChange={e=>setAddMF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),nin:e.target.value}}))}/></div>
              <div className="fg ff"><label className="fl">NOK Physical Address</label><input className="fi" value={(addMF.nextOfKin||{}).address||""} onChange={e=>setAddMF(f=>({...f,nextOfKin:{...(f.nextOfKin||{}),address:e.target.value}}))} placeholder="Village, Parish, District"/></div>

              {/* Contributions */}
              <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,margin:"4px 0 2px",borderTop:"1px solid var(--bdr)",paddingTop:10}}>💰 Initial Contributions</div></div>
              <div className="fg ff"><div style={{background:"#e3f2fd",border:"1px solid #90caf9",borderRadius:8,padding:"8px 11px",fontSize:10,color:"#1565c0",lineHeight:1.6}}><strong>📌 Contribution Rules:</strong> Monthly savings minimum: UGX <strong>10,000</strong>. Members may contribute <strong>70,000 or more</strong> per month — no upper cap. <strong>40% of monthly savings is auto-allocated to welfare pool.</strong></div></div>
              {[["Membership Fee","membership"],["Annual Sub","annualSub"]].map(([lb,k])=>(
                <div className="fg" key={k}><label className="fl">{lb} (UGX)</label><input className="fi" type="number" value={addMF[k]} onChange={e=>setAddMF(f=>({...f,[k]:e.target.value}))} placeholder="0"/></div>
              ))}
              <div className="fg"><label className="fl">Monthly Savings (UGX) <span style={{fontWeight:400,color:"var(--tmuted)"}}>(min 10,000)</span></label><input className="fi" type="number" value={addMF.monthlySavings} onChange={e=>{const v=Math.max(0,+e.target.value||0);setAddMF(f=>({...f,monthlySavings:v,welfare:autoWelfare(v)}));}} min={0}/></div>
              <div className="fg"><label className="fl">Welfare (UGX) <span style={{fontWeight:400,color:"var(--tmuted)"}}>(auto 40% of monthly)</span></label><input className="fi" type="number" value={addMF.welfare} onChange={e=>setAddMF(f=>({...f,welfare:+e.target.value||0}))} placeholder="Auto-calculated"/><span className="fhint">40% of monthly savings auto-allocated to welfare pool. Adjust if needed.</span></div>

              {/* Shares — unit selector */}
              <div className="fg ff">
                <label className="fl">Share Units <span style={{fontWeight:400,color:"var(--b500)",fontSize:9}}>— UGX 50,000 per unit (equity in the cooperative)</span></label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
                  {[0,1,2,3,4,5,6].map(u=>(
                    <button key={u} type="button"
                      onClick={()=>setAddMF(f=>({...f,shares:u*SHARE_UNIT_VALUE,shareUnitsInput:u}))}
                      style={{padding:"7px 11px",borderRadius:8,border:(addMF.shareUnitsInput||0)===u?"2px solid var(--b600)":"1.5px solid var(--bdr)",background:(addMF.shareUnitsInput||0)===u?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:(addMF.shareUnitsInput||0)===u?700:400,color:(addMF.shareUnitsInput||0)===u?"var(--b700)":"var(--tm)",textAlign:"center"}}>
                      <div>{u===0?"None":u+" unit"+(u>1?"s":"")}</div>
                      <div style={{fontSize:9,color:(addMF.shareUnitsInput||0)===u?"var(--b600)":"var(--tmuted)",fontFamily:"var(--mono)"}}>{u===0?"—":fmt(u*SHARE_UNIT_VALUE)}</div>
                    </button>
                  ))}
                </div>
                {(addMF.shares||0)>0&&<div style={{fontSize:10,color:"var(--b600)",marginTop:4,fontFamily:"var(--mono)",fontWeight:600}}>Share capital: {fmt(addMF.shares||0)}</div>}
              </div>

              {/* Voluntary extra deposit */}
              <div className="fg ff">
                <label className="fl">Extra Voluntary Deposit <span style={{fontWeight:400,color:"var(--tmuted)",fontSize:9}}>(optional top-up beyond regular contributions)</span></label>
                <input className="fi" type="number" value={addMF.voluntaryDeposit||""} onChange={e=>setAddMF(f=>({...f,voluntaryDeposit:+e.target.value||0}))} placeholder="0"/>
                <span className="fhint">Member can deposit any extra amount at any time. This is counted in their total savings.</span>
              </div>

              {/* Payment method for initial contribution */}
              <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,margin:"4px 0 6px",borderTop:"1px solid var(--bdr)",paddingTop:10}}>💳 Mode of Initial Payment</div></div>
              <div className="fg ff">
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {[["cash","💵 Cash"],["bank","🏦 Bank"],["mtn","📱 MTN MoMo"],["airtel","📱 Airtel"]].map(([v,lbl])=>(
                    <button key={v} onClick={()=>setAddMF(f=>({...f,payMode:v}))} style={{flex:1,minWidth:80,padding:"7px 4px",borderRadius:9,border:addMF.payMode===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:addMF.payMode===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:12,fontWeight:addMF.payMode===v?700:400,color:addMF.payMode===v?"var(--b700)":"var(--tm)"}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              {addMF.payMode==="bank"&&<React.Fragment>
                <div className="fg"><label className="fl">Bank Name</label><input className="fi" value={addMF.bankName} onChange={e=>setAddMF(f=>({...f,bankName:e.target.value}))} placeholder="e.g. Stanbic Bank"/></div>
                <div className="fg"><label className="fl">Account Number</label><input className="fi" value={addMF.bankAccount} onChange={e=>setAddMF(f=>({...f,bankAccount:e.target.value}))} placeholder="Account number"/></div>
                <div className="fg"><label className="fl">Depositor Name</label><input className="fi" value={addMF.depositorName} onChange={e=>setAddMF(f=>({...f,depositorName:e.target.value}))} placeholder="Name of depositor"/></div>
                <div className="fg"><label className="fl">Transaction / Reference ID</label><input className="fi" value={addMF.transactionId} onChange={e=>setAddMF(f=>({...f,transactionId:e.target.value}))} placeholder="Bank ref or transaction ID"/></div>
              </React.Fragment>}
              {(addMF.payMode==="mtn"||addMF.payMode==="airtel")&&<React.Fragment>
                <div className="fg"><label className="fl">{addMF.payMode==="mtn"?"MTN":"Airtel"} Number</label><input className="fi" type="tel" value={addMF.mobileNumber} onChange={e=>setAddMF(f=>({...f,mobileNumber:e.target.value}))} placeholder="0772 000 000"/></div>
                <div className="fg"><label className="fl">Transaction ID</label><input className="fi" value={addMF.transactionId} onChange={e=>setAddMF(f=>({...f,transactionId:e.target.value}))} placeholder="e.g. QK7XXXXXX"/></div>
              </React.Fragment>}
            </div>
            <div className="div"/>
            <div className="crow"><span className="cl">Total Banked</span><span className="cv ok">{fmt((+addMF.membership||0)+(+addMF.annualSub||0)+(+addMF.monthlySavings||0)+(+addMF.welfare||0)+(+addMF.shares||0))}</span></div>
            <div className="fa"><button className="btn bg" onClick={()=>setAddMModal(false)}>Cancel</button><button className="btn bp" onClick={saveAddM}>Add Member</button></div>
          </div>
        </div>
      )}

      {/* ── EXPENSE MODAL ────────────────────────────────────────────────── */}
      {/* ── INVESTMENT MODAL ─────────────────────────────────────────────── */}
      {invModal&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setInvModal(false)}>
          <div className="modal wide">
            <div className="mhdr"><div className="mtitle">{editInv?"Update Investment":"Record New Investment"}</div><button className="mclose" onClick={()=>setInvModal(false)}>✕</button></div>

            {/* Approval status banner */}
            <div style={{background:invF.approvalStatus==="approved"?"#e8f5e9":invF.approvalStatus==="rejected"?"#ffebee":"#fff8e1",border:"1.5px solid "+(invF.approvalStatus==="approved"?"#a5d6a7":invF.approvalStatus==="rejected"?"#ffcdd2":"#ffe082"),borderRadius:9,padding:"8px 12px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div style={{fontWeight:700,fontSize:12,color:invF.approvalStatus==="approved"?"#1b5e20":invF.approvalStatus==="rejected"?"#c62828":"#f57f17"}}>
                {invF.approvalStatus==="approved"?"✅ Approved — Ready to record":invF.approvalStatus==="rejected"?"❌ Rejected":"⏳ Pending Approval"}
              </div>
              <div style={{display:"flex",gap:6}}>
                {[["pending","⏳ Pending"],["approved","✅ Approve"],["rejected","❌ Reject"]].map(([v,lbl])=>(
                  <button key={v} type="button" onClick={()=>setInvF(f=>({...f,approvalStatus:v}))} style={{padding:"4px 10px",borderRadius:7,border:invF.approvalStatus===v?"2px solid var(--b600)":"1px solid var(--bdr)",background:invF.approvalStatus===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:invF.approvalStatus===v?700:400}}>{lbl}</button>
                ))}
              </div>
            </div>

            <div className="fgrid">
              {/* Investment details */}
              <div className="fg ff"><label className="fl">Platform / Fund Name</label><input className="fi" value={invF.platform} onChange={e=>setInvF(f=>({...f,platform:e.target.value}))} placeholder="e.g. UAP, Britam, Stanbic Treasury Bond"/></div>
              <div className="fg ff"><label className="fl">Investment Type</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
                  {[["unit_trust","📦 Unit Trust"],["treasury_bond","🏛 Treasury Bond"],["fixed_deposit","🏦 Fixed Deposit"],["money_market","💹 Money Market"],["other","📋 Other"]].map(([v,lbl])=>(
                    <button key={v} type="button" onClick={()=>setInvF(f=>({...f,type:v}))} style={{flex:1,minWidth:110,padding:"7px 6px",borderRadius:9,border:invF.type===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:invF.type===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:invF.type===v?700:400,color:invF.type===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="fg">
                <label className="fl">Investment Year <span style={{fontWeight:400,color:"var(--tmuted)"}}>(annual only)</span></label>
                <select className="fi" value={invF.investmentYear||new Date().getFullYear()} onChange={e=>setInvF(f=>({...f,investmentYear:+e.target.value}))}>
                  {[2024,2025,2026,2027,2028].map(y=><option key={y} value={y}>{y}</option>)}
                </select>
                <span className="fhint">Investments are annual — one per platform per year.</span>
              </div>
              <div className="fg"><label className="fl">Amount Invested (UGX)</label>
                <input className="fi" type="number" value={invF.amount} onChange={e=>setInvF(f=>({...f,amount:e.target.value}))} placeholder="0"/>
                {(()=>{
                  const _rep=(loans||[]).reduce((s,l)=>s+(+l.amountPaid||0),0);
                  const _dis=(loans||[]).filter(l=>l.approvalStatus==="approved"||!l.approvalStatus).reduce((s,l)=>s+(+l.amountLoaned||0),0);
                  const _inv=(investments||[]).reduce((s,i)=>s+(+i.amount||0),0);
                  const _iret=(investments||[]).reduce((s,i)=>s+(+i.interestEarned||0),0);
                  const cashInBk=(savT.total||0)+_rep+_iret-_dis-(totalExpenses||0)-_inv;
                  const maxInv=Math.round(cashInBk*0.20);
                  const over=(+invF.amount||0)>maxInv;
                  return <span className="fhint" style={{color:over?"#c62828":"var(--b500)"}}>Max investable: {fmt(maxInv)} (20% of cash in bank {fmt(cashInBk)}){over?" — ⚠ EXCEEDS LIMIT":""}</span>;
                })()}
              </div>
              <div className="fg"><label className="fl">Date Invested</label><input className="fi" type="date" value={invF.dateInvested} onChange={e=>setInvF(f=>({...f,dateInvested:e.target.value}))}/></div>
              <div className="fg"><label className="fl" style={{color:"#1b5e20"}}>Interest Earned (UGX)</label><input className="fi" value={invF.interestEarned} onChange={e=>setInvF(f=>({...f,interestEarned:e.target.value}))} placeholder="0" style={{borderColor:"#a5d6a7"}}/><span className="fhint">Update as returns come in</span></div>
              <div className="fg"><label className="fl">Last Updated</label><input className="fi" type="date" value={invF.lastUpdated} onChange={e=>setInvF(f=>({...f,lastUpdated:e.target.value}))}/></div>
              <div className="fg ff"><label className="fl">Status</label>
                <div style={{display:"flex",gap:8,marginTop:4}}>
                  {[["active","● Active"],["closed","◼ Closed"]].map(([v,lbl])=>(
                    <button key={v} type="button" onClick={()=>setInvF(f=>({...f,status:v}))} style={{flex:1,padding:"8px",borderRadius:9,border:invF.status===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:invF.status===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:12,fontWeight:invF.status===v?700:400}}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="fg ff"><label className="fl">Notes</label><input className="fi" value={invF.notes} onChange={e=>setInvF(f=>({...f,notes:e.target.value}))} placeholder="e.g. 12-month bond at 17% p.a., maturity date..."/></div>

              {/* ── Approval Section ── */}
              <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,paddingTop:8,borderTop:"1px solid var(--bdr)"}}>✅ Approval Details</div></div>
              <div className="fg ff">
                <label className="fl">Approved By <span style={{fontWeight:400,color:"var(--tmuted)"}}>(active BIDA member)</span></label>
                <select className="fi" value={invF.approvedByMemberId||""} onChange={e=>{
                  const m=members.find(m=>m.id===+e.target.value);
                  setInvF(f=>({...f,approvedByMemberId:e.target.value,approvedBy:m?m.name:""}));
                }}>
                  <option value="">— Select approving member —</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {invF.approvedBy&&<div style={{fontSize:10,color:"#1b5e20",marginTop:3}}>✓ Approved by: {invF.approvedBy}</div>}
              </div>
              <div className="fg"><label className="fl">Approval Date</label><input className="fi" type="date" value={invF.approvalDate||""} onChange={e=>setInvF(f=>({...f,approvalDate:e.target.value}))}/></div>

              {/* ── Document Upload — stored in BIDA ── */}
              <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,paddingTop:8,borderTop:"1px solid var(--bdr)"}}>📎 Supporting Documents (stored in BIDA)</div></div>
              <div className="fg ff">
                <label style={{display:"inline-flex",alignItems:"center",gap:6,background:"linear-gradient(135deg,var(--b600),var(--b700))",color:"#fff",borderRadius:8,padding:"8px 14px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                  📄 Attach Document
                  <input type="file" accept="image/*,application/pdf,.doc,.docx" multiple style={{display:"none"}} onChange={e=>{
                    const files=Array.from(e.target.files||[]);
                    files.forEach(file=>{
                      const reader=new FileReader();
                      reader.onload=r=>{
                        setInvF(f=>({...f,
                          documents:[...(f.documents||[]),r.target.result],
                          docNames:[...(f.docNames||[]),file.name]
                        }));
                      };
                      reader.readAsDataURL(file);
                    });
                  }}/>
                </label>
                <span className="fhint" style={{marginLeft:8}}>PDFs, images, Word docs. All stored in BIDA records.</span>
                {(invF.docNames||[]).length>0&&(
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {(invF.docNames||[]).map((name,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:7,padding:"4px 9px",fontSize:10}}>
                        <span style={{color:"#1b5e20",flex:1}}>📄 {name}</span>
                        {invF.documents[i]&&invF.documents[i].startsWith("data:image")&&<a href={invF.documents[i]} target="_blank" rel="noreferrer" style={{color:"#1565c0",fontSize:9}}>View</a>}
                        {invF.documents[i]&&invF.documents[i].startsWith("data:application/pdf")&&<a href={invF.documents[i]} download={name} style={{color:"#1565c0",fontSize:9}}>Download</a>}
                        <button type="button" onClick={()=>setInvF(f=>({...f,documents:f.documents.filter((_,j)=>j!==i),docNames:f.docNames.filter((_,j)=>j!==i)}))} style={{background:"none",border:"none",color:"#c62828",cursor:"pointer",fontSize:11,padding:0}}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {(invF.docNames||[]).length===0&&<div style={{marginTop:6,fontSize:10,color:"#c62828",fontStyle:"italic"}}>⚠ No documents attached. Investment approval requires at least one supporting document.</div>}
              </div>
            </div>

            {(+invF.amount>0||+invF.interestEarned>0)&&(
              <React.Fragment>
                <div className="div"/>
                <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px"}}>
                  <div style={{fontSize:9,fontWeight:700,color:"var(--b700)",letterSpacing:1,textTransform:"uppercase",marginBottom:6,fontFamily:"var(--mono)"}}>📊 Distribution Preview</div>
                  <div className="crow"><span className="cl">Amount invested</span><span className="cv">{fmt(+invF.amount||0)}</span></div>
                  <div className="crow"><span className="cl">Interest earned</span><span className="cv ok">{fmt(+invF.interestEarned||0)}</span></div>
                  <div className="crow"><span className="cl">Retained in pool (60%)</span><span className="cv">{fmt(Math.round((+invF.interestEarned||0)*0.6))}</span></div>
                  <div className="crow" style={{borderTop:"1px solid var(--bdr)",paddingTop:4,marginTop:3}}><span className="cl">Distributable to members (40%)</span><span className="cv ok" style={{fontWeight:900}}>{fmt(Math.round((+invF.interestEarned||0)*0.4))}</span></div>
                </div>
              </React.Fragment>
            )}
            <div className="fa">
              <button className="btn bg" onClick={()=>setInvModal(false)}>Cancel</button>
              <button className="btn bp" onClick={saveInv} disabled={!editInv&&(invF.docNames||[]).length===0&&invF.approvalStatus!=="approved"}>
                {editInv?"Save Changes":"Record Investment"}
              </button>
              {!editInv&&(invF.docNames||[]).length===0&&<span style={{fontSize:10,color:"#c62828",alignSelf:"center"}}>Attach a document to proceed</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── SERVICE PROVIDER MODAL ── */}
      {/* ── CONTRIBUTION LOG MODAL ───────────────────────────────────────── */}
      {contribModal&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setContribModal(false)}>
          <div className="modal" style={{maxWidth:420}}>
            <div className="mhdr">
              <div className="mtitle">📒 Record Contribution</div>
              <button className="mclose" onClick={()=>setContribModal(false)}>✕</button>
            </div>
            <div style={{background:"#e3f2fd",border:"1px solid #90caf9",borderRadius:9,padding:"8px 12px",marginBottom:12,fontSize:11,color:"#1565c0",lineHeight:1.6}}>
              This logs a single contribution payment from a member and adds it to their running total. Use this to record monthly payments as they come in.
            </div>
            <div className="fgrid">
              <div className="fg ff">
                <label className="fl">Member</label>
                <select className="fi" value={contribF.memberId} onChange={e=>setContribF(f=>({...f,memberId:e.target.value}))}>
                  <option value="">— Select member —</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="fg">
                <label className="fl">Date Received</label>
                <input className="fi" type="date" value={contribF.date} onChange={e=>setContribF(f=>({...f,date:e.target.value}))}/>
              </div>
              <div className="fg">
                <label className="fl">Amount (UGX)</label>
                <input className="fi" type="number" value={contribF.amount} onChange={e=>setContribF(f=>({...f,amount:e.target.value}))} placeholder="e.g. 70000"/>
              </div>
              <div className="fg ff">
                <label className="fl">Category</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
                  {[["monthlySavings","💰 Monthly Savings"],["welfare","🛡 Welfare"],["annualSub","📅 Annual Sub"],["shares","📈 Shares"],["voluntaryDeposit","➕ Voluntary"]].map(([v,lbl])=>(
                    <button key={v} type="button" onClick={()=>setContribF(f=>({...f,category:v}))} style={{padding:"6px 11px",borderRadius:8,border:contribF.category===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:contribF.category===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:contribF.category===v?700:400,color:contribF.category===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="fg ff">
                <label className="fl">Note <span style={{fontWeight:400,color:"var(--tmuted)"}}>(optional)</span></label>
                <input className="fi" value={contribF.note} onChange={e=>setContribF(f=>({...f,note:e.target.value}))} placeholder="e.g. September payment, paid via MTN MoMo"/>
              </div>
            </div>
            {contribF.memberId&&contribF.amount&&(()=>{
              const m=members.find(mb=>mb.id===+contribF.memberId);
              if(!m) return null;
              const currentVal=+m[contribF.category]||0;
              const newVal=currentVal+(+contribF.amount||0);
              return (
                <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"9px 12px",marginTop:8}}>
                  <div style={{fontSize:9,fontWeight:700,color:"var(--b700)",textTransform:"uppercase",letterSpacing:.6,marginBottom:6,fontFamily:"var(--mono)"}}>Preview</div>
                  <div className="crow"><span className="cl">{m.name} — current {contribF.category}</span><span className="cv">{fmt(currentVal)}</span></div>
                  <div className="crow"><span className="cl">Adding</span><span className="cv ok">+ {fmt(+contribF.amount||0)}</span></div>
                  <div className="crow" style={{borderTop:"1px solid var(--bdr)",paddingTop:4,marginTop:3}}><span className="cl">New total</span><span className="cv ok" style={{fontWeight:900}}>{fmt(newVal)}</span></div>
                </div>
              );
            })()}
            <div className="fa">
              <button className="btn bg" onClick={()=>setContribModal(false)}>Cancel</button>
              <button className="btn bp" onClick={saveContrib} disabled={!contribF.memberId||!contribF.amount}>✓ Record Contribution</button>
            </div>
          </div>
        </div>
      )}

      {spModal&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setSpModal(false)}>
          <div className="modal wide">
            <div className="mhdr">
              <div className="mtitle">{editSp!==null?"Edit Service Provider":"Register Service Provider"}</div>
              <button className="mclose" onClick={()=>setSpModal(false)}>✕</button>
            </div>

            {/* Member or Non-Member toggle */}
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {[[true,"👤 BIDA Member","1 year mandate, must maintain savings"],[false,"🏢 Non-Member","6 months · UGX 25,000 registration fee"]].map(([v,lbl,sub])=>(
                <button key={String(v)} type="button" onClick={()=>setSpF(f=>({...f,isMember:v,memberId:v?f.memberId:"",regFee:v?0:25000}))}
                  style={{flex:1,padding:"10px 8px",borderRadius:10,border:spF.isMember===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:spF.isMember===v?"var(--b100)":"#fff",cursor:"pointer",textAlign:"left"}}>
                  <div style={{fontWeight:700,fontSize:12,color:spF.isMember===v?"var(--b700)":"var(--tm)"}}>{lbl}</div>
                  <div style={{fontSize:9,color:"var(--tmuted)",marginTop:2}}>{sub}</div>
                </button>
              ))}
            </div>

            {/* Policy info based on type */}
            <div style={{background:spF.isMember?"#e8f5e9":"#fff8e1",border:"1px solid "+(spF.isMember?"#a5d6a7":"#ffe082"),borderRadius:9,padding:"8px 12px",marginBottom:12,fontSize:10,color:spF.isMember?"#1b5e20":"#e65100",lineHeight:1.6}}>
              {spF.isMember
                ?"✅ BIDA members get a 12-month mandate to provide services. Must maintain monthly savings and annual subscription ≥ UGX 50,000 to remain compliant. Non-compliance suspends their contract."
                :"⚠ Non-members pay a non-refundable UGX 25,000 registration fee for a 6-month service mandate. After 6 months they must re-register or become a BIDA member for better terms."}
            </div>

            <div className="fgrid">
              {/* If BIDA member — select from list */}
              {spF.isMember&&(
                <div className="fg ff">
                  <label className="fl">BIDA Member</label>
                  <select className="fi" value={spF.memberId||""} onChange={e=>{
                    const m=members.find(mb=>mb.id===+e.target.value);
                    setSpF(f=>({...f,memberId:+e.target.value,directorName:m?m.name:"",phone:m?.phone||m?.whatsapp||"",companyName:f.companyName||""}));
                  }}>
                    <option value="">— Select member —</option>
                    {members.map(m=>{
                      const c=isProviderCompliant(m);
                      return <option key={m.id} value={m.id}>{m.name} {c?"✅":"⚠"}</option>;
                    })}
                  </select>
                  {spF.memberId&&(()=>{
                    const m=members.find(mb=>mb.id===spF.memberId);
                    if(!m)return null;
                    const c=isProviderCompliant(m);
                    return <div style={{marginTop:4,fontSize:10,color:c?"#1b5e20":"#c62828",background:c?"#e8f5e9":"#ffebee",border:"1px solid "+(c?"#a5d6a7":"#ffcdd2"),borderRadius:7,padding:"4px 8px"}}>
                      {c?"✅ Compliant — 12-month mandate":"⚠ Not compliant: "+[(m.annualSub||0)<50000?"annual sub <50k":"",(m.monthlySavings||0)===0?"no monthly savings":""].filter(Boolean).join(", ")}
                    </div>;
                  })()}
                </div>
              )}

              {/* Company / Business details */}
              <div className="fg ff"><label className="fl">Company / Business Name</label><input className="fi" value={spF.companyName} onChange={e=>setSpF(f=>({...f,companyName:e.target.value}))} placeholder="e.g. Kasaka Printers Ltd"/></div>
              <div className="fg"><label className="fl">TIN (Tax ID)</label><input className="fi" value={spF.tin} onChange={e=>setSpF(f=>({...f,tin:e.target.value}))} placeholder="e.g. 1009876543"/></div>
              <div className="fg"><label className="fl">Director / Contact Name</label><input className="fi" value={spF.directorName} onChange={e=>setSpF(f=>({...f,directorName:e.target.value}))} placeholder="Full name"/></div>
              <div className="fg"><label className="fl">Telephone</label><input className="fi" type="tel" value={spF.phone} onChange={e=>setSpF(f=>({...f,phone:e.target.value}))} placeholder="0772 000 000"/></div>
              <div className="fg ff">
                <label className="fl">Service Type</label>
                <select className="fi" value={spF.serviceType} onChange={e=>setSpF(f=>({...f,serviceType:e.target.value}))}>
                  <option value="">— Select service —</option>
                  {SERVICE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="fg ff"><label className="fl">Description / Scope of Service</label><input className="fi" value={spF.description} onChange={e=>setSpF(f=>({...f,description:e.target.value}))} placeholder="e.g. Printing BIDA passbooks, receipts and official documents"/></div>
              <div className="fg"><label className="fl">Registration Date</label><input className="fi" type="date" value={spF.registeredDate} onChange={e=>{
                const rd=e.target.value;
                const exp=new Date(rd);exp.setMonth(exp.getMonth()+(spF.isMember?12:6));
                setSpF(f=>({...f,registeredDate:rd,expiryDate:exp.toISOString().split("T")[0]}));
              }}/></div>
              <div className="fg"><label className="fl">Expiry Date <span style={{fontWeight:400,color:"var(--tmuted)"}}>({spF.isMember?"12 months":"6 months"})</span></label>
                <input className="fi" type="date" value={spF.expiryDate||""} readOnly style={{background:"var(--b50)",color:"var(--tmuted)"}}/>
              </div>

              {/* Non-member registration fee */}
              {!spF.isMember&&(
                <div className="fg ff">
                  <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:9,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:12,color:"#e65100"}}>💳 Registration Fee: UGX 25,000</div>
                      <div style={{fontSize:10,color:"#795548",marginTop:2}}>Non-refundable. Covers 6-month service mandate.</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <input type="checkbox" id="regFeePaid" checked={!!spF.regFeePaid} onChange={e=>setSpF(f=>({...f,regFeePaid:e.target.checked}))} style={{width:16,height:16}}/>
                      <label htmlFor="regFeePaid" style={{fontSize:11,fontWeight:700,color:spF.regFeePaid?"#1b5e20":"#e65100",cursor:"pointer"}}>{spF.regFeePaid?"✅ Fee Paid":"☐ Mark as Paid"}</label>
                    </div>
                  </div>
                </div>
              )}

              {/* Approval */}
              <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,paddingTop:6,borderTop:"1px solid var(--bdr)"}}>✅ Approval</div></div>
              <div className="fg ff">
                <label className="fl">Approved By <span style={{fontWeight:400,color:"var(--tmuted)"}}>(BIDA member)</span></label>
                <select className="fi" value={spF.approvedByMemberId||""} onChange={e=>{
                  const m=members.find(mb=>mb.id===+e.target.value);
                  setSpF(f=>({...f,approvedByMemberId:+e.target.value||""}));
                }}>
                  <option value="">— Select approver —</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="fg ff">
                <label className="fl">Approval Status</label>
                <div style={{display:"flex",gap:7,marginTop:4}}>
                  {[["pending","⏳ Pending"],["approved","✅ Approved"],["rejected","❌ Rejected"]].map(([v,lbl])=>(
                    <button key={v} type="button" onClick={()=>setSpF(f=>({...f,approvalStatus:v}))} style={{flex:1,padding:"7px",borderRadius:8,border:spF.approvalStatus===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:spF.approvalStatus===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:spF.approvalStatus===v?700:400}}>{lbl}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="fa">
              <button className="btn bg" onClick={()=>setSpModal(false)}>Cancel</button>
              <button className="btn bp"
                disabled={!spF.serviceType||(!spF.isMember&&!spF.companyName)||(!spF.isMember&&!spF.regFeePaid&&editSp===null)}
                onClick={()=>{
                  if(editSp!==null){
                    setServiceProviders(prev=>prev.map((p,i)=>i===editSp?{...spF}:p));
                    saveRecord("service_providers",{...spF},setSyncStatus);
                  } else {
                    const newSP={...spF,id:Date.now()};
                    setServiceProviders(prev=>[...prev,newSP]);
                    saveRecord("service_providers",{...newSP,id:String(newSP.id)},setSyncStatus);
                  }
                  setSpModal(false);
                  setEditSp(null);
                }}>
                {editSp!==null?"Save Changes":"Register Provider"}
              </button>
              {!spF.isMember&&!spF.regFeePaid&&editSp===null&&<span style={{fontSize:10,color:"#c62828",alignSelf:"center"}}>Registration fee must be paid first</span>}
            </div>
          </div>
        </div>
      )}

      {expModal&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setExpModal(false)}>
          <div className="modal wide">
            <div className="mhdr"><div className="mtitle">{editExp?"Edit Expense":"Record Expense"}</div><button className="mclose" onClick={()=>setExpModal(false)}>✕</button></div>
            <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:9,padding:"8px 12px",marginBottom:10,fontSize:10,color:"#5d4037",lineHeight:1.6}}>
              <strong>⚠ Expense Policy:</strong> All payments to service providers must be <strong>approved before payment</strong>. Providers must be registered in the BIDA Service Provider Directory. Casual/unregistered payments are not permitted. Ensure "Issued By" and "Approved By" are both active BIDA members.
            </div>
            <div className="fgrid">
              <div className="fg"><label className="fl">Date</label><input className="fi" type="date" value={expF.date} onChange={e=>setExpF(f=>({...f,date:e.target.value}))}/></div>
              <div className="fg"><label className="fl">Amount (UGX)</label><input className="fi" type="number" value={expF.amount} onChange={e=>setExpF(f=>({...f,amount:e.target.value}))} placeholder="0"/></div>
              <div className="fg ff"><label className="fl">Activity / Description</label><input className="fi" value={expF.activity} onChange={e=>setExpF(f=>({...f,activity:e.target.value}))} placeholder="e.g. Office supplies, Meeting costs"/></div>
              <div className="fg ff"><label className="fl">Purpose of Payment</label><input className="fi" value={expF.purpose} onChange={e=>setExpF(f=>({...f,purpose:e.target.value}))} placeholder="e.g. Quarterly committee meeting facilitation"/></div>
              <div className="fg ff"><label className="fl">Category</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
                  <ExpCategoryButtons expF={expF} setExpF={setExpF}/>
                </div>
                {expF.category==="other"&&<input className="fi" style={{marginTop:7}} value={expF.categoryCustom} onChange={e=>setExpF(f=>({...f,categoryCustom:e.target.value}))} placeholder="Describe the expense category"/>}
              </div>

              {/* Bank Charges toggle */}
              <div className="fg ff">
                <div style={{display:"flex",alignItems:"center",gap:10,background:"#e3f2fd",border:"1px solid #90caf9",borderRadius:9,padding:"8px 12px"}}>
                  <input type="checkbox" id="isBankCharge" checked={expF.category==="banking"} onChange={e=>setExpF(f=>({...f,category:e.target.checked?"banking":f.category==="banking"?"operations":f.category}))} style={{width:16,height:16,cursor:"pointer"}}/>
                  <label htmlFor="isBankCharge" style={{fontSize:11,fontWeight:700,color:"#1565c0",cursor:"pointer"}}>🏦 This is a Bank Charge — will be logged under Banking category and shown separately in ledger</label>
                </div>
              </div>

              {/* Issued By — must be BIDA member */}
              <div className="fg ff">
                <label className="fl">Issued / Paid By <span style={{fontWeight:400,color:"var(--tmuted)"}}>(must be BIDA member)</span></label>
                <select className="fi" value={expF.issuedById||""} onChange={e=>{
                  const m=members.find(m=>m.id===+e.target.value);
                  setExpF(f=>({...f,issuedById:e.target.value,issuedBy:m?m.name:"",issuedByPhone:m?.phone||m?.whatsapp||"",issuedByNIN:m?.nin||""}));
                }}>
                  <option value="">— Select member —</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="fg"><label className="fl">Payer Telephone</label><input className="fi" type="tel" value={expF.issuedByPhone||""} onChange={e=>setExpF(f=>({...f,issuedByPhone:e.target.value}))} placeholder="Auto-filled from profile"/></div>
              <div className="fg"><label className="fl">Payer NIN</label><input className="fi" value={expF.issuedByNIN||""} onChange={e=>setExpF(f=>({...f,issuedByNIN:e.target.value}))} placeholder="Auto-filled from profile"/></div>
              <div className="fg ff">
                <label className="fl" style={{color:"#1b5e20"}}>Approved By <span style={{fontWeight:400,color:"var(--tmuted)"}}>(must be active BIDA member)</span></label>
                <select className="fi" style={{borderColor:"#a5d6a7"}} value={expF.approverMemberId||""} onChange={e=>{
                  const m=members.find(m=>m.id===+e.target.value);
                  setExpF(f=>({...f,approverMemberId:e.target.value,approvedBy:m?m.name:"",approverPhone:m?.phone||m?.whatsapp||"",approverNIN:m?.nin||""}));
                }}>
                  <option value="">— Select approving member —</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name}{(m.phone||m.nin)?" ✓":""}</option>)}
                </select>
                {expF.approvedBy&&<div style={{fontSize:10,color:"#1b5e20",marginTop:3,fontFamily:"var(--mono)"}}>✓ {expF.approvedBy}{expF.approverPhone?" · "+expF.approverPhone:""}{expF.approverNIN?" · "+expF.approverNIN:""}</div>}
                {expF.issuedById&&(()=>{
                  const sp=serviceProviders.find(p=>p.memberId===+expF.issuedById&&spIsActive(p));
                  const m=members.find(m=>m.id===+expF.issuedById);
                  if(!sp){
                    const anySp=serviceProviders.find(p=>p.memberId===+expF.issuedById);
                    if(anySp&&!spIsActive(anySp)) return <div style={{marginTop:4,fontSize:10,color:"#c62828",background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:7,padding:"4px 8px"}}>⚠ This provider's mandate has expired. They must re-register before receiving payments.</div>;
                    return <div style={{marginTop:4,fontSize:10,color:"#e65100",background:"#fff3e0",border:"1px solid #ffcc80",borderRadius:7,padding:"4px 8px"}}>⚠ Not in provider directory. Register this member as a service provider first, or select a registered provider.</div>;
                  }
                  const compliant=m&&isProviderCompliant(m);
                  return <div style={{marginTop:4,fontSize:10,color:compliant?"#1b5e20":"#c62828",background:compliant?"#e8f5e9":"#ffebee",border:"1px solid "+(compliant?"#a5d6a7":"#ffcdd2"),borderRadius:7,padding:"4px 8px"}}>
                    {compliant?"✅ Active registered provider — "+sp.serviceType+" · Mandate valid until "+(spExpiryDate(sp)?spExpiryDate(sp).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"):"⚠ Provider not compliant — check their annual sub and monthly savings"}
                  </div>;
                })()}
              </div>
              <div className="fg"><label className="fl" style={{color:"#1b5e20"}}>Approver Telephone</label><input className="fi" type="tel" value={expF.approverPhone||""} onChange={e=>setExpF(f=>({...f,approverPhone:e.target.value}))} placeholder="Auto-filled from profile" style={{borderColor:"#a5d6a7"}}/></div>
              <div className="fg"><label className="fl" style={{color:"#1b5e20"}}>Approver NIN</label><input className="fi" value={expF.approverNIN||""} onChange={e=>setExpF(f=>({...f,approverNIN:e.target.value}))} placeholder="Auto-filled from profile" style={{borderColor:"#a5d6a7"}}/></div>

              {/* Payment mode */}
              <div className="fg ff"><label className="fl">Mode of Payment</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
                  {[["cash","💵 Cash"],["bank","🏦 Bank Transfer"],["mtn","📱 MTN MoMo"],["airtel","📱 Airtel Money"]].map(([v,lbl])=>(
                    <button key={v} onClick={()=>setExpF(f=>({...f,payMode:v}))} style={{flex:1,minWidth:100,padding:"8px 6px",borderRadius:9,border:expF.payMode===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:expF.payMode===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:12,fontWeight:expF.payMode===v?700:400,color:expF.payMode===v?"var(--b700)":"var(--tm)"}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              {expF.payMode==="bank"&&<React.Fragment>
                <div className="fg"><label className="fl">Bank Name</label><input className="fi" value={expF.bankName} onChange={e=>setExpF(f=>({...f,bankName:e.target.value}))} placeholder="e.g. Stanbic Bank"/></div>
                <div className="fg"><label className="fl">Account Number</label><input className="fi" value={expF.bankAccount} onChange={e=>setExpF(f=>({...f,bankAccount:e.target.value}))} placeholder="Account number"/></div>
                <div className="fg"><label className="fl">Depositor Name</label><input className="fi" value={expF.depositorName} onChange={e=>setExpF(f=>({...f,depositorName:e.target.value}))} placeholder="Name of depositor"/></div>
                <div className="fg"><label className="fl">Transaction / Reference ID</label><input className="fi" value={expF.transactionId} onChange={e=>setExpF(f=>({...f,transactionId:e.target.value}))} placeholder="Bank reference or transaction ID"/></div>
              </React.Fragment>}
              {(expF.payMode==="mtn"||expF.payMode==="airtel")&&<React.Fragment>
                <div className="fg"><label className="fl">{expF.payMode==="mtn"?"MTN":"Airtel"} Number</label><input className="fi" type="tel" value={expF.mobileNumber} onChange={e=>setExpF(f=>({...f,mobileNumber:e.target.value}))} placeholder="e.g. 0772123456"/></div>
                <div className="fg"><label className="fl">Transaction ID</label><input className="fi" value={expF.transactionId} onChange={e=>setExpF(f=>({...f,transactionId:e.target.value}))} placeholder="e.g. QK7XXXXXX"/></div>
              </React.Fragment>}
            </div>
            <div className="div"/>
            <div style={{background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:11,color:"#c62828"}}>
              ⚠️ This expense reduces cash in bank by <strong>{expF.amount?fmt(+expF.amount):"UGX 0"}</strong>. Cash in bank after: <strong>{fmt(cashInBank-(editExp?0:+expF.amount||0))}</strong>
            </div>
            <div className="fa"><button className="btn bg" onClick={()=>setExpModal(false)}>Cancel</button><button className="btn bp" onClick={saveExp}>{editExp?"Save Changes":"Record Expense"}</button></div>
          </div>
        </div>
      )}

      {/* ── LOAN PAYMENT MODAL ── */}
      {payModal&&<PayModal
        loan={loansCalc.find(l=>l.id===payF.loanId)}
        mem={loansCalc.find(l=>l.id===payF.loanId)?members.find(m=>m.id===loansCalc.find(l=>l.id===payF.loanId).memberId):null}
        payF={payF} setPayF={setPayF} savePay={savePay} setPayModal={setPayModal}
      />}

      {/* ── LOAN MODAL ───────────────────────────────────────────────────── */}
      {lModal&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setLModal(false)}>
          <div className="modal wide">
            <div className="mhdr"><div className="mtitle">{editL?"Edit Loan":"Issue New Loan"}</div><button className="mclose" onClick={()=>setLModal(false)}>✕</button></div>
            <div className="fgrid">
              <div className="fg ff"><label className="fl">Member</label>
                <select className="fi" value={lF.memberId} onChange={e=>{const m=members.find(m=>m.id===+e.target.value);const lim=m?borrowLimit(m,loans):0;const fee=m?procFee(lim):0;setLF(f=>({...f,memberId:e.target.value,memberName:m?m.name:"",amountLoaned:m?lim:"",processingFeePaid:m?Math.round(fee):"",borrowerPhone:m?.phone||m?.whatsapp||"",borrowerAddress:m?.address||"",borrowerNIN:m?.nin||""}));}}>
                  <option value="">— Select member —</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name} — limit {fmt(borrowLimit(m,loans))}</option>)}
                </select>
              </div>
              <div className="fg"><label className="fl">Date Issued</label><input className="fi" type="date" value={lF.dateBanked} onChange={e=>setLF(f=>({...f,dateBanked:e.target.value}))}/></div>
              <div className="fg">
                <label className="fl">Principal (UGX)</label>
                <input className="fi" type="number" value={lF.amountLoaned} onChange={e=>onAmt(e.target.value)} placeholder="0"/>
                <LoanLimitBadge memberId={lF.memberId} members={members} amountLoaned={lF.amountLoaned}/>
              </div>
              <div className="fg"><label className="fl">Processing Fee</label><input className="fi" type="number" value={lF.processingFeePaid} onChange={e=>setLF(f=>({...f,processingFeePaid:e.target.value}))}/><span className="fhint">Auto: 25,000 + 1%</span></div>
              <div className="fg ff"><label className="fl">Loan Type</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
                  {[["personal","👤 Personal"],["business","💼 Business"],["education","🎓 Education"],["medical","🏥 Medical"],["agriculture","🌾 Agriculture"],["other","📋 Other"]].map(([v,lbl])=>(
                    <button key={v} onClick={()=>setLF(f=>({...f,loanType:v}))} style={{padding:"6px 11px",borderRadius:8,border:lF.loanType===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:lF.loanType===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:lF.loanType===v?700:400,color:lF.loanType===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="fg ff"><label className="fl">Purpose of Loan <span style={{fontWeight:400,color:"var(--tmuted)"}}>(required)</span></label><input className="fi" value={lF.loanPurpose} onChange={e=>setLF(f=>({...f,loanPurpose:e.target.value}))} placeholder="e.g. Purchase business stock, School fees for children, Medical bills..."/></div>

              {/* ── Borrower Details ── */}
              <div className="fg ff" style={{gridColumn:"1/-1"}}>
                <div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,margin:"8px 0 4px",borderTop:"1px solid var(--bdr)",paddingTop:10}}>👤 Borrower Details</div>
                {lF.memberId&&(()=>{
                  const m=members.find(m=>m.id===+lF.memberId);
                  const missing=[];
                  if(m&&!m.phone)missing.push("phone");
                  if(m&&!m.nin)missing.push("NIN");
                  if(m&&!m.address)missing.push("address");
                  if(missing.length===0)return <div style={{fontSize:10,color:"#1b5e20",background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:7,padding:"4px 9px",marginBottom:4}}>✓ All details auto-filled from member profile</div>;
                  return <div style={{fontSize:10,color:"#bf360c",background:"#fff3e0",border:"1px solid #ffcc80",borderRadius:7,padding:"4px 9px",marginBottom:4}}>⚠ Missing from profile: <strong>{missing.join(", ")}</strong> — fill in below or update profile first</div>;
                })()}
              </div>
              <div className="fg"><label className="fl">Telephone</label><input className="fi" type="tel" value={lF.borrowerPhone} onChange={e=>setLF(f=>({...f,borrowerPhone:e.target.value}))} placeholder="0772 000 000"/></div>
              <div className="fg"><label className="fl">National ID Number (NIN)</label><input className="fi" value={lF.borrowerNIN} onChange={e=>setLF(f=>({...f,borrowerNIN:e.target.value}))} placeholder="NIN e.g. CM90001234..."/></div>
              <div className="fg ff"><label className="fl">Physical Address</label><input className="fi" value={lF.borrowerAddress} onChange={e=>setLF(f=>({...f,borrowerAddress:e.target.value}))} placeholder="Village, Parish, District"/></div>

              {/* ── Guarantor Details ── */}
              <div className="fg ff" style={{gridColumn:"1/-1"}}><div style={{fontSize:10,fontWeight:700,color:"#1b5e20",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,margin:"8px 0 4px",borderTop:"1px solid var(--bdr)",paddingTop:10}}>🛡 Guarantor Details <span style={{fontWeight:400,color:"var(--tmuted)"}}>(must be a BIDA member)</span></div></div>
              <div className="fg ff"><label className="fl">Select Guarantor</label>
                <select className="fi" value={lF.guarantorMemberId} onChange={e=>{
                  const m=members.find(m=>m.id===+e.target.value);
                  const missing=m?[!m.phone&&"phone",!m.nin&&"NIN",!m.address&&"address"].filter(Boolean):[];
                  setLF(f=>({...f,guarantorMemberId:e.target.value,guarantorName:m?m.name:"",guarantorPhone:m?.phone||m?.whatsapp||"",guarantorAddress:m?.address||"",guarantorNIN:m?.nin||""}));
                }}>
                  <option value="">— Select guarantor from members —</option>
                  {members.filter(m=>m.id!==+lF.memberId).map(m=>{
                    const complete=m.phone&&m.nin&&m.address;
                    return <option key={m.id} value={m.id}>{m.name}{complete?" ✓":" ⚠"}</option>;
                  })}
                </select>
                {lF.guarantorMemberId&&(()=>{
                  const m=members.find(m=>m.id===+lF.guarantorMemberId);
                  const missing=[];
                  if(m&&!m.phone)missing.push("phone");
                  if(m&&!m.nin)missing.push("NIN");
                  if(m&&!m.address)missing.push("address");
                  if(missing.length===0)return <div style={{fontSize:10,color:"#1b5e20",background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:7,padding:"4px 9px",marginTop:4}}>✓ All guarantor details auto-filled from member profile</div>;
                  return <div style={{fontSize:10,color:"#bf360c",background:"#fff3e0",border:"1px solid #ffcc80",borderRadius:7,padding:"4px 9px",marginTop:4}}>⚠ Missing from guarantor profile: <strong>{missing.join(", ")}</strong> — fill in below or update their profile first</div>;
                })()}
              </div>
              <div className="fg"><label className="fl">Guarantor Telephone</label><input className="fi" type="tel" value={lF.guarantorPhone} onChange={e=>setLF(f=>({...f,guarantorPhone:e.target.value}))} placeholder="0772 000 000"/></div>
              <div className="fg"><label className="fl">Guarantor NIN</label><input className="fi" value={lF.guarantorNIN} onChange={e=>setLF(f=>({...f,guarantorNIN:e.target.value}))} placeholder="NIN e.g. CM90001234..."/></div>
              <div className="fg ff"><label className="fl">Guarantor Address</label><input className="fi" value={lF.guarantorAddress} onChange={e=>setLF(f=>({...f,guarantorAddress:e.target.value}))} placeholder="Village, Parish, District"/></div>

              {/* ── Term + settlement ── */}
              <div className="fg ff" style={{gridColumn:"1/-1"}}><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,margin:"8px 0 4px",borderTop:"1px solid var(--bdr)",paddingTop:10}}>📅 Repayment Terms</div></div>
              {(+lF.amountLoaned||0)>0&&(+lF.amountLoaned||0)<7000000&&(
                <div className="fg ff" style={{gridColumn:"1/-1"}}>
                  <label className="fl">Repayment Period <span style={{fontWeight:400,color:"var(--tmuted)"}}>(agreed verbally with member)</span></label>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
                    <TermSelectorButtons lF={lF} setLF={setLF}/>
                  </div>
                </div>
              )}
              {(+lF.amountLoaned||0)>=7000000&&(
                <div className="fg ff" style={{gridColumn:"1/-1",background:"#e8eaf6",border:"1px solid #9fa8da",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#283593"}}>
                  <strong>📌 Reducing Balance Loan (≥ UGX 7m):</strong> Fixed 12-month term. Interest at 6% on declining balance monthly.
                </div>
              )}
              <div className="fg"><label className="fl">Amount Paid Back</label><input className="fi" type="number" value={lF.amountPaid} onChange={e=>setLF(f=>({...f,amountPaid:e.target.value}))} placeholder="0"/></div>
              <div className="fg"><label className="fl">Date Settled</label><input className="fi" type="date" value={lF.datePaid} onChange={e=>setLF(f=>({...f,datePaid:e.target.value}))}/></div>
              <div className="fg ff"><label className="fl">Status</label>
                <select className="fi" value={lF.status} onChange={e=>setLF(f=>({...f,status:e.target.value}))}>
                  <option value="active">Active</option><option value="paid">Paid / Settled</option>
                </select>
              </div>
            </div>
            {lFPreview&&(
              <React.Fragment>
                <div className="div"/>
                {lFPreview.method==="flat"&&<FlatLoanPreview lFPreview={lFPreview} lF={lF} setLF={setLF}/>}
                {lFPreview.method==="reducing"&&(
                  <div style={{background:"var(--b50)",border:"1px solid var(--bdr)",borderRadius:9,padding:"10px 12px"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"var(--b700)",letterSpacing:1,textTransform:"uppercase",marginBottom:6,fontFamily:"var(--mono)"}}>📐 6% Reducing Balance — 12-month fixed</div>
                    <div className="crow"><span className="cl">First month payment (highest)</span><span className="cv ok" style={{fontSize:14,fontWeight:900}}>{fmt(lFPreview.monthlyPayment)}</span></div>
                    <div className="crow"><span className="cl">Payment decreases as principal reduces</span><span className="cv" style={{color:"#1565c0"}}>✓</span></div>
                    <div className="crow"><span className="cl">Total interest (12mo)</span><span className="cv d">{fmt(lFPreview.totalInterest)}</span></div>
                    <div className="crow" style={{borderTop:"1px solid var(--bdr)",paddingTop:4,marginTop:3}}><span className="cl">Total due</span><span className="cv" style={{fontWeight:800}}>{fmt(lFPreview.totalDue)}</span></div>
                    {lFPreview.amountPaid>0&&<div className="crow"><span className="cl">Balance remaining</span><span className={"cv"+(lFPreview.balance>0?" d":" ok")}>{fmt(lFPreview.balance)}</span></div>}
                  </div>
                )}
              </React.Fragment>
            )}
            {/* Liquidity check */}
            {(+lF.amountLoaned>0)&&(()=>{
              const amt=+lF.amountLoaned;
              const _lr=loans.reduce((s,l)=>s+(+l.amountPaid||0),0);
              const _ld=loans.filter(l=>l.approvalStatus==="approved"||!l.approvalStatus).reduce((s,l)=>s+(+l.amountLoaned||0),0);
              const _li=investments.reduce((s,i)=>s+(+i.amount||0),0);
              const _lir=investments.reduce((s,i)=>s+(+i.interestEarned||0),0);
              const cib=savT.total+_lr+_lir-_ld-totalExpenses-_li;
              const totalInv=investments.reduce((s,i)=>s+(+i.amount||0),0);
              const liq=liquidityCheck(amt,cib,totalInv);
              return liq.ok
                ?<div style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:9,padding:"7px 12px",marginBottom:8,fontSize:11,color:"#1b5e20"}}>✅ Liquidity OK — {fmt(liq.available)} available after 30% reserve</div>
                :<div style={{background:"#ffebee",border:"1.5px solid #ef9a9a",borderRadius:9,padding:"9px 12px",marginBottom:8,fontSize:11,color:"#c62828"}}><strong>⚠ Liquidity Alert:</strong> Available: {fmt(liq.available)} · Shortfall: {fmt(liq.shortfall)}</div>;
            })()}
            <div className="fa"><button className="btn bg" onClick={()=>setLModal(false)}>Cancel</button><button className="btn bp" onClick={saveL}>{editL?"Save Changes":"Issue Loan"}</button></div>
          </div>
        </div>
      )}
      </React.Fragment>}
    </React.Fragment>
  );
}

export default function App(){
  return React.createElement(ErrorBoundary,null,React.createElement(AppInner,null));
}
