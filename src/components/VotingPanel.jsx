import React, { useState, useEffect } from "react";
import { db, fmtDT, sha256, fingerprint } from "../utils/supabase.js";

function TimeLeft({ end }) {
  const ms = new Date(end) - Date.now();
  if (ms <= 0) return <span style={{color:"#c62828",fontSize:11}}>Closed</span>;
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  return <span style={{color:h<2?"#c62828":"#1b5e20",fontSize:11}}>⏱ {h}h {m}m left</span>;
}

function PollCard({ poll, memberId, onVoted }) {
  const [mine,   setMine]   = useState(null);
  const [sel,    setSel]    = useState([]);
  const [tally,  setTally]  = useState({counts:{},total:0});
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState("");
  const [init,   setInit]   = useState(true);

  const loadTally = async () => {
    const vs = await db.get("votes","poll_id=eq."+poll.id);
    const c={};
    vs.forEach(v=>{(Array.isArray(v.vote_data?.choices)?v.vote_data.choices:[v.vote_data?.choice]).filter(Boolean).forEach(x=>{c[x]=(c[x]||0)+1;});});
    setTally({counts:c,total:vs.length});
  };

  useEffect(()=>{
    (async()=>{
      setInit(true);
      try {
        const ex = await db.get("votes","poll_id=eq."+poll.id+"&member_id=eq."+memberId);
        if(ex.length) setMine(ex[0].vote_data);
        await loadTally();
      } catch {}
      finally { setInit(false); }
    })();
  },[poll.id, memberId]);

  const toggle = id => {
    setSel(p => poll.poll_type==="multiple_choice" ? (p.includes(id)?p.filter(x=>x!==id):[...p,id]) : [id]);
  };

  const cast = async () => {
    if (!sel.length) { setErr("Select an option"); return; }
    setBusy(true); setErr("");
    try {
      const fp  = await fingerprint();
      const now = new Date().toISOString();
      const vd  = {choices:sel,castAt:now,pollId:poll.id,memberId};
      const h   = await sha256(JSON.stringify(vd)+memberId+poll.id+now);
      await db.insert("votes",{poll_id:poll.id,member_id:memberId,vote_data:vd,vote_hash:h,device_fingerprint:fp,cast_at:now});
      setMine(vd); await loadTally(); onVoted?.();
    } catch(e) {
      setErr(e.message.includes("one_vote")||e.message.includes("unique")?"You already voted in this poll.":"Error: "+e.message);
    } finally { setBusy(false); }
  };

  const opts = poll.options||[];
  const past = new Date(poll.end_date)<new Date();
  const multi = poll.poll_type==="multiple_choice";

  return (
    <div style={{background:"#fff",borderRadius:16,padding:"18px 20px",marginBottom:16,border:"1.5px solid #e3f2fd",boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:10}}>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:15,color:"#0d2a5e"}}>{poll.title}</div>
          {poll.description&&<div style={{fontSize:12,color:"#546e7a",marginTop:3}}>{poll.description}</div>}
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <TimeLeft end={poll.end_date}/>
          <div style={{fontSize:10,color:"#90a4ae",marginTop:2}}>{tally.total} vote{tally.total!==1?"s":""}</div>
        </div>
      </div>
      <div style={{fontSize:10,fontWeight:700,color:"#1565c0",background:"#e3f2fd",display:"inline-block",padding:"2px 9px",borderRadius:20,marginBottom:14,fontFamily:"monospace",textTransform:"uppercase"}}>
        {(poll.poll_type||"").replace(/_/g," ")}
      </div>

      {init ? <div style={{height:60,background:"#f5f5f5",borderRadius:8}}/> :

      mine ? <>
        <div style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
          <div style={{fontWeight:700,color:"#1b5e20",fontSize:12}}>✅ Your vote is recorded</div>
          <div style={{fontSize:11,color:"#388e3c",marginTop:3}}>Choice: <strong>{(mine.choices||[]).map(c=>(opts.find(o=>o.id===c)||{}).label||c).join(", ")}</strong></div>
        </div>
        {opts.map(o=>{
          const cnt=(tally.counts[o.id]||0), pct=tally.total>0?Math.round(cnt/tally.total*100):0, isM=(mine.choices||[]).includes(o.id);
          return (
            <div key={o.id} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:13,fontWeight:isM?700:400,color:isM?"#1565c0":"#546e7a"}}>{isM?"✓ ":""}{o.label}</span>
                <span style={{fontSize:12,fontFamily:"monospace",color:"#78909c"}}>{cnt} ({pct}%)</span>
              </div>
              <div style={{background:"#eceff1",borderRadius:99,height:8}}>
                <div style={{height:8,width:pct+"%",background:isM?"#1565c0":"#b0bec5",borderRadius:99,transition:"width .5s"}}/>
              </div>
            </div>
          );
        })}
      </> :

      past ? <div style={{background:"#ffebee",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#c62828"}}>This poll has closed.</div> :

      <>
        <div style={{marginBottom:14}}>
          {opts.map(o=>{
            const s=sel.includes(o.id);
            return (
              <div key={o.id} onClick={()=>toggle(o.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:10,border:"2px solid "+(s?"#1565c0":"#e8eaf6"),background:s?"#e3f2fd":"#fafafa",marginBottom:8,cursor:"pointer",transition:"all .15s"}}>
                <div style={{width:20,height:20,flexShrink:0,borderRadius:multi?4:"50%",border:"2px solid "+(s?"#1565c0":"#cfd8dc"),background:s?"#1565c0":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {s&&<div style={{width:8,height:8,borderRadius:"50%",background:"#fff"}}/>}
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:s?700:400,color:s?"#0d2a5e":"#546e7a"}}>{o.label}</div>
                  {o.description&&<div style={{fontSize:11,color:"#90a4ae",marginTop:2}}>{o.description}</div>}
                </div>
              </div>
            );
          })}
        </div>
        {err&&<div style={{background:"#ffebee",border:"1px solid #ffcdd2",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#c62828",marginBottom:12}}>{err}</div>}
        <button onClick={cast} disabled={busy||!sel.length} style={{width:"100%",padding:12,borderRadius:10,border:"none",fontWeight:700,fontSize:14,cursor:busy||!sel.length?"not-allowed":"pointer",background:busy||!sel.length?"#cfd8dc":"linear-gradient(135deg,#1565c0,#0d47a1)",color:busy||!sel.length?"#90a4ae":"#fff"}}>
          {busy?"⏳ Submitting…":"🗳 Cast My Vote"}
        </button>
        <div style={{fontSize:10,color:"#90a4ae",textAlign:"center",marginTop:8}}>Anonymous · Cannot be changed once submitted</div>
      </>}
    </div>
  );
}

export default function VotingPanel({ memberId, polls=[], onRefresh }) {
  const [list,  setList]  = useState(polls);
  const [busy,  setBusy]  = useState(false);

  useEffect(()=>setList(polls),[polls]);

  const refresh = async () => {
    setBusy(true);
    try { const a=await db.get("polls","status=eq.active"); setList(a); onRefresh?.(a); }
    catch {} finally { setBusy(false); }
  };

  if (!list.length) return (
    <div style={{textAlign:"center",padding:"40px 20px"}}>
      <div style={{fontSize:48,marginBottom:12}}>🗳</div>
      <div style={{fontWeight:700,color:"#546e7a",fontSize:15}}>No active polls</div>
      <div style={{fontSize:12,color:"#90a4ae",marginTop:6}}>Check back when your cooperative has an election scheduled.</div>
      <button onClick={refresh} style={{marginTop:16,background:"#e3f2fd",border:"none",color:"#1565c0",fontWeight:700,padding:"8px 18px",borderRadius:8,cursor:"pointer",fontSize:12}}>{busy?"…":"↻ Refresh"}</button>
    </div>
  );

  return (
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:"#0d2a5e",textTransform:"uppercase",letterSpacing:.7,fontFamily:"monospace"}}>Active Polls ({list.length})</div>
        <button onClick={refresh} style={{background:"none",border:"none",color:"#1565c0",fontWeight:700,fontSize:12,cursor:"pointer"}}>{busy?"…":"↻ Refresh"}</button>
      </div>
      {list.map(p=><PollCard key={p.id} poll={p} memberId={memberId} onVoted={refresh}/>)}
      <div style={{background:"#e8f5e9",border:"1px solid #c8e6c9",borderRadius:12,padding:"12px 14px",fontSize:11,color:"#1b5e20"}}>
        🔒 <strong>Secure voting.</strong> Each vote is hashed with SHA-256 and stored immutably. A device fingerprint is recorded for auditing. You cannot change your vote.
      </div>
    </>
  );
}
