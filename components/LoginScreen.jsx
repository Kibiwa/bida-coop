import React, { useState, useEffect, useRef } from "react";
import { db, fingerprint } from "../utils/supabase.js";

function norm(raw) {
  const d = raw.replace(/[\s\-().+]/g,"");
  if (/^256\d{9}$/.test(d))  return d;
  if (/^0\d{9}$/.test(d))    return "256"+d.slice(1);
  if (/^\d{9}$/.test(d))     return "256"+d;
  return null;
}

function OTPBoxes({ value, onChange, onDone, disabled }) {
  const refs = useRef([]);
  const dig  = value.padEnd(6," ").split("").slice(0,6);
  const set  = (i,ch) => { const n=[...dig]; n[i]=ch; onChange(n.join("")); };

  return (
    <div style={{display:"flex",gap:8,justifyContent:"center"}}>
      {[0,1,2,3,4,5].map(i=>(
        <input key={i} ref={el=>refs.current[i]=el}
          type="text" inputMode="numeric" maxLength={1}
          value={dig[i]?.trim()||""} disabled={disabled}
          onChange={e=>{
            const ch=e.target.value.replace(/\D/g,"").slice(-1);
            set(i,ch);
            if(ch&&i<5) refs.current[i+1]?.focus();
            const joined=[...dig].map((d,j)=>j===i?ch:d).join("").replace(/\s/g,"");
            if(joined.length===6) onDone?.(joined);
          }}
          onKeyDown={e=>{
            if(e.key==="Backspace"){ if(!dig[i]?.trim()&&i>0) refs.current[i-1]?.focus(); set(i," "); }
          }}
          onPaste={i===0?e=>{
            e.preventDefault();
            const p=e.clipboardData.getData("text").replace(/\D/g,"").slice(0,6);
            onChange(p.padEnd(6," "));
            if(p.length>=6) onDone?.(p);
            refs.current[Math.min(p.length,5)]?.focus();
          }:undefined}
          style={{width:46,height:54,textAlign:"center",fontSize:24,fontWeight:800,fontFamily:"monospace",borderRadius:10,border:dig[i]?.trim()?"2px solid #1565c0":"2px solid #cfd8dc",outline:"none",background:disabled?"#f5f5f5":"#fff",color:"#0d2a5e"}}
        />
      ))}
    </div>
  );
}

function Timer({ s, onEnd }) {
  const [left,setLeft]=useState(s);
  useEffect(()=>{
    setLeft(s); if(!s) return;
    const t=setInterval(()=>setLeft(l=>{ if(l<=1){clearInterval(t);onEnd?.();return 0;} return l-1; }),1000);
    return ()=>clearInterval(t);
  },[s]);
  if(!left) return null;
  return <span style={{fontFamily:"monospace",color:"#78909c",fontSize:12}}>Resend in {left}s</span>;
}

async function apiSend(phone) {
  try {
    const r = await fetch("/api/send-otp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone})});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||"Failed");
    return d;
  } catch(e) {
    if(e.message.includes("fetch")||e.message.includes("404")) {
      const code = String(Math.floor(100000+Math.random()*900000));
      const exp  = new Date(Date.now()+5*60*1000).toISOString();
      const old  = await db.get("login_codes","phone=eq."+phone+"&used=eq.false");
      for(const c of old) await db.update("login_codes","id=eq."+c.id,{used:true});
      await db.insert("login_codes",{phone,code,expires_at:exp,used:false});
      const ms = await db.get("members","or=(phone.eq."+phone+",whatsapp.eq."+phone+")&limit=1");
      return {memberName:ms[0]?.name||null,devCode:code};
    }
    throw e;
  }
}

async function apiVerify(phone,code,fp) {
  try {
    const r = await fetch("/api/verify-otp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone,code,deviceFingerprint:fp})});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||"Invalid code");
    return d;
  } catch(e) {
    if(e.message.includes("fetch")||e.message.includes("404")) {
      const now = new Date().toISOString();
      const rows = await db.get("login_codes","phone=eq."+phone+"&used=eq.false&expires_at=gt."+now+"&order=created_at.desc&limit=1");
      if(!rows.length||rows[0].code!==code) throw new Error("Invalid or expired code");
      await db.update("login_codes","id=eq."+rows[0].id,{used:true});
      const ms = await db.get("members","or=(phone.eq."+phone+",whatsapp.eq."+phone+")&limit=1");
      if(!ms.length) throw new Error("Member not found. Contact your SACCO manager.");
      const m=ms[0], token=crypto.randomUUID()+"-"+Date.now();
      await db.insert("member_sessions",{member_id:m.id,token,device_id:fp,user_agent:navigator.userAgent,expires_at:new Date(Date.now()+8*3600*1000).toISOString()});
      return {token,memberId:m.id,memberName:m.name};
    }
    throw e;
  }
}

export default function LoginScreen({ onLogin, onBack }) {
  const [phase,setPhase]   = useState("phone");
  const [phone,setPhone]   = useState("");
  const [otp,setOtp]       = useState("      ");
  const [name,setName]     = useState("");
  const [devCode,setDevCode]=useState(null);
  const [canResend,setCR]  = useState(false);
  const [cd,setCd]         = useState(0);
  const [pErr,setPErr]     = useState("");
  const [oErr,setOErr]     = useState("");
  const [busy,setBusy]     = useState(false);

  const send = async () => {
    setPErr(""); const n=norm(phone);
    if(!n){setPErr("Enter a valid Uganda number (e.g. 0772 123 456)");return;}
    setBusy(true);
    try {
      const r=await apiSend(n);
      setName(r.memberName||""); if(r.devCode) setDevCode(r.devCode);
      setPhase("verify"); setCR(false); setCd(60); setOtp("      ");
    } catch(e){setPErr(e.message);}
    finally{setBusy(false);}
  };

  const verify = async (code) => {
    const c=(code||otp).replace(/\s/g,"");
    setOErr(""); if(c.length!==6){setOErr("Enter the 6-digit code");return;}
    setBusy(true);
    try {
      const fp=await fingerprint();
      const s=await apiVerify(norm(phone),c,fp);
      onLogin(s);
    } catch(e){setOErr(e.message);}
    finally{setBusy(false);}
  };

  const S={
    page:{minHeight:"100vh",background:"linear-gradient(135deg,#0d2a5e,#1565c0)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Outfit',sans-serif"},
    card:{background:"#fff",borderRadius:22,padding:"36px 28px",width:"100%",maxWidth:400,boxShadow:"0 24px 64px rgba(0,0,0,.35)"},
    label:{fontSize:10,fontWeight:700,color:"#90a4ae",textTransform:"uppercase",letterSpacing:.8,display:"block",marginBottom:7,fontFamily:"monospace"},
    input:{width:"100%",padding:"13px 14px",borderRadius:11,border:"1.5px solid #cfd8dc",fontSize:15,outline:"none",boxSizing:"border-box"},
    btn:(d)=>({width:"100%",padding:13,borderRadius:11,border:"none",fontWeight:700,fontSize:15,cursor:d?"not-allowed":"pointer",background:d?"#cfd8dc":"linear-gradient(135deg,#1565c0,#0d47a1)",color:d?"#90a4ae":"#fff"}),
    err:{background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:9,padding:"9px 12px",fontSize:12,color:"#c62828",marginBottom:12,textAlign:"center"},
    ok: {background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:9,padding:"9px 12px",fontSize:12,color:"#1b5e20",marginBottom:12,textAlign:"center"},
    dev:{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:9,padding:"10px 12px",fontSize:12,color:"#bf360c",marginBottom:12,textAlign:"center"},
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <svg width="50" height="50" viewBox="0 0 80 80" fill="none">
            <defs><linearGradient id="lg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#1E88E5"/><stop offset="100%" stopColor="#0D47A1"/></linearGradient></defs>
            <polygon points="40,3 75,21.5 75,58.5 40,77 5,58.5 5,21.5" fill="url(#lg)" stroke="#42A5F5" strokeWidth="1.5"/>
            <rect x="19" y="40" width="10" height="15" rx="2.5" fill="#90CAF9" opacity=".85"/>
            <rect x="32" y="31" width="10" height="24" rx="2.5" fill="#64B5F6"/>
            <rect x="45" y="22" width="10" height="33" rx="2.5" fill="#fff"/>
            <polygon points="50,17 56,23 44,23" fill="#fff"/>
          </svg>
          <div style={{fontSize:22,fontWeight:900,color:"#0d2a5e",letterSpacing:2,marginTop:8}}>BIDA</div>
          <div style={{fontSize:10,color:"#90a4ae",letterSpacing:1,textTransform:"uppercase"}}>Member Portal</div>
        </div>

        {phase==="phone" && <>
          <div style={{marginBottom:16}}>
            <label style={S.label}>Your registered phone number</label>
            <input style={S.input} type="tel" placeholder="0772 123 456" value={phone}
              onChange={e=>setPhone(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} />
          </div>
          {pErr && <div style={S.err}>{pErr}</div>}
          <button style={S.btn(busy)} onClick={send} disabled={busy}>{busy?"⏳ Sending…":"Send Verification Code →"}</button>
          <div style={{textAlign:"center",marginTop:12,fontSize:11,color:"#b0bec5"}}>A 6-digit code will be sent via SMS</div>
          {onBack && <div style={{textAlign:"center",marginTop:10}}><button onClick={onBack} style={{background:"none",border:"none",color:"#90a4ae",cursor:"pointer",fontSize:12}}>← Back to Manager Login</button></div>}
        </>}

        {phase==="verify" && <>
          {name   && <div style={S.ok}>👋 Welcome, <strong>{name}</strong>! Enter the code sent to your phone.</div>}
          {devCode && <div style={S.dev}>🛠 DEV MODE — Code: <strong style={{fontFamily:"monospace",fontSize:18}}>{devCode}</strong></div>}
          <div style={{marginBottom:20}}>
            <label style={{...S.label,textAlign:"center",display:"block"}}>6-digit verification code</label>
            <OTPBoxes value={otp} onChange={setOtp} onDone={verify} disabled={busy}/>
            <div style={{textAlign:"center",fontSize:11,color:"#90a4ae",marginTop:8}}>Sent to {phone}</div>
          </div>
          {oErr && <div style={S.err}>{oErr}</div>}
          <button style={S.btn(busy||otp.trim().length<6)} onClick={()=>verify()} disabled={busy||otp.trim().length<6}>
            {busy?"⏳ Verifying…":"Verify & Sign In →"}
          </button>
          <div style={{textAlign:"center",marginTop:14,fontSize:12,color:"#90a4ae"}}>
            {canResend
              ? <button onClick={()=>{setPhase("phone");setDevCode(null);}} style={{background:"none",border:"none",color:"#1565c0",cursor:"pointer",fontWeight:700}}>Resend code</button>
              : <Timer s={cd} onEnd={()=>setCR(true)}/>
            }{" · "}
            <button onClick={()=>{setPhase("phone");setOtp("      ");setOErr("");setDevCode(null);}} style={{background:"none",border:"none",color:"#90a4ae",cursor:"pointer",fontSize:11}}>Change number</button>
          </div>
        </>}

        <div style={{textAlign:"center",marginTop:20,fontSize:10,color:"#cfd8dc"}}>Authorised access only · BIDA Co-operative</div>
      </div>
    </div>
  );
}

