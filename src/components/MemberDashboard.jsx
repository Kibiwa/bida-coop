import React, { useState, useEffect, useCallback } from "react";
import { db, fmt, fmtD } from "../utils/supabase.js";
import VotingPanel  from "./VotingPanel.jsx";
import PaymentModal from "./PaymentModal.jsx";

function Card({ label, value, sub, color="#1565c0", icon="" }) {
  return (
    <div style={{background:"#fff",borderRadius:14,padding:"14px 16px",borderLeft:"4px solid "+color,boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
      <div style={{fontSize:10,color:"#90a4ae",textTransform:"uppercase",letterSpacing:.7,fontFamily:"monospace",marginBottom:4}}>{icon} {label}</div>
      <div style={{fontSize:18,fontWeight:900,color,fontFamily:"monospace"}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:"#90a4ae",marginTop:3}}>{sub}</div>}
    </div>
  );
}

function LoanCard({ loan }) {
  const p=loan.amountLoaned||0, paid=loan.amountPaid||0;
  const isR=p>=7000000, rate=isR?.06:.04, term=isR?12:(loan.term||12);
  let ti=0;
  if(isR){let b=p;for(let i=0;i<term;i++){ti+=Math.round(b*rate);b-=Math.round(p/term);}}
  else ti=Math.round(p*rate*term);
  const bal=Math.max(0,p+ti-paid), pct=p+ti>0?Math.round(paid/(p+ti)*100):0;
  return (
    <div style={{background:"#fff",borderRadius:12,padding:"14px 16px",marginBottom:10,border:"1px solid #e3f2fd"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:"#0d2a5e"}}>Loan #{loan.id}</div>
          <div style={{fontSize:11,color:"#90a4ae"}}>Issued {fmtD(loan.dateBanked)} · {term} months</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontWeight:800,fontSize:14,color:bal>0?"#e65100":"#1b5e20",fontFamily:"monospace"}}>{fmt(bal)}</div>
          <div style={{fontSize:10,color:"#90a4ae"}}>balance</div>
        </div>
      </div>
      <div style={{background:"#eceff1",borderRadius:99,height:6}}>
        <div style={{height:6,width:pct+"%",background:pct>=100?"#2e7d32":"#1565c0",borderRadius:99}}/>
      </div>
      <div style={{fontSize:10,color:"#90a4ae",marginTop:4}}>{pct}% repaid · {fmt(p+ti)} total</div>
    </div>
  );
}

function ContribRow({ c }) {
  const LABS={monthlySavings:"Monthly Savings",welfare:"Welfare",annualSub:"Annual Sub",membership:"Membership",shares:"Shares",voluntaryDeposit:"Voluntary Deposit"};
  const COLS={monthlySavings:"#1565c0",welfare:"#2e7d32",annualSub:"#e65100",membership:"#6a1b9a",shares:"#00695c",voluntaryDeposit:"#546e7a"};
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f5f5f5"}}>
      <div>
        <div style={{fontSize:12,fontWeight:600,color:"#263238"}}>{LABS[c.category]||c.category}</div>
        <div style={{fontSize:10,color:"#90a4ae"}}>{fmtD(c.date)}{c.note?" · "+c.note:""}</div>
      </div>
      <div style={{fontWeight:800,fontSize:13,color:COLS[c.category]||"#546e7a",fontFamily:"monospace"}}>{fmt(c.amount)}</div>
    </div>
  );
}

function Skel() {
  return <div style={{background:"linear-gradient(90deg,#eceff1 25%,#e3f2fd 50%,#eceff1 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.4s infinite",borderRadius:10,height:80,marginBottom:10}}/>;
}

export default function MemberDashboard({ session, onLogout }) {
  const [m,      setM]      = useState(null);
  const [loans,  setLoans]  = useState([]);
  const [cl,     setCl]     = useState([]);
  const [polls,  setPolls]  = useState([]);
  const [tab,    setTab]    = useState("overview");
  const [load,   setLoad]   = useState(true);
  const [err,    setErr]    = useState(null);
  const [showPay,setShowPay]= useState(false);

  const fetch_ = useCallback(async () => {
    if(!session?.memberId) return;
    setLoad(true); setErr(null);
    try {
      const [ms,ls,cs,ps]=await Promise.all([
        db.get("members","id=eq."+session.memberId),
        db.get("loans","memberId=eq."+session.memberId+"&order=id.desc"),
        db.get("contrib_log","memberId=eq."+session.memberId+"&order=date.desc&limit=20").catch(()=>[]),
        db.get("polls","status=eq.active").catch(()=>[]),
      ]);
      setM(ms?.[0]||null); setLoans(ls||[]); setCl(cs||[]); setPolls(ps||[]);
    } catch(e) { setErr("Could not load your data. Check your connection."); }
    finally { setLoad(false); }
  },[session]);

  useEffect(()=>{fetch_();},[fetch_]);

  const total  = m?(m.membership||0)+(m.annualSub||0)+(m.monthlySavings||0)+(m.welfare||0)+(m.shares||0)+(m.voluntaryDeposit||0):0;
  const active = loans.filter(l=>l.status!=="paid");
  const lbal   = active.reduce((s,l)=>{
    const p=l.amountLoaned||0,paid=l.amountPaid||0,isR=p>=7000000,rate=isR?.06:.04,term=isR?12:(l.term||12);
    let ti=0;if(isR){let b=p;for(let i=0;i<term;i++){ti+=Math.round(b*rate);b-=Math.round(p/term);}}else ti=Math.round(p*rate*term);
    return s+Math.max(0,p+ti-paid);
  },0);
  const sUnits = m?Math.round((m.shares||0)/50000):0;

  const TABS=[["overview","📊 Overview"],["loans","💳 Loans"],["history","📋 History"],["votes","🗳 Voting"+(polls.length?" ("+polls.length+")":"")]];

  return (
    <div style={{minHeight:"100vh",background:"#f0f4f8",fontFamily:"'Outfit',sans-serif"}}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0d2a5e,#1565c0)",color:"#fff",padding:"14px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:900,fontSize:18,letterSpacing:1.5}}>BIDA</div>
            <div style={{fontSize:11,opacity:.7}}>Member Portal</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontWeight:700,fontSize:13}}>{session.memberName||"Member"}</div>
              <div style={{fontSize:10,opacity:.6}}>ID #{session.memberId}</div>
            </div>
            <button onClick={onLogout} style={{background:"rgba(255,255,255,.2)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>Sign Out</button>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{background:"#fff",display:"flex",gap:4,padding:"8px 14px",overflowX:"auto",borderBottom:"1px solid #e8eaf6"}}>
        {TABS.map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 14px",border:"none",borderRadius:9,cursor:"pointer",fontWeight:tab===id?700:500,fontSize:12,background:tab===id?"#e3f2fd":"transparent",color:tab===id?"#1565c0":"#78909c",whiteSpace:"nowrap"}}>{lbl}</button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:620,margin:"0 auto"}}>
        {err&&<div style={{background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:10,padding:"12px 14px",marginBottom:14,fontSize:13,color:"#c62828"}}>⚠ {err} <button onClick={fetch_} style={{marginLeft:8,background:"none",border:"none",color:"#1565c0",fontWeight:700,cursor:"pointer"}}>Retry</button></div>}

        {/* ── OVERVIEW ── */}
        {tab==="overview"&&<>
          <div style={{background:"linear-gradient(135deg,#0d2a5e,#1565c0)",borderRadius:18,padding:"22px 20px",marginBottom:14,color:"#fff"}}>
            <div style={{fontSize:11,opacity:.7,textTransform:"uppercase",letterSpacing:.8,fontFamily:"monospace"}}>Total Banked</div>
            {load?<div style={{height:38,background:"rgba(255,255,255,.2)",borderRadius:8,marginTop:8}}/>
                 :<div style={{fontSize:30,fontWeight:900,fontFamily:"monospace",marginTop:6}}>{fmt(total)}</div>}
            <div style={{fontSize:11,opacity:.6,marginTop:6}}>Member since {fmtD(m?.joinDate)}</div>
          </div>

          {load?<>{[0,1,2,3].map(i=><Skel key={i}/>)}</>:
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            <Card icon="💰" label="Monthly Savings" value={fmt(m?.monthlySavings||0)} color="#1565c0"/>
            <Card icon="📈" label="Share Units" value={sUnits+" units"} sub={fmt(m?.shares||0)} color="#00695c"/>
            <Card icon="💳" label="Loan Balance" value={fmt(lbal)} color={lbal>0?"#e65100":"#2e7d32"}/>
            <Card icon="🤝" label="Welfare Fund" value={fmt(m?.welfare||0)} color="#6a1b9a"/>
          </div>}

          {!load&&m&&<div style={{background:"#fff",borderRadius:14,padding:"16px 18px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#0d2a5e",textTransform:"uppercase",letterSpacing:.7,fontFamily:"monospace",marginBottom:12}}>Savings Breakdown</div>
            {[["Membership","membership","#6a1b9a"],["Annual Sub","annualSub","#e65100"],["Monthly Savings","monthlySavings","#1565c0"],["Welfare","welfare","#2e7d32"],["Shares","shares","#00695c"],["Voluntary","voluntaryDeposit","#546e7a"]].filter(([,k])=>(m[k]||0)>0).map(([lbl,k,col])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #f5f5f5"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:"50%",background:col}}/><span style={{fontSize:12,color:"#546e7a"}}>{lbl}</span></div>
                <span style={{fontSize:12,fontWeight:800,color:col,fontFamily:"monospace"}}>{fmt(m[k])}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 0",borderTop:"2px solid #e3f2fd",marginTop:4}}>
              <span style={{fontSize:13,fontWeight:800,color:"#0d2a5e"}}>Total</span>
              <span style={{fontSize:15,fontWeight:900,color:"#1565c0",fontFamily:"monospace"}}>{fmt(total)}</span>
            </div>
          </div>}

          {!load&&cl.length>0&&<div style={{background:"#fff",borderRadius:14,padding:"16px 18px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#0d2a5e",textTransform:"uppercase",letterSpacing:.7,fontFamily:"monospace",marginBottom:10}}>Recent Contributions</div>
            {cl.slice(0,5).map((c,i)=><ContribRow key={i} c={c}/>)}
            {cl.length>5&&<button onClick={()=>setTab("history")} style={{background:"none",border:"none",color:"#1565c0",cursor:"pointer",fontSize:12,fontWeight:700,marginTop:8,padding:0}}>View all {cl.length} →</button>}
          </div>}

          {!load&&polls.length>0&&<div onClick={()=>setTab("votes")} style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:12,padding:"12px 16px",marginBottom:14,cursor:"pointer"}}>
            <div style={{fontWeight:700,color:"#1b5e20",fontSize:13}}>🗳 {polls.length} active poll{polls.length>1?"s":""} — Cast your vote!</div>
            <div style={{fontSize:11,color:"#388e3c",marginTop:3}}>Tap to view →</div>
          </div>}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <button onClick={()=>setShowPay(true)} style={{background:"#fff",border:"1.5px solid #e3f2fd",borderRadius:14,padding:"16px 12px",cursor:"pointer",textAlign:"center"}}>
              <div style={{fontSize:24,marginBottom:4}}>📲</div>
              <div style={{fontSize:12,fontWeight:700,color:"#0d2a5e"}}>Make Payment</div>
              <div style={{fontSize:10,color:"#90a4ae",marginTop:2}}>MTN / Airtel MoMo</div>
            </button>
            <button onClick={()=>alert("Contact your SACCO manager:\n📧 bidacooperative@gmail.com")} style={{background:"#fff",border:"1.5px solid #e3f2fd",borderRadius:14,padding:"16px 12px",cursor:"pointer",textAlign:"center"}}>
              <div style={{fontSize:24,marginBottom:4}}>📄</div>
              <div style={{fontSize:12,fontWeight:700,color:"#0d2a5e"}}>Statement</div>
              <div style={{fontSize:10,color:"#90a4ae",marginTop:2}}>Request PDF</div>
            </button>
          </div>
        </>}

        {/* ── LOANS ── */}
        {tab==="loans"&&<>
          {load?<Skel/>:loans.length===0
            ?<div style={{textAlign:"center",padding:"40px 20px",color:"#90a4ae"}}><div style={{fontSize:36}}>🏦</div><div style={{fontWeight:700,marginTop:10}}>No loans on record</div></div>
            :loans.map(l=><LoanCard key={l.id} loan={l}/>)}
        </>}

        {/* ── HISTORY ── */}
        {tab==="history"&&<div style={{background:"#fff",borderRadius:14,padding:"16px 18px",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0d2a5e",textTransform:"uppercase",letterSpacing:.7,fontFamily:"monospace",marginBottom:12}}>Contribution History</div>
          {load?<Skel/>:cl.length===0
            ?<div style={{textAlign:"center",padding:30,color:"#90a4ae"}}>No records found</div>
            :cl.map((c,i)=><ContribRow key={i} c={c}/>)}
        </div>}

        {/* ── VOTING ── */}
        {tab==="votes"&&<VotingPanel memberId={session.memberId} polls={polls} onRefresh={setPolls}/>}

        <div style={{textAlign:"center",padding:"20px 0 8px",fontSize:10,color:"#b0bec5"}}>BIDA Co-operative Multi-Purpose Society</div>
      </div>

      {showPay&&m&&<PaymentModal member={m} onClose={()=>setShowPay(false)}/>}
    </div>
  );
}
