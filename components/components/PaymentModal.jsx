import React, { useState } from "react";
import { db, fmt } from "../utils/supabase.js";

function normPhone(raw){
  const d=raw.replace(/[\s\-().+]/g,"");
  if(/^256\d{9}$/.test(d))return d;
  if(/^0\d{9}$/.test(d))return "256"+d.slice(1);
  if(/^\d{9}$/.test(d))return "256"+d;
  return null;
}

const PURPOSES=[
  {v:"monthly_savings",l:"💰 Monthly Savings"},
  {v:"annual_sub",     l:"📋 Annual Subscription"},
  {v:"welfare",        l:"🤝 Welfare Contribution"},
  {v:"shares",         l:"📈 Share Purchase"},
  {v:"loan_repayment", l:"💳 Loan Repayment"},
];

export default function PaymentModal({ member, onClose }) {
  const [method,  setMethod]  = useState("mtn");
  const [phone,   setPhone]   = useState(member?.whatsapp||member?.phone||"");
  const [amount,  setAmount]  = useState("");
  const [purpose, setPurpose] = useState("monthly_savings");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState("");
  const [done,    setDone]    = useState(null);

  const submit = async () => {
    setErr("");
    const n=normPhone(phone); if(!n){setErr("Enter a valid Uganda phone number");return;}
    const amt=parseInt(String(amount).replace(/\D/g,""),10);
    if(!amt||amt<1000){setErr("Minimum UGX 1,000");return;}
    if(amt>5000000){setErr("Maximum UGX 5,000,000 per payment");return;}
    setBusy(true);
    try {
      let ref=null;
      try {
        const r=await fetch("/api/initiate-payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({memberId:member.id,phone:n,amount:amt,purpose,method})});
        if(r.ok){const d=await r.json();ref=d.reference||d.externalRef;}
      } catch {}
      if(!ref){
        ref="PAY-"+Date.now()+"-"+member.id;
        await db.insert("payment_requests",{member_id:member.id,amount:amt,payment_method:method,phone:n,reference:ref,purpose,status:"pending",metadata:{memberName:member.name}});
      }
      setDone({amt,phone:n,method,ref});
    } catch(e){setErr(e.message);}
    finally{setBusy(false);}
  };

  const S={
    ov:{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:9999,padding:16},
    sh:{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:500,padding:"24px 20px",maxHeight:"90vh",overflowY:"auto"},
    lb:{fontSize:10,fontWeight:700,color:"#78909c",textTransform:"uppercase",letterSpacing:.7,display:"block",marginBottom:6,fontFamily:"monospace"},
    in:{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #cfd8dc",fontSize:15,outline:"none",boxSizing:"border-box"},
    btn:(d)=>({width:"100%",padding:13,borderRadius:10,border:"none",fontWeight:700,fontSize:15,cursor:d?"not-allowed":"pointer",background:d?"#cfd8dc":"linear-gradient(135deg,#1b5e20,#2e7d32)",color:d?"#90a4ae":"#fff"}),
  };

  if(done) return (
    <div style={S.ov} onClick={onClose}>
      <div style={S.sh} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",padding:"20px 0"}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <div style={{fontWeight:800,fontSize:18,color:"#1b5e20"}}>Payment Request Sent</div>
          <div style={{fontSize:13,color:"#546e7a",marginTop:8,lineHeight:1.6}}>
            {fmt(done.amt)} payment request sent to {done.phone}.<br/>
            {done.method==="mtn"?"Approve the MTN MoMo prompt on your phone.":"Approve the Airtel Money prompt on your phone."}
          </div>
          <div style={{fontSize:10,color:"#90a4ae",marginTop:10,fontFamily:"monospace"}}>Ref: {done.ref}</div>
          <button onClick={onClose} style={{marginTop:20,background:"#e8f5e9",border:"none",color:"#1b5e20",fontWeight:700,padding:"10px 28px",borderRadius:10,cursor:"pointer",fontSize:13}}>Done</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.ov} onClick={onClose}>
      <div style={S.sh} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:17,color:"#0d2a5e"}}>Make a Payment</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#90a4ae"}}>✕</button>
        </div>
        <div style={{marginBottom:16}}>
          <label style={S.lb}>Payment Method</label>
          <div style={{display:"flex",gap:10}}>
            {[["mtn","🟡 MTN MoMo"],["airtel","🔴 Airtel Money"]].map(([v,l])=>(
              <button key={v} onClick={()=>setMethod(v)} style={{flex:1,padding:11,borderRadius:10,fontWeight:method===v?700:400,border:"2px solid "+(method===v?"#1565c0":"#cfd8dc"),background:method===v?"#e3f2fd":"#fff",cursor:"pointer",fontSize:13,color:method===v?"#0d47a1":"#546e7a"}}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:16}}>
          <label style={S.lb}>{method==="mtn"?"MTN":"Airtel"} Phone Number</label>
          <input style={S.in} type="tel" placeholder="0772 123 456" value={phone} onChange={e=>setPhone(e.target.value)}/>
        </div>
        <div style={{marginBottom:16}}>
          <label style={S.lb}>Purpose</label>
          <select style={S.in} value={purpose} onChange={e=>setPurpose(e.target.value)}>
            {PURPOSES.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </div>
        <div style={{marginBottom:16}}>
          <label style={S.lb}>Amount (UGX)</label>
          <input style={S.in} type="number" placeholder="e.g. 50000" value={amount} onChange={e=>setAmount(e.target.value)}/>
          {amount&&!isNaN(+amount)&&<div style={{fontSize:11,color:"#1565c0",marginTop:5,fontFamily:"monospace"}}>{fmt(+amount)}</div>}
        </div>
        {err&&<div style={{background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:9,padding:"9px 12px",fontSize:12,color:"#c62828",marginBottom:12}}>{err}</div>}
        <button style={S.btn(busy||!amount)} onClick={submit} disabled={busy||!amount}>
          {busy?"⏳ Processing…":"Pay "+(!isNaN(+amount)&&+amount?fmt(+amount):"")+" →"}
        </button>
        <div style={{fontSize:10,color:"#90a4ae",textAlign:"center",marginTop:10}}>You will receive a prompt to approve the payment on your phone</div>
      </div>
    </div>
  );
}
