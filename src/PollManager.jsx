import React, { useState, useEffect } from "react";
import { db, fmtDT } from "../utils/supabase.js";

const TYPES=[{v:"yes_no",l:"Yes / No"},{v:"single_choice",l:"Single Choice"},{v:"multiple_choice",l:"Multiple Choice"},{v:"candidate",l:"Candidate Election"}];
const BLANK={title:"",description:"",poll_type:"yes_no",start_date:new Date().toISOString().slice(0,16),end_date:new Date(Date.now()+7*24*3600*1000).toISOString().slice(0,16),status:"draft",options:[{id:"o1",label:"Yes"},{id:"o2",label:"No"}]};

export default function PollManager({ managerRole }) {
  const [polls,  setPolls]  = useState([]);
  const [form,   setForm]   = useState({...BLANK});
  const [show,   setShow]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState("");
  const canManage = ["admin","auditor"].includes(managerRole);

  useEffect(()=>{db.get("polls","order=id.desc").then(setPolls).catch(()=>{});},[]);

  const setType = t => {
    const d={yes_no:[{id:"o1",label:"Yes"},{id:"o2",label:"No"}],single_choice:[{id:"o1",label:"Option 1"},{id:"o2",label:"Option 2"}],multiple_choice:[{id:"o1",label:"Option 1"},{id:"o2",label:"Option 2"},{id:"o3",label:"Option 3"}],candidate:[{id:"o1",label:"Candidate 1",description:""},{id:"o2",label:"Candidate 2",description:""}]};
    setForm(f=>({...f,poll_type:t,options:d[t]||[]}));
  };

  const save = async () => {
    if(!form.title.trim()){setMsg("Title required");return;}
    if(form.options.some(o=>!o.label.trim())){setMsg("All options need labels");return;}
    setSaving(true); setMsg("");
    try {
      const r=await db.insert("polls",{title:form.title.trim(),description:form.description.trim()||null,poll_type:form.poll_type,start_date:new Date(form.start_date).toISOString(),end_date:new Date(form.end_date).toISOString(),status:form.status,options:form.options});
      setPolls(p=>[r[0],...p]); setShow(false); setForm({...BLANK}); setMsg("✅ Poll created");
    } catch(e){setMsg("Error: "+e.message);}
    finally{setSaving(false);}
  };

  const setStatus = async (id,s) => {
    await db.update("polls","id=eq."+id,{status:s});
    setPolls(p=>p.map(x=>x.id===id?{...x,status:s}:x));
  };

  const SL={fontSize:10,fontWeight:700,color:"#78909c",textTransform:"uppercase",letterSpacing:.7,display:"block",marginBottom:6,fontFamily:"monospace"};
  const IN={width:"100%",padding:"11px 13px",borderRadius:9,border:"1.5px solid #cfd8dc",fontSize:14,outline:"none",boxSizing:"border-box"};

  return (
    <div style={{fontFamily:"'Outfit',sans-serif"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#0d2a5e",textTransform:"uppercase",letterSpacing:.7,fontFamily:"monospace"}}>🗳 Poll Management</div>
        {canManage&&!show&&<button onClick={()=>setShow(true)} style={{background:"linear-gradient(135deg,#1565c0,#0d47a1)",color:"#fff",border:"none",borderRadius:9,padding:"8px 16px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ New Poll</button>}
      </div>
      {msg&&<div style={{background:msg.startsWith("✅")?"#e8f5e9":"#ffebee",border:"1px solid "+(msg.startsWith("✅")?"#a5d6a7":"#ffcdd2"),borderRadius:9,padding:"9px 12px",fontSize:12,color:msg.startsWith("✅")?"#1b5e20":"#c62828",marginBottom:12}}>{msg}</div>}

      {show&&<div style={{background:"#fff",border:"1.5px solid #e3f2fd",borderRadius:16,padding:20,marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:14,color:"#0d2a5e",marginBottom:16}}>New Poll</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div style={{gridColumn:"1/-1"}}><label style={SL}>Title *</label><input style={IN} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Election of Chairperson 2025"/></div>
          <div style={{gridColumn:"1/-1"}}><label style={SL}>Description</label><textarea style={{...IN,resize:"vertical",minHeight:56}} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div><label style={SL}>Type</label><select style={IN} value={form.poll_type} onChange={e=>setType(e.target.value)}>{TYPES.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
          <div><label style={SL}>Status</label><select style={IN} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option value="draft">Draft</option><option value="active">Active</option></select></div>
          <div><label style={SL}>Start</label><input style={IN} type="datetime-local" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))}/></div>
          <div><label style={SL}>End</label><input style={IN} type="datetime-local" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))}/></div>
        </div>
        <label style={SL}>Options</label>
        {form.options.map((o,i)=>(
          <div key={o.id} style={{display:"flex",gap:8,marginBottom:8}}>
            <input style={{...IN,flex:1}} placeholder={"Option "+(i+1)} value={o.label} onChange={e=>{const n=[...form.options];n[i]={...n[i],label:e.target.value};setForm(f=>({...f,options:n}));}}/>
            {form.poll_type==="candidate"&&<input style={{...IN,flex:1}} placeholder="Bio" value={o.description||""} onChange={e=>{const n=[...form.options];n[i]={...n[i],description:e.target.value};setForm(f=>({...f,options:n}));}}/>}
            <button onClick={()=>setForm(f=>({...f,options:f.options.filter((_,j)=>j!==i)}))} style={{background:"#ffebee",border:"none",color:"#c62828",borderRadius:8,padding:"8px 10px",cursor:"pointer"}}>✕</button>
          </div>
        ))}
        {form.poll_type!=="yes_no"&&<button onClick={()=>setForm(f=>({...f,options:[...f.options,{id:"o"+Date.now(),label:"",description:""}]}))} style={{background:"#e3f2fd",border:"none",color:"#1565c0",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:700,marginBottom:14}}>+ Add Option</button>}
        <div style={{display:"flex",gap:10,marginTop:8}}>
          <button onClick={()=>setShow(false)} style={{flex:1,padding:11,borderRadius:9,border:"1.5px solid #cfd8dc",background:"#fff",cursor:"pointer",fontWeight:600}}>Cancel</button>
          <button onClick={save} disabled={saving} style={{flex:2,padding:11,borderRadius:9,border:"none",background:"linear-gradient(135deg,#1565c0,#0d47a1)",color:"#fff",cursor:saving?"not-allowed":"pointer",fontWeight:700}}>{saving?"Saving…":"Create Poll"}</button>
        </div>
      </div>}

      {polls.length===0?<div style={{textAlign:"center",padding:30,color:"#90a4ae",fontSize:13}}>No polls yet.</div>:polls.map(p=>(
        <div key={p.id} style={{background:"#fff",borderRadius:13,padding:"14px 16px",marginBottom:10,border:"1px solid #e3f2fd"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13,color:"#0d2a5e"}}>{p.title}</div>
              <div style={{fontSize:11,color:"#90a4ae",marginTop:2}}>{(p.poll_type||"").replace(/_/g," ")} · {fmtDT(p.start_date)} → {fmtDT(p.end_date)}</div>
            </div>
            <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20,background:p.status==="active"?"#e8f5e9":p.status==="verified"?"#e3f2fd":"#f5f5f5",color:p.status==="active"?"#1b5e20":p.status==="verified"?"#1565c0":"#546e7a",flexShrink:0}}>{(p.status||"").toUpperCase()}</span>
          </div>
          {canManage&&<div style={{display:"flex",gap:7,marginTop:10,flexWrap:"wrap"}}>
            {p.status==="draft"   &&<button onClick={()=>setStatus(p.id,"active")}   style={{fontSize:11,padding:"5px 12px",borderRadius:7,border:"none",background:"#e8f5e9",color:"#1b5e20",cursor:"pointer",fontWeight:700}}>▶ Activate</button>}
            {p.status==="active"  &&<button onClick={()=>setStatus(p.id,"closed")}   style={{fontSize:11,padding:"5px 12px",borderRadius:7,border:"none",background:"#fff3e0",color:"#e65100",cursor:"pointer",fontWeight:700}}>⏹ Close</button>}
            {p.status==="closed"  &&<button onClick={()=>setStatus(p.id,"verified")} style={{fontSize:11,padding:"5px 12px",borderRadius:7,border:"none",background:"#e3f2fd",color:"#1565c0",cursor:"pointer",fontWeight:700}}>✅ Verify</button>}
          </div>}
        </div>
      ))}
    </div>
  );
}
