import React from "react";
const { useState, useMemo, useEffect } = React;

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SUPA_URL = "https://oscuauaifgaeauzvkihu.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY3VhdWFpZmdhZWF1enZraWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NTU2MzEsImV4cCI6MjA4OTEzMTYzMX0.tsdr1vL7Q5DcrSt-0AMHeWpxfXCWvi4KXuYuYoLblI0";
const supa = {
  async get(table) {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*&order=id`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    return r.json();
  },
  async upsert(table, data) {
    await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(data)
    });
  },
  async del(table, id) {
    await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
  },
  async update(table, id, data) {
    await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  }
};
// Helper — map DB row to app member object
function dbToMember(r) {
  return { id:r.id, name:r.name||"", email:r.email||"", whatsapp:r.whatsapp||"", phone:r.phone||"", nin:r.nin||"", address:r.address||"", photo:r.photo||"", membership:+r.membership||0, annualSub:+r.annual_sub||0, monthlySavings:+r.monthly_savings||0, welfare:+r.welfare||0, shares:+r.shares||0, joinDate:r.join_date||"", referrals:+r.referrals||0 };
}
function memberToDb(m) {
  return { id:m.id, name:m.name, email:m.email||"", whatsapp:m.whatsapp||"", phone:m.phone||"", nin:m.nin||"", address:m.address||"", photo:m.photo||"", membership:m.membership||0, annual_sub:m.annualSub||0, monthly_savings:m.monthlySavings||0, welfare:m.welfare||0, shares:m.shares||0, join_date:m.joinDate||"", referrals:m.referrals||0 };
}
function dbToLoan(r) {
  return { id:r.id, memberId:r.member_id, memberName:r.member_name||"", dateBanked:r.date_banked||"", amountLoaned:+r.amount_loaned||0, processingFeePaid:+r.processing_fee_paid||0, datePaid:r.date_paid||"", amountPaid:+r.amount_paid||0, status:r.status||"active", term:+r.term||12, loanType:r.loan_type||"personal", loanPurpose:r.loan_purpose||"", borrowerPhone:r.borrower_phone||"", borrowerAddress:r.borrower_address||"", borrowerNin:r.borrower_nin||"", guarantorName:r.guarantor_name||"", guarantorPhone:r.guarantor_phone||"", guarantorAddress:r.guarantor_address||"", guarantorNin:r.guarantor_nin||"", guarantorMemberId:r.guarantor_member_id||"" };
}
function loanToDb(l) {
  return { member_id:l.memberId, member_name:l.memberName, date_banked:l.dateBanked, amount_loaned:l.amountLoaned||0, processing_fee_paid:l.processingFeePaid||0, date_paid:l.datePaid||null, amount_paid:l.amountPaid||0, status:l.status||"active", term:l.term||12, loan_type:l.loanType||"personal", loan_purpose:l.loanPurpose||"", borrower_phone:l.borrowerPhone||"", borrower_address:l.borrowerAddress||"", borrower_nin:l.borrowerNIN||"", guarantor_name:l.guarantorName||"", guarantor_phone:l.guarantorPhone||"", guarantor_address:l.guarantorAddress||"", guarantor_nin:l.guarantorNIN||"", guarantor_member_id:l.guarantorMemberId||null };
}
function dbToExpense(r) {
  return { id:r.id, date:r.date||"", activity:r.activity||"", amount:+r.amount||0, issuedBy:r.issued_by||"", approvedBy:r.approved_by||"", approverPhone:r.approver_phone||"", approverNIN:r.approver_nin||"", purpose:r.purpose||"", payMode:r.pay_mode||"cash", bankName:r.bank_name||"", bankAccount:r.bank_account||"", depositorName:r.depositor_name||"", mobileNumber:r.mobile_number||"", transactionId:r.transaction_id||"", category:r.category||"", categoryCustom:r.category_custom||"" };
}
function expenseToDb(e) {
  return { date:e.date, activity:e.activity, amount:e.amount||0, issued_by:e.issuedBy||"", approved_by:e.approvedBy||"", approver_phone:e.approverPhone||"", approver_nin:e.approverNIN||"", purpose:e.purpose||"", pay_mode:e.payMode||"cash", bank_name:e.bankName||"", bank_account:e.bankAccount||"", depositor_name:e.depositorName||"", mobile_number:e.mobileNumber||"", transaction_id:e.transactionId||"", category:e.category||"", category_custom:e.categoryCustom||"" };
}
function dbToInv(r) {
  return { id:r.id, platform:r.platform||"", type:r.type||"unit_trust", amount:+r.amount||0, dateInvested:r.date_invested||"", interestEarned:+r.interest_earned||0, lastUpdated:r.last_updated||"", status:r.status||"active", notes:r.notes||"" };
}
function invToDb(i) {
  return { platform:i.platform, type:i.type||"unit_trust", amount:i.amount||0, date_invested:i.dateInvested||"", interest_earned:i.interestEarned||0, last_updated:i.lastUpdated||"", status:i.status||"active", notes:i.notes||"" };
}


const fmt   = (n) => n == null ? "—" : "UGX " + Number(n).toLocaleString("en-UG");
const fmtN  = (n) => n == null ? "0" : Number(n).toLocaleString("en-UG");
const fmtD  = (d) => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const toStr = () => new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
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

const totBanked   = (m) => (m.membership||0)+(m.annualSub||0)+(m.monthlySavings||0)+(m.welfare||0)+(m.shares||0);
const procFee     = (a) => 50000 + 0.01 * a;

// ── LOAN SCORE ── must be defined before borrowLimit ──
function loanScore(m, loans){
  const base = totBanked(m) < 1000000 ? 1.5 : 2.0;
  const today = new Date();
  const hasDefault = (loans||[]).some(function(l){
    if(l.memberId!==m.id||l.status==="paid")return false;
    const issued=new Date(l.dateBanked);
    const dueDate=new Date(issued.getFullYear(),issued.getMonth()+(l.term||12),issued.getDate());
    const overdueDays=Math.floor((today-dueDate)/(1000*60*60*24));
    return overdueDays>180;
  });
  if(hasDefault) return 0.5;
  const referralBonus=(m.referrals||0)*0.002;
  return Math.min(base+referralBonus, base+0.02);
}
function effectiveBorrowLimit(m, loans){
  return Math.round(totBanked(m)*loanScore(m,loans));
}
const borrowLimit = (m, loans) => effectiveBorrowLimit(m, loans||[]);

const INIT_MEMBERS = [
  {id:1,name:"LUKULA PATRICK",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:60000,welfare:40000,shares:150000,joinDate:"2024-01-01"},
  {id:2,name:"NAMWASE LOY",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:1030000,welfare:550000,shares:300000,joinDate:"2024-01-01"},
  {id:3,name:"BIRUNGI SHEILLA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:385000,welfare:285000,shares:300000,joinDate:"2024-01-01"},
  {id:4,name:"GANDI FRED K",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:935000,welfare:300000,shares:350000,joinDate:"2024-01-01"},
  {id:5,name:"BAZIRA RONALD JO",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:220000,welfare:150000,shares:250000,joinDate:"2024-01-01"},
  {id:6,name:"MUGAYA ROBERT",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:130000,welfare:120000,shares:200000,joinDate:"2024-01-01"},
  {id:7,name:"WANYANA JULIET",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:120000,welfare:110000,shares:200000,joinDate:"2024-01-01"},
  {id:8,name:"KITAKUULE BINASALI",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:850000,welfare:360000,shares:300000,joinDate:"2024-01-01"},
  {id:9,name:"KITAKUULE NASUR",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:10,name:"KISAMBIRA HASSAN",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:250000,welfare:200000,shares:300000,joinDate:"2024-01-01"},
  {id:11,name:"BAFUMBA SARAH",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:50000,welfare:60000,shares:200000,joinDate:"2024-01-01"},
  {id:12,name:"TEZUKUUBA FAROUK",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:10000,shares:0,joinDate:"2024-01-01"},
  {id:13,name:"KATUNTU HANNAH",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:210000,welfare:210000,shares:300000,joinDate:"2024-01-01"},
  {id:15,name:"KANKWENZI HELLEN",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:105000,welfare:60000,shares:200000,joinDate:"2024-01-01"},
  {id:16,name:"MUKESI DAVID",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:100000,welfare:70000,shares:200000,joinDate:"2024-01-01"},
  {id:17,name:"ITTAZI CHRISTOPHER",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:45000,welfare:40000,shares:150000,joinDate:"2024-01-01"},
  {id:18,name:"KIFUMBA SUMIN",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:19,name:"WOTAKYALA SAM",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:160000,welfare:90000,shares:200000,joinDate:"2024-01-01"},
  {id:20,name:"WOTAKYALA HAAWA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:110000,welfare:140000,shares:250000,joinDate:"2024-01-01"},
  {id:21,name:"JOSEPH KAWUBIRI",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:22,name:"LOVINA TEZIKUBA",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:23,name:"KAMIS KAYIMA",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:35000,welfare:20000,shares:150000,joinDate:"2024-01-01"},
  {id:24,name:"NAKAZIBWE FAITH",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:25,name:"KASIIRA ZIRABA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:700000,welfare:360000,shares:300000,joinDate:"2024-01-01"},
  {id:26,name:"ZIRABA YUSUF",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:140000,welfare:80000,shares:200000,joinDate:"2024-01-01"},
  {id:27,name:"JULIET TIGATEGE",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:660000,welfare:400000,shares:300000,joinDate:"2024-01-01"},
  {id:28,name:"KATUKO ZOE",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:990000,welfare:480000,shares:300000,joinDate:"2024-01-01"},
  {id:29,name:"BOGERE SWALIK",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:30,name:"MUKOOBA JULIUS",email:"",whatsapp:"",membership:50000,annualSub:100000,monthlySavings:50000,welfare:40000,shares:100000,joinDate:"2024-01-01"},
  {id:31,name:"ZIRABA AIDHA",email:"",whatsapp:"",membership:50000,annualSub:100000,monthlySavings:50000,welfare:60000,shares:100000,joinDate:"2024-01-01"},
  {id:33,name:"KATUBE AZIAZ",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:60000,welfare:40000,shares:150000,joinDate:"2024-01-01"},
  {id:34,name:"TIBAKAWA SUZAN",email:"",whatsapp:"",membership:50000,annualSub:100000,monthlySavings:110000,welfare:40000,shares:100000,joinDate:"2024-01-01"},
  {id:35,name:"BALWANA JOHNNY",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:36,name:"MWASE PATRICK",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:200000,welfare:100000,shares:200000,joinDate:"2024-01-01"},
  {id:37,name:"NAMULONDO SHAMIRA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:140000,welfare:150000,shares:300000,joinDate:"2024-01-01"},
  {id:38,name:"NDIKUWA MISHA",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:240000,welfare:100000,shares:200000,joinDate:"2024-01-01"},
  {id:39,name:"BABIRYE OLIVIA",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:70000,welfare:80000,shares:100000,joinDate:"2024-01-01"},
  {id:40,name:"WAISWA DAMIENO",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:41,name:"BABIRYE REBECCA",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:42,name:"BALWANA SUZAN",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:43,name:"EDWARD BAZIRA",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:0,welfare:20000,shares:100000,joinDate:"2024-01-01"},
  {id:44,name:"ROBINA KALINAKI",email:"",whatsapp:"",membership:50000,annualSub:50000,monthlySavings:20000,welfare:0,shares:50000,joinDate:"2024-01-01"},
  {id:45,name:"BAKITA JOYCE",email:"",whatsapp:"",membership:50000,annualSub:200000,monthlySavings:300000,welfare:200000,shares:300000,joinDate:"2024-01-01"},
  {id:46,name:"MUNABI AGGREY",email:"",whatsapp:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:47,name:"NASONGOLA ARON",email:"",whatsapp:"",membership:50000,annualSub:20000,monthlySavings:0,welfare:0,shares:0,joinDate:"2024-01-01"},
  {id:48,name:"KAGODA MOSES",email:"",whatsapp:"",membership:50000,annualSub:150000,monthlySavings:50000,welfare:50000,shares:100000,joinDate:"2024-01-01"},
];

const INIT_LOANS = [
  {id:1,memberId:13,memberName:"KATUNTU HANNAH",dateBanked:"2025-09-01",amountLoaned:1000000,processingFeePaid:60000,datePaid:"",amountPaid:0,status:"active",term:12},
  {id:2,memberId:16,memberName:"MUKESI DAVID",dateBanked:"2025-09-01",amountLoaned:550000,processingFeePaid:55500,datePaid:"",amountPaid:0,status:"active",term:12},
  {id:3,memberId:28,memberName:"KATUKO ZOE",dateBanked:"2025-09-01",amountLoaned:1000000,processingFeePaid:60000,datePaid:"2025-09-30",amountPaid:1040000,status:"paid",term:12},
];

const INIT_INVESTMENTS = [];
const INIT_EXPENSES    = [];
const INIT_RECEIPTS    = [];
const INIT_PENDING     = []; // pending approvals queue

// ── AUTH — two users only ──
const USERS = {
  treasurer:     { role:"treasurer",     name:"Treasurer",       pin:"1234" },
  financemanager:{ role:"financemanager",name:"Finance Manager", pin:"5678" }
};
// Change PINs above before deploying!

const emptyInv = {
  id:null, platform:"", type:"unit_trust", amount:"", dateInvested:"",
  interestEarned:0, lastUpdated:"", status:"active", notes:""
};

const emptyE = {
  date: new Date().toISOString().split("T")[0],
  activity:"", amount:"", issuedBy:"", approvedBy:"", approverPhone:"", approverNIN:"",
  purpose:"", payMode:"cash", bankName:"", bankAccount:"", depositorName:"",
  mobileNumber:"", transactionId:"", category:"operations", categoryCustom:""
};
const emptyL = {
  memberId:"", memberName:"", dateBanked:"", amountLoaned:"", processingFeePaid:"",
  datePaid:"", amountPaid:0, status:"active", term:12,
  loanType:"personal", loanPurpose:"",
  borrowerPhone:"", borrowerAddress:"", borrowerNIN:"",
  guarantorName:"", guarantorPhone:"", guarantorAddress:"", guarantorNIN:"", guarantorMemberId:"",
  approvalStatus:"pending_treasurer", initiatedBy:"", approvedBy:"",
};
const emptyPay = {
  loanId:null, amount:"", date: new Date().toISOString().split("T")[0],
  payMode:"cash", bankName:"", bankAccount:"", depositorName:"",
  mobileNumber:"", transactionId:"", attachmentName:"", attachmentData:""
};



function Avatar({name,size=40}){
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
function buildWADueMsg(m,loan){const c=calcLoan(loan);const issued=new Date(loan.dateBanked);const due=new Date(issued.getFullYear(),issued.getMonth()+(loan.term||12),issued.getDate());const dueFmt=due.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});return `⚠️ Dear ${m.name.split(" ")[0]}, your BIDA Co-operative loan of ${fmt(loan.amountLoaned)} is due for full settlement on ${dueFmt}.\n\nBalance due: ${fmt(c.balance)}\nMonthly payment: ${fmt(c.monthlyPayment)}\n\nPlease arrange payment before the due date.\n— BIDA Co-operative Multi-Purpose Society`;}
function buildSMSSavingsMsg(m){const mn=MONTHS[new Date().getMonth()],yr=new Date().getFullYear();return `BIDA Coop: Dear ${m.name.split(" ")[0]}, your ${mn} ${yr} savings of ${fmt(m.monthlySavings)} is due by the 5th. Total: ${fmt(totBanked(m))}.`;}
function buildSMSLoanMsg(m,loan){const c=calcLoan(loan);return `BIDA Coop: Dear ${m.name.split(" ")[0]}, your loan balance is ${fmt(c.balance)}. Monthly pay: ${fmt(c.monthlyPayment)}. Total due: ${fmt(c.totalDue)}.`;}
function buildSMSDueMsg(m,loan,daysLeft){const c=calcLoan(loan);const issued=new Date(loan.dateBanked);const due=new Date(issued.getFullYear(),issued.getMonth()+(loan.term||12),issued.getDate());const dueFmt=due.toLocaleDateString("en-GB",{day:"numeric",month:"short"});return `BIDA Coop: Dear ${m.name.split(" ")[0]}, your loan of ${fmt(loan.amountLoaned)} is due ${dueFmt} (${daysLeft} days). Balance: ${fmt(c.balance)}. Please pay on time.`;}

function buildSavingsEmail(m){const mn=MONTHS[new Date().getMonth()],yr=new Date().getFullYear();return{subj:"BIDA Cooperative — "+mn+" "+yr+" Savings Reminder",body:"Dear "+m.name.split(" ")[0]+",\n\nYour monthly savings contribution of "+fmt(m.monthlySavings)+" is due by the 5th of "+mn+" "+yr+".\n\nYour contributions on record:\n  Membership:      "+fmt(m.membership)+"\n  Annual Sub:      "+fmt(m.annualSub)+"\n  Monthly Savings: "+fmt(m.monthlySavings)+"\n  Welfare:         "+fmt(m.welfare)+"\n  Shares:          "+fmt(m.shares)+"\n  ─────────────────────────\n  Total Banked:    "+fmt(totBanked(m))+"\n\nThank you,\nBIDA Co-operative Multi-Purpose Society\n"+toStr()};}
function buildLoanEmail(m,loan){const c=calcLoan(loan);return{subj:"BIDA Cooperative — Loan Settlement Reminder",body:"Dear "+m.name.split(" ")[0]+",\n\nThis is a reminder that you have an outstanding loan balance with BIDA Co-operative.\n\nLoan Details:\n  Principal:        "+fmt(loan.amountLoaned)+"\n  Issued:           "+fmtD(loan.dateBanked)+"\n  Months elapsed:   "+c.months+"\n  Monthly Payment:  "+fmt(c.monthlyPayment)+"\n  Total due:        "+fmt(c.totalDue)+"\n  ─────────────────────────\n  Outstanding:      "+fmt(c.balance)+"\n\nPlease arrange payment at your earliest convenience.\n\nBIDA Co-operative Multi-Purpose Society\n"+toStr()};}
function buildDueEmail(m,loan){const c=calcLoan(loan);const issued=new Date(loan.dateBanked);const due=new Date(issued.getFullYear(),issued.getMonth()+(loan.term||12),issued.getDate());const dueFmt=due.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});return{subj:"⚠️ BIDA Cooperative — Loan Due in 5 Days: "+dueFmt,body:"Dear "+m.name.split(" ")[0]+",\n\nThis is an automated reminder that your BIDA Co-operative loan is due for full settlement on "+dueFmt+".\n\nLoan Summary:\n  Principal:       "+fmt(loan.amountLoaned)+"\n  Monthly Payment: "+fmt(c.monthlyPayment)+"\n  ─────────────────────────\n  Balance Due:     "+fmt(c.balance)+"\n\nPlease ensure payment is made on or before the due date to avoid your account being marked overdue.\n\nBIDA Co-operative Multi-Purpose Society\n"+toStr()};}

async function shareViaPDF(blob, filename, memberName){
  if(navigator.canShare&&navigator.canShare({files:[new File([blob],filename,{type:"application/pdf"})]})){
    try{await navigator.share({files:[new File([blob],filename,{type:"application/pdf"})],title:"BIDA Cooperative — "+(memberName||"Report"),text:"Please find your BIDA Cooperative statement attached."});return "shared";}
    catch(e){if(e.name!=="AbortError")console.warn("Share failed:",e);return "cancelled";}
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  const msg=encodeURIComponent("Hi, please find your BIDA Co-operative statement — "+(memberName||"report")+" — just downloaded to your device.");
  window.open("https://wa.me/?text="+msg,"_blank");
  return "fallback";
}

// ── PDF GENERATION ──────────────────────────────────────────────────────────
async function generatePDF(type, members, loans, expenses, returnBlob=false){
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  const NAVY=[13,52,97],BLUE=[21,101,192],BLITE=[227,242,253],WHITE=[255,255,255],GREEN=[27,94,32],RED=[198,40,40],GREY=[94,127,160],ORANGE=[191,54,12];
  const dH=(title,sub)=>{doc.setFillColor(...NAVY);doc.rect(0,0,W,22,"F");doc.setFillColor(...BLUE);doc.rect(0,22,W,2,"F");doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...WHITE);doc.text("BIDA",12,10);doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(144,202,249);doc.text("CO-OPERATIVE MULTI-PURPOSE SOCIETY",12,16);doc.setFont("helvetica","bold");doc.setFontSize(13);doc.setTextColor(...WHITE);doc.text(title,W/2,10,{align:"center"});doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(187,222,251);doc.text(sub,W/2,16,{align:"center"});doc.setFontSize(7);doc.setTextColor(187,222,251);doc.text("Generated: "+toStr(),W-10,10,{align:"right"});doc.text("Confidential",W-10,16,{align:"right"});};
  const dF=(n)=>{doc.setFillColor(...BLITE);doc.rect(0,H-10,W,10,"F");doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);doc.text("BIDA Co-operative Multi-Purpose Society — Confidential",10,H-4);doc.text("Page "+n,W/2,H-4,{align:"center"});doc.text(toStr(),W-10,H-4,{align:"right"});};
  const sB=(x,y,w,h,lb,v,c)=>{doc.setFillColor(...BLITE);doc.roundedRect(x,y,w,h,2,2,"F");doc.setFillColor(...(c||BLUE));doc.roundedRect(x,y,3,h,1,1,"F");doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);doc.text(lb.toUpperCase(),x+6,y+5);doc.setFont("helvetica","bold");doc.setFontSize(9.5);doc.setTextColor(...NAVY);doc.text(v,x+6,y+11);};

  if(type==="savings"){
    const tM=members.reduce((s,m)=>s+(m.membership||0),0),tA=members.reduce((s,m)=>s+(m.annualSub||0),0),tS=members.reduce((s,m)=>s+(m.monthlySavings||0),0),tW=members.reduce((s,m)=>s+(m.welfare||0),0),tSh=members.reduce((s,m)=>s+(m.shares||0),0),grand=members.reduce((s,m)=>s+totBanked(m),0);
    dH("MEMBER SAVINGS REPORT","Savings & Contributions — "+toStr());
    sB(10,27,42,16,"Members",""+members.length,BLUE);sB(56,27,42,16,"Total Banked",fmt(grand),BLUE);sB(102,27,42,16,"Monthly Savings",fmt(tS),[25,118,210]);sB(148,27,42,16,"Total Shares",fmt(tSh),[30,136,229]);sB(194,27,42,16,"Welfare Pool",fmt(tW),[66,165,245]);sB(240,27,42,16,"Annual Subs",fmt(tA),[100,181,246]);
    const rows=members.map((m,i)=>[i+1,m.name,fmtN(m.membership),fmtN(m.annualSub),fmtN(m.monthlySavings),fmtN(m.welfare),fmtN(m.shares),fmtN(totBanked(m)),fmt(borrowLimit(m))]);
    rows.push(["","TOTAL",fmtN(tM),fmtN(tA),fmtN(tS),fmtN(tW),fmtN(tSh),fmtN(grand),"—"]);
    doc.autoTable({startY:48,head:[["#","Member Name","Membership","Annual Sub","Monthly Savings","Welfare","Shares","Total Banked","Max Borrow"]],body:rows,styles:{fontSize:7.5,cellPadding:2.5},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",halign:"center"},alternateRowStyles:{fillColor:[245,250,255]},columnStyles:{0:{halign:"center",cellWidth:8},1:{cellWidth:46,fontStyle:"bold"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right"},5:{halign:"right"},6:{halign:"right"},7:{halign:"right",fontStyle:"bold"},8:{halign:"right",textColor:BLUE}},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    if(returnBlob)return doc.output("blob");doc.save("BIDA_Savings_Report.pdf");
  } else if(type==="loans"){
    const calcs=loans.map(l=>({...l,...calcLoan(l)})),active=calcs.filter(l=>l.status!=="paid"),paid=calcs.filter(l=>l.status==="paid");
    dH("LOAN REGISTER REPORT","Disbursements & Repayments — 4% Flat (<7m) | 6% Reducing (≥7m)");
    sB(10,27,42,16,"Active",""+active.length,[191,54,12]);sB(56,27,42,16,"Disbursed",fmt(loans.reduce((s,l)=>s+(l.amountLoaned||0),0)),BLUE);sB(102,27,42,16,"Outstanding",fmt(active.reduce((s,l)=>s+l.balance,0)),RED);sB(148,27,42,16,"Int. Accrued",fmt(calcs.reduce((s,l)=>s+l.totalInterest,0)),[25,118,210]);sB(194,27,42,16,"Profit",fmt(paid.reduce((s,l)=>s+l.profit,0)),GREEN);sB(240,27,42,16,"Closed",""+paid.length,[46,125,50]);
    const rows=calcs.map((l,i)=>[i+1,l.memberName,fmtD(l.dateBanked),fmtN(l.amountLoaned),l.method==="reducing"?"6% RB":"4% Flat",l.term+"mo",fmtN(l.monthlyPayment),""+l.months,fmtN(l.totalInterest),fmtN(l.totalDue),fmtN(l.amountPaid),l.balance>0?"("+fmtN(l.balance)+")":fmtN(l.balance),l.status==="paid"?"PAID":"ACTIVE"]);
    doc.autoTable({startY:48,head:[["#","Member","Issued","Principal","Method","Term","Monthly Pay","Elapsed","Total Int.","Total Due","Paid","Balance","Status"]],body:rows,styles:{fontSize:7,cellPadding:2.2},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",fontSize:7,halign:"center"},alternateRowStyles:{fillColor:[245,250,255]},columnStyles:{0:{halign:"center",cellWidth:7},1:{cellWidth:34,fontStyle:"bold"},2:{halign:"center",cellWidth:19},3:{halign:"right"},4:{halign:"center",cellWidth:13},5:{halign:"center",cellWidth:11},6:{halign:"right",fontStyle:"bold"},7:{halign:"center"},8:{halign:"right"},9:{halign:"right",fontStyle:"bold"},10:{halign:"right"},11:{halign:"right"},12:{halign:"center"}},didParseCell:(d)=>{if(d.column.index===12&&d.section==="body"){d.cell.styles.fontStyle="bold";d.cell.styles.textColor=d.cell.raw==="PAID"?GREEN:[191,54,12];}if(d.column.index===11&&d.section==="body"&&typeof d.cell.raw==="string"&&d.cell.raw.startsWith("("))d.cell.styles.textColor=RED;},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    const fy=doc.lastAutoTable.finalY+6;doc.setFillColor(255,253,231);doc.roundedRect(10,fy,W-20,10,2,2,"F");doc.setFont("helvetica","bold");doc.setFontSize(7);doc.setTextColor(120,90,10);doc.text("INTEREST RULES:",15,fy+4);doc.setFont("helvetica","normal");doc.setTextColor(100,80,20);doc.text("Loans < UGX 7,000,000: 4% flat on original principal/mo. Loans ≥ UGX 7,000,000: 6% reducing balance on outstanding principal/mo. Terms 6–24 months.",52,fy+4);
    if(returnBlob)return doc.output("blob");doc.save("BIDA_Loans_Report.pdf");
  } else if(type==="expenses"){
    const totalExp=expenses.reduce((s,e)=>s+(+e.amount||0),0);
    const pool=members.reduce((s,m)=>s+totBanked(m),0);
    const profit=loans.filter(l=>l.status==="paid").reduce((s,l)=>s+calcLoan(l).profit,0);
    dH("EXPENSES REGISTER","Expenditure Record — "+toStr());
    sB(10,27,42,16,"Total Expenses",fmt(totalExp),RED);sB(56,27,42,16,"Fund Pool",fmt(pool),BLUE);sB(102,27,42,16,"Profit Realised",fmt(profit),GREEN);sB(148,27,42,16,"Net Balance",fmt(pool+profit-totalExp),[21,101,192]);sB(194,27,42,16,"Transactions",""+expenses.length,GREY);
    const catTotals={};expenses.forEach(e=>{catTotals[e.category]=(catTotals[e.category]||0)+(+e.amount||0);});
    const rows=expenses.map((e,i)=>{
      let payDetail=e.payMode==="cash"?"Cash":e.payMode==="bank"?`Bank Transfer — ${e.bankName||""} Acct: ${e.bankAccount||""}`:e.payMode==="mtn"?`MTN MoMo — ${e.mobileNumber||""}`:e.payMode==="airtel"?`Airtel Money — ${e.mobileNumber||""}`:e.payMode;
      return [i+1,fmtD(e.date),e.activity,e.purpose||"—",fmtN(+e.amount||0),e.issuedBy||"—",e.approvedBy||"—",payDetail,e.category];
    });
    rows.push(["","","TOTAL","",""+fmtN(totalExp),"","","",""]);
    doc.autoTable({startY:48,head:[["#","Date","Activity","Purpose","Amount (UGX)","Issued By","Approved By","Payment Method","Category"]],body:rows,styles:{fontSize:7,cellPadding:2.2},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",fontSize:7,halign:"center"},alternateRowStyles:{fillColor:[245,250,255]},columnStyles:{0:{halign:"center",cellWidth:7},1:{halign:"center",cellWidth:19},2:{cellWidth:38,fontStyle:"bold"},3:{cellWidth:32},4:{halign:"right",fontStyle:"bold"},5:{cellWidth:24},6:{cellWidth:24},7:{cellWidth:38},8:{cellWidth:20}},didParseCell:(d)=>{if(d.column.index===4&&d.section==="body")d.cell.styles.textColor=RED;},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    if(returnBlob)return doc.output("blob");doc.save("BIDA_Expenses_Report.pdf");
  } else if(type==="projections"){
    const tM=members.reduce((s,m)=>s+(m.monthlySavings||0),0),gT=members.reduce((s,m)=>s+totBanked(m),0),aL=loans.filter(l=>l.status!=="paid"),out=aL.reduce((s,l)=>s+calcLoan(l).balance,0),tP=loans.filter(l=>l.status==="paid").reduce((s,l)=>s+calcLoan(l).profit,0),aI=aL.reduce((s,l)=>s+calcLoan(l).monthlyInt,0);
    dH("12-MONTH FINANCIAL PROJECTIONS","Forward-Looking Forecast — Savings Growth, Interest Income & Fund Pool");
    sB(10,27,42,16,"Current Pool",fmt(gT),BLUE);sB(56,27,42,16,"Monthly Savings",fmt(tM),[25,118,210]);sB(102,27,42,16,"Active Int/Mo",fmt(aI),RED);sB(148,27,42,16,"Outstanding",fmt(out),RED);sB(194,27,42,16,"Profit To Date",fmt(tP),GREEN);sB(240,27,42,16,"Avg Loan",fmt(loans.length?Math.round(loans.reduce((s,l)=>s+(l.amountLoaned||0),0)/loans.length):0),BLUE);
    const sm=new Date().getMonth();let pool=gT;const rows=[];
    for(let i=0;i<12;i++){const mi=(sm+i)%12,yr=new Date().getFullYear()+Math.floor((sm+i)/12),prev=pool;pool+=tM+aI;rows.push([MONTHS[mi]+" "+yr,fmtN(tM),fmtN(aI),fmtN(tM+aI),fmtN(Math.round(pool)),(((tM+aI)/prev)*100).toFixed(1)+"%"]);}
    doc.autoTable({startY:50,head:[["Month","New Savings","Interest Income","Total Inflow","Cumulative Pool","Growth"]],body:rows,styles:{fontSize:8,cellPadding:2.8},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",halign:"center"},alternateRowStyles:{fillColor:[245,250,255]},columnStyles:{0:{fontStyle:"bold",cellWidth:42},1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right",fontStyle:"bold"},5:{halign:"center"}},didParseCell:(d)=>{if(d.column.index===5&&d.section==="body"){d.cell.styles.textColor=GREEN;d.cell.styles.fontStyle="bold";}if(d.column.index===4&&d.section==="body")d.cell.styles.textColor=BLUE;},margin:{left:10,right:10},didDrawPage:(d)=>dF(d.pageNumber)});
    if(returnBlob)return doc.output("blob");doc.save("BIDA_Projections_Report.pdf");
  }
}

async function generateMemberPDF(member, memberLoans, allMembers, returnBlob=false){
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  const NAVY=[13,52,97],BLUE=[21,101,192],BLITE=[227,242,253],WHITE=[255,255,255],GREEN=[27,94,32],RED=[198,40,40],GREY=[94,127,160];
  doc.setFillColor(...NAVY);doc.rect(0,0,W,30,"F");doc.setFillColor(...BLUE);doc.rect(0,30,W,2,"F");
  doc.setFont("helvetica","bold");doc.setFontSize(16);doc.setTextColor(...WHITE);doc.text("BIDA",14,13);
  doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(144,202,249);doc.text("CO-OPERATIVE MULTI-PURPOSE SOCIETY",14,19);
  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...WHITE);doc.text("MEMBER STATEMENT",W/2,12,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(187,222,251);doc.text("Individual Financial Summary — Confidential",W/2,19,{align:"center"});
  doc.setFontSize(7);doc.setTextColor(187,222,251);doc.text("Generated: "+toStr(),W-12,12,{align:"right"});
  const tb=totBanked(member);
  const allTotals=allMembers.map(m=>totBanked(m)).sort((a,b)=>b-a);
  const rank=allTotals.indexOf(tb)+1;
  const pct=((tb/allTotals.reduce((s,v)=>s+v,0))*100).toFixed(1);
  const lim=borrowLimit(member);
  doc.setFillColor(...BLITE);doc.roundedRect(12,37,W-24,26,3,3,"F");
  doc.setFont("helvetica","bold");doc.setFontSize(13);doc.setTextColor(...NAVY);doc.text(member.name,16,46);
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(...GREY);
  doc.text("Member ID: #"+member.id+" · Joined: "+(member.joinDate?new Date(member.joinDate).toLocaleDateString("en-GB",{month:"long",year:"numeric"}):"—"),16,52);
  doc.text("Rank: #"+rank+" of "+allMembers.length+" members · "+pct+"% of fund pool",16,57);
  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...BLUE);doc.text("Total: "+fmt(tb),W-14,48,{align:"right"});
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(GREEN[0],GREEN[1],GREEN[2]);doc.text("Max Borrow: "+fmt(lim),W-14,56,{align:"right"});
  doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...NAVY);doc.text("SAVINGS BREAKDOWN",14,70);
  doc.autoTable({startY:74,head:[["Category","Amount (UGX)"]],body:[["Membership Fee",fmtN(member.membership)],["Annual Subscription",fmtN(member.annualSub)],["Monthly Savings",fmtN(member.monthlySavings)],["Welfare",fmtN(member.welfare)],["Shares",fmtN(member.shares)],["TOTAL BANKED",fmtN(tb)]],styles:{fontSize:9,cellPadding:3},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold"},columnStyles:{0:{cellWidth:100},1:{halign:"right",fontStyle:"bold"}},didParseCell:(d)=>{if(d.row.index===5&&d.section==="body"){d.cell.styles.fillColor=BLITE;d.cell.styles.textColor=BLUE;d.cell.styles.fontStyle="bold";}},margin:{left:14,right:14}});
  if(memberLoans.length>0){
    const lY=doc.lastAutoTable.finalY+8;
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...NAVY);doc.text("LOAN HISTORY",14,lY);
    const lRows=memberLoans.map(l=>[fmtD(l.dateBanked),fmtN(l.amountLoaned),l.method==="reducing"?"6% RB":"4% Flat",l.term+"mo",fmtN(l.monthlyPayment),fmtN(l.totalInterest),fmtN(l.totalDue),fmtN(l.amountPaid),l.balance>0?"("+fmtN(l.balance)+")":"—",l.status==="paid"?"PAID":"ACTIVE"]);
    doc.autoTable({startY:lY+4,head:[["Issued","Principal","Method","Term","Monthly Pay","Interest","Total Due","Paid","Balance","Status"]],body:lRows,styles:{fontSize:8,cellPadding:2.5},headStyles:{fillColor:NAVY,textColor:WHITE,fontStyle:"bold",halign:"center"},columnStyles:{9:{halign:"center",fontStyle:"bold"}},didParseCell:(d)=>{if(d.column.index===9&&d.section==="body"){d.cell.styles.textColor=d.cell.raw==="PAID"?GREEN:RED;}},margin:{left:14,right:14}});
  }
  const avgTotal=Math.round(allTotals.reduce((s,v)=>s+v,0)/allMembers.length);
  const fY=doc.lastAutoTable?doc.lastAutoTable.finalY+8:160;
  doc.setFillColor(232,245,233);doc.roundedRect(14,fY,W-28,14,2,2,"F");
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(...GREY);
  doc.text("Your total vs. average member: "+fmt(tb)+" vs "+fmt(avgTotal)+" · Rank #"+rank+"/"+allMembers.length,16,fY+6);
  const diff=tb-avgTotal;
  doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(diff>=0?GREEN[0]:RED[0],diff>=0?GREEN[1]:RED[1],diff>=0?GREEN[2]:RED[2]);
  doc.text((diff>=0?"▲ +":"▼ ")+fmt(Math.abs(diff))+" vs average",16,fY+11);
  doc.setFillColor(...BLITE);doc.rect(0,H-10,W,10,"F");
  doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...GREY);
  doc.text("BIDA Co-operative Multi-Purpose Society — Member Confidential Statement",12,H-4);
  doc.text(toStr(),W-12,H-4,{align:"right"});
  if(returnBlob)return doc.output("blob");
  doc.save("BIDA_Statement_"+member.name.replace(/\s+/g,"_")+".pdf");
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
.bpaid{background:var(--okbg);color:var(--ok);}
.bactive{background:var(--wbg);color:var(--warn);}
.bover{background:#fce4ec;color:#c62828;}
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
.prof-loan-card.lactive{border-color:#ffcc80;}
.prof-loan-card.loverdue{border-color:#ef9a9a;}

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
    <div className={"prof-loan-card"+(l.status!=="paid"?ov?" loverdue":" lactive":"")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div>
          <span style={{fontWeight:800,color:"var(--b800)",fontSize:13}}>{fmt(l.amountLoaned)}</span>
          <span style={{fontSize:10,color:"var(--tmuted)",marginLeft:8,fontFamily:"var(--mono)"}}>Agreed: {l.term}mo term</span>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:700,color:l.method==="reducing"?"#1565c0":"#37474f",background:l.method==="reducing"?"#e3f2fd":"#eceff1",borderRadius:9,padding:"2px 7px"}}>{l.method==="reducing"?"6% Reducing":"4% Flat"}</span>
          <span className={"badge "+(l.status==="paid"?"bpaid":l.months>l.term?"bover":"bactive")}>{l.status==="paid"?"✓ Paid":l.months>l.term?"⚠ Overdue":"● Active"}</span>
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
      {l.status!=="paid"&&<div style={{display:"flex",gap:6}}>
        <button className="btn bk sm" onClick={function(){markPd(l.id);}}>✓ Settle</button>
        <button className="btn bg sm" onClick={function(){closeProfile();openEditL(l);}}>✏️ Edit</button>
      </div>}
    </div>
  );
}

function TermSelectorButtons({lF, setLF}){
  const terms = [6,9,12,18,24];
  const base = {amountLoaned:+lF.amountLoaned, dateBanked:lF.dateBanked||new Date().toISOString().split("T")[0], status:"active", amountPaid:0};
  const bestInt = calcLoan({...base, term:6}).totalInterest;
  return terms.map(function(t){
    const preview = calcLoan({...base, term:t});
    const isSelected = (+lF.term||12)===t;
    const extraInt = preview.totalInterest - bestInt;
    const color = t<=6?"#1b5e20":t<=12?"#1565c0":t<=18?"#e65100":"#b71c1c";
    return (
      <button key={t} onClick={function(){setLF(function(f){return {...f,term:t};});}}
        style={{flex:1,minWidth:88,padding:"8px 5px",borderRadius:9,border:isSelected?"2px solid "+color:"2px solid #e0e0e0",background:isSelected?color+"18":"#fff",cursor:"pointer",textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:800,color:isSelected?color:"#555"}}>{t} mo</div>
        <div style={{fontSize:10,fontWeight:700,color:isSelected?color:"#888",marginTop:2,fontFamily:"var(--mono)"}}>{fmt(preview.monthlyPayment)}<span style={{fontWeight:400}}>/mo</span></div>
        {t>6?<div style={{fontSize:9,color:color,marginTop:1}}>+{fmt(extraInt)} extra</div>:<div style={{fontSize:9,color:"#1b5e20",marginTop:1}}>✓ Best value</div>}
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
  const bestCase = calcLoan({amountLoaned:+lF.amountLoaned, dateBanked:lF.dateBanked||new Date().toISOString().split("T")[0], status:"active", amountPaid:0, term:6});
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

export default function App(){
  const [tab,setTab]        = useState("savings");
  const [authUser,setAuthUser] = useState(null); // null = logged out
  const [loginPin,setLoginPin] = useState("");
  const [loginRole,setLoginRole] = useState("treasurer");
  const [loginErr,setLoginErr]   = useState("");
  const [members,setMembers]= useState(INIT_MEMBERS);
  const [loans,setLoans]    = useState(INIT_LOANS);
  const [expenses,setExpenses] = useState(INIT_EXPENSES);
  const [receipts,setReceipts] = useState(INIT_RECEIPTS);
  const [pending,setPending]   = useState(INIT_PENDING);
  const [investments,setInvestments] = useState(INIT_INVESTMENTS);
  const [dbLoading,setDbLoading] = useState(true);

  useEffect(function(){
    async function loadAll(){
      try {
        const [mRows,lRows,eRows,iRows] = await Promise.all([
          supa.get("members"), supa.get("loans"),
          supa.get("expenses"), supa.get("investments")
        ]);
        if(Array.isArray(mRows) && mRows.length>0){
          setMembers(mRows.map(dbToMember));
        } else {
          await Promise.all(INIT_MEMBERS.map(function(m){ return supa.upsert("members",memberToDb(m)); }));
        }
        if(Array.isArray(lRows) && lRows.length>0){
          setLoans(lRows.map(dbToLoan));
        } else if(INIT_LOANS.length>0){
          await Promise.all(INIT_LOANS.map(function(l){ return supa.upsert("loans",Object.assign({},loanToDb(l),{id:l.id})); }));
        }
        if(Array.isArray(eRows) && eRows.length>0) setExpenses(eRows.map(dbToExpense));
        if(Array.isArray(iRows) && iRows.length>0) setInvestments(iRows.map(dbToInv));
      } catch(err){ console.error("Supabase load error:",err); }
      finally { setDbLoading(false); }
    }
    loadAll();
  },[]);
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
  const [addMF,setAddMF]    = useState({name:"",email:"",whatsapp:"",phone:"",address:"",nin:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:new Date().toISOString().split("T")[0],payMode:"cash",bankName:"",bankAccount:"",depositorName:"",mobileNumber:"",transactionId:""});

  const loansCalc = useMemo(()=>loans.map(l=>({...l,...calcLoan(l)})),[loans]);
  const fmems  = useMemo(()=>members.filter(m=>m.name.toLowerCase().includes(search.toLowerCase())),[members,search]);
  const floans = useMemo(()=>loansCalc.filter(l=>l.memberName.toLowerCase().includes(search.toLowerCase())),[loansCalc,search]);
  const savT   = useMemo(()=>({
    membership:members.reduce((s,m)=>s+(m.membership||0),0),
    annualSub:members.reduce((s,m)=>s+(m.annualSub||0),0),
    monthly:members.reduce((s,m)=>s+(m.monthlySavings||0),0),
    welfare:members.reduce((s,m)=>s+(m.welfare||0),0),
    shares:members.reduce((s,m)=>s+(m.shares||0),0),
    total:members.reduce((s,m)=>s+totBanked(m),0)
  }),[members]);
  const lStat = useMemo(()=>{
    const act=loansCalc.filter(l=>l.status!=="paid"),pdd=loansCalc.filter(l=>l.status==="paid");
    return{act:act.length,disbursed:loans.reduce((s,l)=>s+(l.amountLoaned||0),0),outstanding:act.reduce((s,l)=>s+l.balance,0),intAccrued:loansCalc.reduce((s,l)=>s+l.totalInterest,0),profit:pdd.reduce((s,l)=>s+l.profit,0)};
  },[loansCalc,loans]);

  const totalExpenses  = useMemo(()=>expenses.reduce((s,e)=>s+(+e.amount||0),0),[expenses]);
  const netCash        = useMemo(()=>savT.total+lStat.profit-totalExpenses,[savT.total,lStat.profit,totalExpenses]);
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
    const updated={...profF,phone:profF.phone||"",nin:profF.nin||"",address:profF.address||"",whatsapp:profF.whatsapp||"",membership:+profF.membership||0,annualSub:+profF.annualSub||0,monthlySavings:+profF.monthlySavings||0,welfare:+profF.welfare||0,shares:+profF.shares||0};
    setMembers(prev=>prev.map(m=>m.id===profId?{...m,...updated}:m));
    supa.upsert("members",memberToDb({...updated,id:profId}));
    setProfEdit(false);
  };
  const optOutMember=()=>{
    supa.del("members",profId);
    setLoans(prev=>prev.filter(l=>l.memberId!==profId));
    setMembers(prev=>prev.filter(m=>m.id!==profId));
    closeProfile();
  };
  const saveInv=()=>{
    if(!invF.platform||!invF.amount)return;
    const rec={...invF,amount:+invF.amount||0,interestEarned:+invF.interestEarned||0};
    if(editInv){
      setInvestments(prev=>prev.map(i=>i.id===editInv?{...i,...rec}:i));
      supa.update("investments",editInv,invToDb(rec));
    } else {
      supa.upsert("investments",invToDb(rec)).then(function(){ supa.get("investments").then(function(rows){ if(Array.isArray(rows))setInvestments(rows.map(dbToInv)); }); });
    }
    setInvModal(false);setEditInv(null);setInvF({...emptyInv,dateInvested:new Date().toISOString().split("T")[0]});
  };
  const delInv=function(id){ if(window.confirm("Delete this investment record?")){ setInvestments(prev=>prev.filter(i=>i.id!==id)); supa.del("investments",id); } };
  const openAddInv=()=>{setEditInv(null);setInvF({...emptyInv,dateInvested:new Date().toISOString().split("T")[0]});setInvModal(true);};
  const openEditInv=(inv)=>{setEditInv(inv.id);setInvF({...inv});setInvModal(true);};
  const saveAddM=()=>{
    if(!addMF.name.trim())return;
    const id=Math.max(...members.map(m=>m.id),0)+1;
    const newM={id,...addMF,whatsapp:addMF.whatsapp||"",membership:+addMF.membership||0,annualSub:+addMF.annualSub||0,monthlySavings:+addMF.monthlySavings||0,welfare:+addMF.welfare||0,shares:+addMF.shares||0};
    setMembers(prev=>[...prev,newM]);
    supa.upsert("members",memberToDb(newM));
    setAddMModal(false);
    setAddMF({name:"",email:"",whatsapp:"",phone:"",address:"",nin:"",membership:50000,annualSub:0,monthlySavings:0,welfare:0,shares:0,joinDate:new Date().toISOString().split("T")[0],payMode:"cash",bankName:"",bankAccount:"",depositorName:"",mobileNumber:"",transactionId:""});
  };
  const openPayModal=(loan)=>{setPayF({...emptyPay,loanId:loan.id,date:new Date().toISOString().split("T")[0]});setPayModal(true);};
  const savePay=()=>{
    if(!payF.amount||!payF.loanId)return;
    const amt=+payF.amount||0;
    setLoans(prev=>prev.map(function(l){
      if(l.id!==payF.loanId)return l;
      const newPaid=(l.amountPaid||0)+amt;
      const calc=calcLoan({...l,amountPaid:newPaid});
      const nowPaid=calc.balance<=0;
      const updated={...l,amountPaid:newPaid,status:nowPaid?"paid":l.status,datePaid:nowPaid?(payF.date||new Date().toISOString().split("T")[0]):l.datePaid};
      supa.update("loans",l.id,loanToDb(updated));
      return updated;
    }));
    setPayModal(false);setPayF({...emptyPay});
  };
  const openAddL=()=>{setEditL(null);setLF({...emptyL});setLModal(true);};
  const openEditL=(l)=>{setEditL(l.id);setLF({...l});setLModal(true);};
  const onAmt=(v)=>{const a=+v||0;setLF(f=>({...f,amountLoaned:v,processingFeePaid:Math.round(procFee(a))}));};
  const saveL=()=>{
    const a=+lF.amountLoaned||0;
    const p={...lF,amountLoaned:a,processingFeePaid:+lF.processingFeePaid||Math.round(procFee(a)),amountPaid:+lF.amountPaid||0};
    const mem=members.find(m=>m.id===+lF.memberId);
    if(mem)p.memberName=mem.name;
    if(!p.memberName)return;
    if(editL){
      setLoans(prev=>prev.map(l=>l.id===editL?{...l,...p}:l));
      supa.update("loans",editL,loanToDb(p));
    } else {
      supa.upsert("loans",loanToDb(p)).then(function(){ supa.get("loans").then(function(rows){ if(Array.isArray(rows))setLoans(rows.map(dbToLoan)); }); });
    }
    setLModal(false);
  };
  const delL=function(id){ if(window.confirm("Delete this loan?")){ setLoans(prev=>prev.filter(l=>l.id!==id)); supa.del("loans",id); } };
  const markPd=(id)=>{
    setLoans(prev=>prev.map(function(l){
      if(l.id!==id)return l;
      const dp=new Date().toISOString().split("T")[0];
      const c=calcLoan({...l,datePaid:dp,status:"paid"});
      const updated={...l,status:"paid",amountPaid:c.totalDue,datePaid:dp};
      supa.update("loans",id,loanToDb(updated));
      return updated;
    }));
  };
  const openAddExp=()=>{setEditExp(null);setExpF({...emptyE});setExpModal(true);};
  const openEditExp=(e)=>{setEditExp(e.id);setExpF({...e});setExpModal(true);};
  const saveExp=()=>{
    if(!expF.activity||!expF.activity.trim()||!expF.amount)return;
    const rec={...expF,amount:+expF.amount||0};
    if(editExp){
      setExpenses(prev=>prev.map(e=>e.id===editExp?{...e,...rec}:e));
      supa.update("expenses",editExp,expenseToDb(rec));
    } else {
      supa.upsert("expenses",expenseToDb(rec)).then(function(){ supa.get("expenses").then(function(rows){ if(Array.isArray(rows))setExpenses(rows.map(dbToExpense)); }); });
    }
    setExpModal(false);
    setEditExp(null);
    setExpF({...emptyE,date:new Date().toISOString().split("T")[0]});
  };
  const delExp=function(id){ if(window.confirm("Delete this expense?")){ setExpenses(prev=>prev.filter(e=>e.id!==id)); supa.del("expenses",id); } };

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

  const sendSavingsEmail=async(m)=>{const key="sav_"+m.id;const{subj,body}=buildSavingsEmail(m);const blob=await generateMemberPDF(m,loansCalc.filter(l=>l.memberId===m.id),members,true);await dispatchEmail(key,m.email,subj,body,blob,"BIDA_Statement_"+m.name.replace(/\s+/g,"_")+".pdf");};
  const sendLoanEmail=async(mem,loan)=>{const key="loan_"+loan.id;const{subj,body}=buildLoanEmail(mem,loan);const blob=await generateMemberPDF(mem,loansCalc.filter(l=>l.memberId===mem.id),members,true);await dispatchEmail(key,mem.email,subj,body,blob,"BIDA_Loan_"+mem.name.replace(/\s+/g,"_")+".pdf");};
  const sendDueEmail=async(mem,loan)=>{const key="due_"+loan.id;const{subj,body}=buildDueEmail(mem,loan);const blob=await generateMemberPDF(mem,loansCalc.filter(l=>l.memberId===mem.id),members,true);await dispatchEmail(key,mem.email,subj,body,blob,"BIDA_Due_"+mem.name.replace(/\s+/g,"_")+".pdf");};
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
    try{
      const filenames={savings:"BIDA_Savings_Report.pdf",loans:"BIDA_Loans_Report.pdf",expenses:"BIDA_Expenses_Report.pdf",projections:"BIDA_Projections_Report.pdf"};
      const labels={savings:"Savings Report",loans:"Loans Report",expenses:"Expenses Report",projections:"Projections Report"};
      const blob=await generatePDF(type,members,loans,expenses,true);
      const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filenames[type];a.click();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
      setSharedPDF({blob,filename:filenames[type],label:labels[type],type});
    }catch(e){alert("PDF error: "+e.message);}
    finally{setPdfGen(null);}
  };
  const handleMemberPDF=async(m)=>{
    setPdfGen("member_"+m.id);setSharedPDF(null);
    try{
      const filename="BIDA_Statement_"+m.name.replace(/\s+/g,"_")+".pdf";
      const blob=await generateMemberPDF(m,profLoans,members,true);
      const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
      setSharedPDF({blob,filename,label:m.name+" Statement",type:"member",memberId:m.id});
    }catch(e){alert("PDF error: "+e.message);}
    finally{setPdfGen(null);}
  };

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

  const doLogin=()=>{
    const u=USERS[loginRole];
    if(u&&loginPin===u.pin){setAuthUser({...u});setLoginErr("");setLoginPin("");}
    else{setLoginErr("Incorrect PIN. Try again.");}
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
                {[["treasurer","🏦 Treasurer"],["financemanager","✅ Finance Manager"]].map(([r,lbl])=>(
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
      {dbLoading&&<div style={{position:"fixed",inset:0,background:"linear-gradient(135deg,var(--b900),var(--b700))",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:999}}>
        <div style={{width:48,height:48,border:"4px solid rgba(255,255,255,.2)",borderTop:"4px solid #fff",borderRadius:"50%",animation:"sp .8s linear infinite",marginBottom:16}}/>
        <div style={{color:"#fff",fontSize:14,fontWeight:600,letterSpacing:1}}>Loading BIDA data...</div>
      </div>}
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
            <button onClick={()=>setAuthUser(null)} style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.2)",borderRadius:8,padding:"4px 10px",color:"#fff",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"var(--mono)"}}>
              {authUser?.role==="treasurer"?"🏦":"✅"} {authUser?.name} · Logout
            </button>
          </div>
          <div className="hdr-nav">
            <nav className="nav">
              <button className={"nbtn"+(tab==="savings"?" on":"")} onClick={()=>{setTab("savings");setSearch("");}}>💰 Savings</button>
              <button className={"nbtn"+(tab==="loans"?" on":"")} onClick={()=>{setTab("loans");setSearch("");}}>📋 Loans</button>
              <button className={"nbtn"+(tab==="reminders"?" on":"")} onClick={()=>{setTab("reminders");setSearch("");}}>
                ✉️ Remind{dueSoonLoans.length>0&&<span style={{background:"#ef5350",color:"#fff",borderRadius:"50%",fontSize:9,fontWeight:900,padding:"1px 5px",marginLeft:4}}>{dueSoonLoans.length}</span>}
              </button>
              <button className={"nbtn"+(tab==="expenses"?" on":"")} onClick={()=>{setTab("expenses");setSearch("");}}>🧾 Expenses</button>
              <button className={"nbtn"+(tab==="investments"?" on":"")} onClick={()=>{setTab("investments");setSearch("");}}>📈 Invest</button>
              <button className={"nbtn"+(tab==="reports"?" on":"")} onClick={()=>{setTab("reports");setSearch("");}}>📄 Reports</button>
            </nav>
          </div>
        </header>

        <main className="main">

          {/* ── SAVINGS TAB ──────────────────────────────────────────────── */}
          {tab==="savings" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>Member Savings Ledger</div>
              <div className="stats">
                <div className="card"><div className="clabel">Members</div><div className="cval">{members.length}</div></div>
                <div className="card ck"><div className="clabel">Total Banked</div><div className="cval ok">{fmt(savT.total)}</div></div>
                <div className="card"><div className="clabel">Monthly Savings</div><div className="cval">{fmt(savT.monthly)}</div></div>
                <div className="card"><div className="clabel">Shares</div><div className="cval">{fmt(savT.shares)}</div></div>
                <div className="card"><div className="clabel">Welfare Pool</div><div className="cval">{fmt(savT.welfare)}</div></div>
                {totalInvInterest>0&&<div className="card ck"><div className="clabel">Investment Returns</div><div className="cval ok">{fmt(totalInvInterest)}</div><div className="csub">40% to members · 60% retained</div></div>}
                {distributableInterest>0&&<div className="card ck"><div className="clabel">To Distribute (40%)</div><div className="cval ok">{fmt(distributableInterest)}</div></div>}
              </div>
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
                        <td style={{fontFamily:"var(--mono)",fontSize:11,color:"#1565c0",fontWeight:700}}>{fmt(borrowLimit(m))}</td>
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
                  <strong>Interest Rules (automatic):</strong> Loans under UGX 7,000,000 → 4% flat on original principal/mo, 6–24 month flexible term. Loans UGX 7,000,000+ → 6% reducing balance, fixed 12-month term.
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
                      return (
                        <tr key={l.id}>
                          <td className="sn">{i+1}</td>
                          <td>
                            <span className="nc" onClick={()=>{const m=members.find(m=>m.id===l.memberId);if(m){setTab("savings");setTimeout(()=>openProfile(m),50);}}}>{l.memberName}</span>
                            {l.status!=="paid"&&<button className="btn bk xs" style={{marginLeft:6,fontSize:9}} onClick={()=>openPayModal(l)}>+ Pay</button>}
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
                            <button className="btn bg xs" onClick={()=>openEditL(l)}>✏️</button>
                            {l.status!=="paid"&&<button className="btn bk xs" onClick={()=>markPd(l.id)}>✓</button>}
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

          {/* ── REMINDERS TAB ────────────────────────────────────────────── */}
          {tab==="reminders" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>Reminders & Notifications</div>

              {emailSetup&&(
                <div className="setup-banner">
                  <h3>⚙️ API not connected — follow these steps to enable one-click sending</h3>
                  <ol>
                    <li>Create a free <a href="https://sendgrid.com" target="_blank" rel="noreferrer">SendGrid</a> account → Settings → API Keys → copy key</li>
                    <li>In <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Vercel</a> → Settings → Environment Variables, add:<br/><code>SENDGRID_API_KEY</code>, <code>FROM_EMAIL</code> = bidacoop@gmail.com, <code>FROM_NAME</code> = BIDA Cooperative</li>
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
              <div className="stats">
                <div className="card ck"><div className="clabel">Fund Pool</div><div className="cval ok">{fmt(savT.total)}</div></div>
                <div className="card cd"><div className="clabel">Total Expenses</div><div className="cval danger">{fmt(totalExpenses)}</div></div>
                <div className="card ck"><div className="clabel">Profit Realised</div><div className="cval ok">{fmt(lStat.profit)}</div></div>
                <div className="card"  style={{borderTop:"3px solid var(--b500)"}}><div className="clabel">Net Cash Balance</div><div className={"cval"+(netCash<0?" danger":"")}>{fmt(netCash)}</div><div className="csub">Pool + Profit − Expenses</div></div>
                <div className="card cw"><div className="clabel">Transactions</div><div className="cval warn">{expenses.length}</div></div>
              </div>
              <div className="toolbar">
                <div className="tl"><span className="ttitle">Expenses</span><span className="tcount">{expenses.length}</span></div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  <button className="btn bpdf sm" onClick={()=>handlePDF("expenses")} disabled={!!pdfGen}>{pdfGen==="expenses"?"⏳...":"📥 PDF"}</button>
                  <button className="btn bp sm" onClick={openAddExp}>＋ Add Expense</button>
                </div>
              </div>
              <div style={{background:"#fff",border:"1px solid var(--bdr)",borderRadius:12,padding:"4px 16px"}}>
                {expenses.length===0&&<div className="empty"><div className="eico">🧾</div>No expenses recorded yet. Click + Add Expense to begin.</div>}
                {[...expenses].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>(
                  <div key={e.id} className="exp-row">
                    <div className="exp-date">{fmtD(e.date)}</div>
                    <div className="exp-main">
                      <div className="exp-activity">{e.activity}</div>
                      <div className="exp-meta">
                        {e.purpose&&<span>📌 {e.purpose} &nbsp;</span>}
                        <span>Issued by: <strong>{e.issuedBy||"—"}</strong> &nbsp;</span>
                        <span>Approved: <strong>{e.approvedBy||"—"}</strong></span>
                        <br/>
                        {e.payMode==="cash"&&<span className="exp-mode mode-cash">💵 Cash</span>}
                        {e.payMode==="bank"&&<span className="exp-mode mode-bank">🏦 Bank Transfer{e.bankName?" — "+e.bankName:""}{e.bankAccount?" Acct: "+e.bankAccount:""}</span>}
                        {e.payMode==="mtn"&&<span className="exp-mode mode-mtn">📱 MTN MoMo{e.mobileNumber?" — "+e.mobileNumber:""}</span>}
                        {e.payMode==="airtel"&&<span className="exp-mode mode-airtel">📱 Airtel Money{e.mobileNumber?" — "+e.mobileNumber:""}</span>}
                        {e.category&&<span style={{marginLeft:6,fontSize:9,background:"var(--b100)",color:"var(--b700)",borderRadius:7,padding:"1px 6px",fontFamily:"var(--mono)"}}>{e.category}</span>}
                      </div>
                    </div>
                    <div className="exp-amount">− {fmt(+e.amount||0)}</div>
                    <div className="exp-actions">
                      <button className="btn bg xs" onClick={()=>openEditExp(e)}>✏️</button>
                      <button className="btn bd xs" onClick={()=>delExp(e.id)}>🗑</button>
                    </div>
                  </div>
                ))}
                {expenses.length>0&&(
                  <div style={{borderTop:"2px solid var(--bdr2)",padding:"10px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontFamily:"var(--mono)",fontSize:11,fontWeight:700,color:"var(--tmuted)"}}>TOTAL EXPENSES</span>
                    <span style={{fontFamily:"var(--mono)",fontSize:15,fontWeight:900,color:"#c62828"}}>− {fmt(totalExpenses)}</span>
                  </div>
                )}
              </div>
            </React.Fragment>
          )}

          {/* ── INVESTMENTS TAB ──────────────────────────────────────────── */}
          {tab==="investments" && (
            <React.Fragment>
              <div className="ptitle"><div className="ptdot"/>Investment Portfolio</div>
              <div className="stats">
                <div className="card ck"><div className="clabel">Total Invested</div><div className="cval ok">{fmt(totalInvested)}</div><div className="csub">Active positions</div></div>
                <div className="card ck"><div className="clabel">Total Interest Earned</div><div className="cval ok">{fmt(totalInvInterest)}</div></div>
                <div className="card"><div className="clabel">Retained (60%)</div><div className="cval">{fmt(retainedInterest)}</div><div className="csub">Reinvested in pool</div></div>
                <div className="card ck"><div className="clabel">To Members (40%)</div><div className="cval ok">{fmt(distributableInterest)}</div><div className="csub">By savings share</div></div>
                <div className="card"><div className="clabel">Fund Pool</div><div className="cval">{fmt(savT.total)}</div></div>
                <div className="card"><div className="clabel">Positions</div><div className="cval">{investments.length}</div></div>
              </div>

              {distributableInterest>0&&(
                <div style={{background:"linear-gradient(135deg,#1b5e20,#2e7d32)",borderRadius:12,padding:"12px 16px",marginBottom:14,color:"#fff"}}>
                  <div style={{fontWeight:800,fontSize:13,marginBottom:6}}>📊 Member Dividend Distribution (40% of Interest)</div>
                  <div style={{fontSize:11,opacity:.85,marginBottom:8}}>Each member's share based on their % of total pool. 60% ({fmt(retainedInterest)}) retained to grow the fund.</div>
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
                <div className="card ck"><div className="clabel">Net Balance</div><div className="cval ok">{fmt(netCash)}</div></div>
              </div>
              {sharedPDF&&sharedPDF.type!=="member"&&(
                <div style={{background:"#e8f5e9",border:"1.5px solid #a5d6a7",borderRadius:11,padding:"12px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:"#1b5e20"}}>✅ {sharedPDF.label} ready</div>
                    <div style={{fontSize:11,color:"#2e7d32",marginTop:2}}>Downloaded · Share via WhatsApp below</div>
                  </div>
                  <button className="btn" style={{background:"#25D366",color:"#fff",fontWeight:700}} onClick={()=>shareViaPDF(sharedPDF.blob,sharedPDF.filename,sharedPDF.label)}>
                    {WA_SVG} Share via WhatsApp
                  </button>
                </div>
              )}
            </React.Fragment>
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
                {!profEdit&&sharedPDF&&sharedPDF.type==="member"&&sharedPDF.memberId===profMember.id&&(
                  <button className="btn sm" style={{background:"#25D366",color:"#fff",fontWeight:700}} onClick={()=>shareViaPDF(sharedPDF.blob,sharedPDF.filename,profMember.name)}>
                    {WA_SVG} WA
                  </button>
                )}
                {!profEdit&&<button className="btn bg sm" onClick={()=>setProfEdit(true)}>✏️ Edit</button>}
                <button className="mclose" onClick={closeProfile}>✕</button>
              </div>
            </div>
            {!profEdit?(
              <React.Fragment>
                <div className="prof-hero">
                  <Avatar name={profMember.name} size={46}/>
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
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.6)",marginBottom:2}}>TOTAL BANKED</div>
                    <div style={{fontSize:19,fontWeight:900,color:"#fff"}}>{fmt(totBanked(profMember))}</div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,.6)",marginTop:4}}>{profPct}% of pool</div>
                    <div style={{marginTop:8,borderTop:"1px solid rgba(255,255,255,.15)",paddingTop:7}}>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.5)",marginBottom:2,letterSpacing:.5,textTransform:"uppercase"}}>{totBanked(profMember)<1000000?"×1.5 limit":"×2 limit"}</div>
                      <div style={{fontSize:15,fontWeight:900,color:"#90caf9"}}>{fmt(borrowLimit(profMember))}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,.4)",marginTop:1}}>max borrow</div>
                    </div>
                  </div>
                </div>
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
                <div className="prof-section">
                  <div className="prof-section-title">Pool Contribution vs Peers</div>
                  <div className="prof-bar-wrap">
                    <div className="prof-bar-label"><span>Share of fund pool</span><span style={{fontWeight:700,color:"var(--b700)"}}>{profPct}%</span></div>
                    <div className="prof-bar-track"><div className="prof-bar-fill" style={{width:Math.min(parseFloat(profPct)*4,100)+"%"}}/></div>
                  </div>
                  <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                    {[["Pool Total",fmt(savT.total)],["Avg/Member",fmt(Math.round(savT.total/members.length))],["Rank","#"+profRank+"/"+members.length],["vs Avg",(totBanked(profMember)>=Math.round(savT.total/members.length)?"+":"")+fmt(totBanked(profMember)-Math.round(savT.total/members.length))],["Max Borrow",fmt(borrowLimit(profMember))]].map(([lb,v])=>(
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
                        {profMember.whatsapp&&<React.Fragment><a className="btn bwa sm" href={waLink(profMember.whatsapp,buildWASavingsMsg(profMember))} target="_blank" rel="noreferrer">{WA_SVG}WA Text</a>
                        <button className="btn bwa sm" style={{background:"#128C7E"}} disabled={!!pdfGen} onClick={async()=>{const blob=await generateMemberPDF(profMember,profLoans,members,true);shareViaPDF(blob,"BIDA_Statement_"+profMember.name.replace(/\s+/g,"_")+".pdf",profMember.name);}}>{WA_SVG}WA PDF</button>
                        <button className="btn bsms sm" disabled={emailSending["sms_sav_"+profMember.id]==="sending"} onClick={()=>sendSavingsSMS(profMember)}>{emailSending["sms_sav_"+profMember.id]==="sending"?"⏳...":"📱 SMS"}</button></React.Fragment>}
                      </div>
                    </div>
                    {profLoans.filter(l=>l.status!=="paid").map(l=>(
                      <div key={l.id} style={{background:"#fff8e1",border:"1px solid #ffcc80",borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                        <div style={{fontSize:10,color:"#bf360c",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:.6,marginBottom:6}}>Loan Reminder · Balance {fmt(l.balance)}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {profMember.email&&<button className="btn bemail sm" disabled={emailSending["loan_"+l.id]==="sending"} onClick={()=>sendLoanEmail(profMember,l)}>{emailSending["loan_"+l.id]==="sending"?"⏳...":"📨 Email"}</button>}
                          {profMember.whatsapp&&<React.Fragment><a className="btn bwa sm" href={waLink(profMember.whatsapp,buildWALoanMsg(profMember,l))} target="_blank" rel="noreferrer">{WA_SVG}WA Text</a>
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
                </div>
                <div className="div"/>
                <div className="crow"><span className="cl">Total Banked</span><span className="cv ok">{fmt((+profF.membership||0)+(+profF.annualSub||0)+(+profF.monthlySavings||0)+(+profF.welfare||0)+(+profF.shares||0))}</span></div>
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
              {/* Personal details */}
              <div className="fg ff"><label className="fl">Full Name</label><input className="fi" value={addMF.name} onChange={e=>setAddMF(f=>({...f,name:e.target.value}))} placeholder="e.g. KATUNTU HANNAH"/></div>
              <div className="fg"><label className="fl">Telephone</label><input className="fi" type="tel" value={addMF.phone} onChange={e=>setAddMF(f=>({...f,phone:e.target.value}))} placeholder="0772 000 000"/></div>
              <div className="fg"><label className="fl">WhatsApp</label><input className="fi" type="tel" value={addMF.whatsapp} onChange={e=>setAddMF(f=>({...f,whatsapp:e.target.value}))} placeholder="0772 000 000"/><span className="fhint">07XX or 256XX</span></div>
              <div className="fg ff"><label className="fl">Email</label><input className="fi" type="email" value={addMF.email} onChange={e=>setAddMF(f=>({...f,email:e.target.value}))} placeholder="member@example.com"/></div>
              <div className="fg"><label className="fl">National ID Number (NIN)</label><input className="fi" value={addMF.nin} onChange={e=>setAddMF(f=>({...f,nin:e.target.value}))} placeholder="NIN e.g. CM90001234..."/></div>
              <div className="fg"><label className="fl">Join Date</label><input className="fi" type="date" value={addMF.joinDate} onChange={e=>setAddMF(f=>({...f,joinDate:e.target.value}))}/></div>
              <div className="fg ff"><label className="fl">Physical Address</label><input className="fi" value={addMF.address} onChange={e=>setAddMF(f=>({...f,address:e.target.value}))} placeholder="Village, Parish, District"/></div>

              {/* Contributions */}
              <div className="fg ff"><div style={{fontSize:10,fontWeight:700,color:"var(--b700)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:1,margin:"4px 0 2px",borderTop:"1px solid var(--bdr)",paddingTop:10}}>💰 Initial Contributions</div></div>
              {[["Membership Fee","membership"],["Annual Sub","annualSub"],["Monthly Savings","monthlySavings"],["Welfare","welfare"],["Shares","shares"]].map(([lb,k])=>(
                <div className="fg" key={k}><label className="fl">{lb} (UGX)</label><input className="fi" type="number" value={addMF[k]} onChange={e=>setAddMF(f=>({...f,[k]:e.target.value}))} placeholder="0"/></div>
              ))}

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
            <div className="mhdr"><div className="mtitle">{editInv?"Update Investment":"Add Investment"}</div><button className="mclose" onClick={()=>setInvModal(false)}>✕</button></div>
            <div className="fgrid">
              <div className="fg ff"><label className="fl">Platform / Fund Name</label><input className="fi" value={invF.platform} onChange={e=>setInvF(f=>({...f,platform:e.target.value}))} placeholder="e.g. UAP, Britam, Stanbic Treasury Bond"/></div>
              <div className="fg ff"><label className="fl">Investment Type</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:4}}>
                  {[["unit_trust","📦 Unit Trust"],["treasury_bond","🏛 Treasury Bond"],["fixed_deposit","🏦 Fixed Deposit"],["money_market","💹 Money Market"],["other","📋 Other"]].map(([v,lbl])=>(
                    <button key={v} onClick={()=>setInvF(f=>({...f,type:v}))} style={{flex:1,minWidth:110,padding:"7px 6px",borderRadius:9,border:invF.type===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:invF.type===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:11,fontWeight:invF.type===v?700:400,color:invF.type===v?"var(--b700)":"var(--tm)"}}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="fg"><label className="fl">Amount Invested (UGX)</label><input className="fi" type="number" value={invF.amount} onChange={e=>setInvF(f=>({...f,amount:e.target.value}))} placeholder="0"/></div>
              <div className="fg"><label className="fl">Date Invested</label><input className="fi" type="date" value={invF.dateInvested} onChange={e=>setInvF(f=>({...f,dateInvested:e.target.value}))}/></div>
              <div className="fg"><label className="fl" style={{color:"#1b5e20"}}>Interest Earned (UGX)</label><input className="fi" value={invF.interestEarned} onChange={e=>setInvF(f=>({...f,interestEarned:e.target.value}))} placeholder="0" style={{borderColor:"#a5d6a7"}}/><span className="fhint">Update this regularly as returns come in</span></div>
              <div className="fg"><label className="fl">Last Updated</label><input className="fi" type="date" value={invF.lastUpdated} onChange={e=>setInvF(f=>({...f,lastUpdated:e.target.value}))}/></div>
              <div className="fg ff"><label className="fl">Status</label>
                <div style={{display:"flex",gap:8,marginTop:4}}>
                  {[["active","● Active"],["closed","◼ Closed"]].map(([v,lbl])=>(
                    <button key={v} onClick={()=>setInvF(f=>({...f,status:v}))} style={{flex:1,padding:"8px",borderRadius:9,border:invF.status===v?"2px solid var(--b600)":"2px solid var(--bdr)",background:invF.status===v?"var(--b100)":"#fff",cursor:"pointer",fontSize:12,fontWeight:invF.status===v?700:400}}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="fg ff"><label className="fl">Notes</label><input className="fi" value={invF.notes} onChange={e=>setInvF(f=>({...f,notes:e.target.value}))} placeholder="e.g. 12-month bond at 17% p.a."/></div>
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
                <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:8,padding:"8px 12px",marginTop:8,fontSize:11,color:"#5d4037"}}>
                  ⚠️ Recording this investment will deduct <strong>{fmt(+invF.amount||0)}</strong> from the fund pool. Ensure committee approval before proceeding.
                </div>
              </React.Fragment>
            )}
            <div className="fa"><button className="btn bg" onClick={()=>setInvModal(false)}>Cancel</button><button className="btn bp" onClick={saveInv}>{editInv?"Save Changes":"Record Investment"}</button></div>
          </div>
        </div>
      )}

      {expModal&&(
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setExpModal(false)}>
          <div className="modal wide">
            <div className="mhdr"><div className="mtitle">{editExp?"Edit Expense":"Record Expense"}</div><button className="mclose" onClick={()=>setExpModal(false)}>✕</button></div>
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

              {/* Issued By */}
              <div className="fg"><label className="fl">Issued / Paid By</label><input className="fi" value={expF.issuedBy} onChange={e=>setExpF(f=>({...f,issuedBy:e.target.value}))} placeholder="Full name of payer"/></div>
              <div className="fg">
                <label className="fl" style={{color:"#1b5e20"}}>Approved By</label>
                <input className="fi" value={expF.approvedBy} onChange={e=>setExpF(f=>({...f,approvedBy:e.target.value}))} placeholder="Name of approving official" style={{borderColor:"#a5d6a7"}}/>
              </div>
              <div className="fg"><label className="fl" style={{color:"#1b5e20"}}>Approver Telephone</label><input className="fi" type="tel" value={expF.approverPhone} onChange={e=>setExpF(f=>({...f,approverPhone:e.target.value}))} placeholder="0772 000 000" style={{borderColor:"#a5d6a7"}}/></div>
              <div className="fg"><label className="fl" style={{color:"#1b5e20"}}>Approver NIN</label><input className="fi" value={expF.approverNIN} onChange={e=>setExpF(f=>({...f,approverNIN:e.target.value}))} placeholder="NIN e.g. CM90001234..." style={{borderColor:"#a5d6a7"}}/></div>

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
              ⚠️ This expense reduces net cash balance by <strong>{expF.amount?fmt(+expF.amount):"UGX 0"}</strong>. New balance: <strong>{fmt(netCash-(editExp?0:+expF.amount||0))}</strong>
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
                <select className="fi" value={lF.memberId} onChange={e=>{const m=members.find(m=>m.id===+e.target.value);const lim=m?borrowLimit(m):0;const fee=m?procFee(lim):0;setLF(f=>({...f,memberId:e.target.value,memberName:m?m.name:"",amountLoaned:m?lim:"",processingFeePaid:m?Math.round(fee):"",borrowerPhone:m?.phone||m?.whatsapp||"",borrowerAddress:m?.address||"",borrowerNIN:m?.nin||""}));}}>
                  <option value="">— Select member —</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name} — limit {fmt(borrowLimit(m))}</option>)}
                </select>
              </div>
              <div className="fg"><label className="fl">Date Issued</label><input className="fi" type="date" value={lF.dateBanked} onChange={e=>setLF(f=>({...f,dateBanked:e.target.value}))}/></div>
              <div className="fg">
                <label className="fl">Principal (UGX)</label>
                <input className="fi" type="number" value={lF.amountLoaned} onChange={e=>onAmt(e.target.value)} placeholder="0"/>
                <LoanLimitBadge memberId={lF.memberId} members={members} amountLoaned={lF.amountLoaned}/>
              </div>
              <div className="fg"><label className="fl">Processing Fee</label><input className="fi" type="number" value={lF.processingFeePaid} onChange={e=>setLF(f=>({...f,processingFeePaid:e.target.value}))}/><span className="fhint">Auto: 50,000 + 1%</span></div>
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
            <div className="fa"><button className="btn bg" onClick={()=>setLModal(false)}>Cancel</button><button className="btn bp" onClick={saveL}>{editL?"Save Changes":"Issue Loan"}</button></div>
          </div>
        </div>
      )}
      </React.Fragment>}
    </React.Fragment>
  );
}
