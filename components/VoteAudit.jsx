import React, { useState, useEffect } from "react";
import { db, fmtDT } from "../utils/supabase.js";

function Result({ poll }) {
  const [votes,   setVotes]   = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{db.get("votes","poll_id=eq."+poll.id).then(setVotes).finally(()=>setLoading(false));},[poll.id]);

  const opts  = poll.options||[];
  const total = votes.length;
  const cnts  = {};
  votes.forEach(v=>{(Array.isArray(v.vote_data?.choices)?v.vote_data.choices:[v.vote_data?.choice]).filter(Boolean).forEach(c=>{cnts[c]=(cnts[c]||0)+1;});});
  const winner = Object.entries(cnts).sort((a,b)=>b[1]-a[1])[0];

  return (
    <div style={{background:"#fff",border:"1px solid #e3f2fd",borderRadius:14,padding:"16px 18px",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div>
          <div style={{fontWeight:800,fontSize:14,color:"#0d2a5e"}}>{poll.title}</div>
          <div style={{fontSize:11,color:"#90a4ae",marginTop:2}}>{fmtDT(poll.start_date)} → {fmtDT(poll.end_date)}</div>
        </div>
        <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20,background:poll.status==="active"?"#e8f5e9":poll.status==="verified"?"#e3f2fd":"#f5f5f5",color:poll.status==="active"?"#1b5e20":poll.status==="verified"?"#1565c0":"#546e7a"}}>{(poll.status||"").toUpperCase()}</span>
      </div>
      <div style={{display:"flex",gap:12,marginBottom:12}}>
        <div style={{background:"#f5f5f5",borderRadius:8,padding:"8px 14px",textAlign:"center"}}>
          <div style={{fontSize:22,fontWeight:900,color:"#0d2a5e"}}>{total}</div>
          <div style={{fontSize:10,color:"#90a4ae"}}>Votes</div>
        </div>
        {winner&&<div style={{background:"#e8f5e9",borderRadius:8,padding:"8px 14px",flex:1}}>
          <div style={{fontSize:10,color:"#388e3c",fontFamily:"monospace",textTransform:"uppercase"}}>Leading</div>
          <div style={{fontWeight:800,fontSize:14,color:"#1b5e20"}}>{(opts.find(o=>o.id===winner[0])||{}).label||winner[0]}</div>
          <div style={{fontSize:11,color:"#388e3c"}}>{winner[1]} votes ({total>0?Math.round(winner[1]/total*100):0}%)</div>
        </div>}
      </div>
      {opts.map(o=>{const c=cnts[o.id]||0,p=total>0?Math.round(c/total*100):0;return(
        <div key={o.id} style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:13,color:"#263238"}}>{o.label}</span>
            <span style={{fontSize:12,fontFamily:"monospace",color:"#546e7a"}}>{c} · {p}%</span>
          </div>
          <div style={{background:"#eceff1",borderRadius:99,height:8}}>
            <div style={{height:8,width:p+"%",background:"#1565c0",borderRadius:99}}/>
          </div>
        </div>
      );})}
      <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"none",color:"#90a4ae",cursor:"pointer",fontSize:11,padding:0,marginTop:8}}>{open?"▲ Hide":"▼ Show"} audit trail ({total} records)</button>
      {open&&!loading&&<div style={{marginTop:10,maxHeight:200,overflowY:"auto",background:"#fafafa",borderRadius:8,padding:10}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,fontFamily:"monospace"}}>
          <thead><tr style={{color:"#90a4ae"}}><th style={{textAlign:"left",padding:"3px 6px"}}>#</th><th style={{textAlign:"left",padding:"3px 6px"}}>Time</th><th style={{textAlign:"left",padding:"3px 6px"}}>Hash (16 chars)</th><th style={{textAlign:"left",padding:"3px 6px"}}>Device</th></tr></thead>
          <tbody>{votes.map((v,i)=>(
            <tr key={v.id} style={{borderTop:"1px solid #f0f0f0"}}>
              <td style={{padding:"3px 6px",color:"#546e7a"}}>{i+1}</td>
              <td style={{padding:"3px 6px",color:"#546e7a"}}>{fmtDT(v.cast_at)}</td>
              <td style={{padding:"3px 6px",color:"#0d2a5e"}}>{(v.vote_hash||"").slice(0,16)}…</td>
              <td style={{padding:"3px 6px",color:"#90a4ae"}}>{(v.device_fingerprint||"").slice(0,8)||"—"}…</td>
            </tr>
          ))}</tbody>
        </table>
      </div>}
    </div>
  );
}

export default function VoteAudit() {
  const [polls,   setPolls]   = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{db.get("polls","order=id.desc").then(setPolls).finally(()=>setLoading(false));},[]);
  if(loading) return <div style={{padding:40,textAlign:"center",color:"#90a4ae"}}>⏳ Loading…</div>;
  if(!polls.length) return <div style={{padding:40,textAlign:"center",color:"#90a4ae"}}>No polls found. Create one via Poll Management.</div>;
  return (
    <div style={{fontFamily:"'Outfit',sans-serif"}}>
      <div style={{fontSize:11,fontWeight:700,color:"#0d2a5e",textTransform:"uppercase",letterSpacing:.7,fontFamily:"monospace",marginBottom:16}}>🗳 Vote Audit — All Polls</div>
      {polls.map(p=><Result key={p.id} poll={p}/>)}
    </div>
  );
}
