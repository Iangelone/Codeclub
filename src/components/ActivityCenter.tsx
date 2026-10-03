'use client';
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Check, Settings, Square, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useSharedSessions, type SharedSession } from '../lib/shared-sessions';
import { activityTranslations, useAppLanguage } from '../lib/i18n';

export function sessionStatus(session: SharedSession, text: typeof activityTranslations.es): string {
  if(session.approvals.length)return text.approval;
  if(session.state==='error'||session.state==='interrupted')return text.error;
  if(session.state==='finished')return text.finished;
  if(session.state==='cancelled')return text.cancelled;
  if(session.state==='question')return text.question;
  if(session.tool)return `${text.working} · ${session.tool}`;
  return session.busy?text.thinking:text.idle;
}
export default function ActivityCenter() {
  const sessions=useSharedSessions();
  const language=useAppLanguage(),text=activityTranslations[language];
  const [open,setOpen]=useState(false),[settings,setSettings]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const [config,setConfig]=useState({githubRepo:'',githubUser:'',vercelProject:'',vercelTeam:'',paused:false,externalAgents:false});
  const [preview,setPreview]=useState<{id:string;file:string;before:string;after:string}|null>(null);
  const [githubKey,setGithubKey]=useState(''),[vercelKey,setVercelKey]=useState('');
  const [saving,setSaving]=useState(false),[error,setError]=useState(false);
  const bridge=()=> (window as any).codeclub;
  useEffect(()=>{
    if(!open)return;
    const close=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    window.addEventListener('mousedown',close);window.addEventListener('keydown',escape);
    void bridge()?.integrationConfig?.().then((value:any)=>{if(value)setConfig(value);});
    return ()=>{window.removeEventListener('mousedown',close);window.removeEventListener('keydown',escape);};
  },[open]);
  const save=async()=>{
    setSaving(true);setError(false);
    try {
      if(githubKey)await bridge()?.credentialSet?.('github_integration_api_key',githubKey,'https://api.github.com');
      if(vercelKey)await bridge()?.credentialSet?.('vercel_integration_api_key',vercelKey,'https://api.vercel.com');
      await bridge()?.integrationSave?.(config);setGithubKey('');setVercelKey('');setSettings(false);
    }catch{setError(true);}finally{setSaving(false);}
  };
  const pending=sessions.reduce((total,session)=>total+session.approvals.length,0);
  const running=sessions.filter(session=>session.busy).length;
  return <div ref={root} className="relative" style={{WebkitAppRegion:'no-drag'} as React.CSSProperties}>
    <button type="button" aria-label={text.title} title={text.title} aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="relative grid h-7 w-7 place-items-center rounded-full text-(--codeclub-icon) hover:bg-(--codeclub-hover)"><Activity size={15}/>{(pending>0||running>0)&&<span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[#8BC7FF]"/>}</button>
    <AnimatePresence mode="wait">{open&&<motion.section initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.12}} className="absolute top-9 right-0 z-[150] w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-[#2b2b2b] bg-[#111111] p-2 shadow-xl" aria-label={text.title}>
      <div className="mb-1 flex items-center gap-2 px-2 py-1 text-xs text-[#dedede]"><span className="flex-1">{text.title}</span><button type="button" title={text.integrations} aria-label={text.integrations} onClick={()=>setSettings(value=>!value)} className="rounded-md p-1 hover:bg-[#1e1e1e]"><Settings size={14}/></button></div>
      {settings?<div className="grid gap-2 p-2 text-xs text-[#aaa]">
        <label className="grid gap-1">GitHub · {text.repository}<input value={config.githubRepo} onChange={event=>setConfig({...config,githubRepo:event.target.value})} placeholder="owner/repo" className="rounded-lg border border-[#2b2b2b] bg-[#161616] p-2 text-[#dedede] outline-none focus:border-[#3d9bff]"/></label>
        <label className="grid gap-1">GitHub · {text.username}<input value={config.githubUser} onChange={event=>setConfig({...config,githubUser:event.target.value})} className="rounded-lg border border-[#2b2b2b] bg-[#161616] p-2 text-[#dedede]"/></label>
        <label className="grid gap-1">GitHub token<input type="password" autoComplete="off" value={githubKey} onChange={event=>setGithubKey(event.target.value)} placeholder={text.keepCredential} className="rounded-lg border border-[#2b2b2b] bg-[#161616] p-2 text-[#dedede]"/></label>
        <label className="grid gap-1">Vercel · {text.project}<input value={config.vercelProject} onChange={event=>setConfig({...config,vercelProject:event.target.value})} placeholder="prj_…" className="rounded-lg border border-[#2b2b2b] bg-[#161616] p-2 text-[#dedede]"/></label>
        <label className="grid gap-1">Vercel · {text.team}<input value={config.vercelTeam} onChange={event=>setConfig({...config,vercelTeam:event.target.value})} placeholder="team_…" className="rounded-lg border border-[#2b2b2b] bg-[#161616] p-2 text-[#dedede]"/></label>
        <label className="grid gap-1">Vercel token<input type="password" autoComplete="off" value={vercelKey} onChange={event=>setVercelKey(event.target.value)} placeholder={text.keepCredential} className="rounded-lg border border-[#2b2b2b] bg-[#161616] p-2 text-[#dedede]"/></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={config.paused} onChange={event=>setConfig({...config,paused:event.target.checked})}/>{text.pause}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={config.externalAgents} onChange={event=>setConfig({...config,externalAgents:event.target.checked})}/>{text.externalAgents}</label>
        {config.externalAgents&&<><p className="m-0 text-[11px]">{text.externalNote}</p><button type="button" className="rounded-lg bg-[#1e1e1e] p-2" onClick={()=>{setError(false);void bridge().hooksPreview().then(setPreview).catch(()=>setError(true));}}>{text.previewHooks}</button></>}
        {preview&&<div className="grid gap-2"><span className="break-all text-[10px]">{preview.file}</span><pre className="max-h-28 overflow-auto whitespace-pre-wrap text-[10px] text-[#888]">{preview.before||'{}'}</pre><pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-[#8bc7ff]">{preview.after}</pre><button type="button" onClick={()=>{setError(false);void bridge().hooksInstall(preview.id).then(()=>setPreview(null)).catch(()=>setError(true));}} className="rounded-lg bg-[#1e1e1e] p-2 text-[#8bc7ff]">{text.installHooks}</button></div>}
        {error&&<span role="alert">{text.failed}</span>}<button type="button" disabled={saving} onClick={()=>void save()} className="rounded-lg bg-[#1e1e1e] p-2 text-[#8bc7ff]">{saving?text.saving:text.save}</button>
      </div>:<div className="max-h-[380px] overflow-auto">{sessions.length===0?<p className="m-0 px-2 py-6 text-center text-xs text-[#888]">{text.empty}</p>:sessions.map(session=><div key={session.key} className="mb-1 rounded-xl border border-[#202020] bg-[#161616] p-2.5">
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-[#dedede]">{session.name||session.chatId}</span><button type="button" title={text.open} aria-label={`${text.open} ${session.name||session.chatId}`} onClick={()=>{if(session.external){if(session.url)void bridge()?.openExternal?.(session.url);}else void bridge()?.sessionOpen?.(session);setOpen(false);}} className="rounded-md p-1 text-[#aaa] hover:bg-[#1e1e1e]"><ArrowUpRight size={14}/></button></div>
        <p className="mt-1 mb-0 truncate text-[11px] text-[#888]">{session.projectName||text.global} · {sessionStatus(session,text)}</p>
        {session.approvals.map(approval=><div key={approval.id} className="mt-2 border-t border-[#2b2b2b] pt-2"><p className="m-0 max-h-20 overflow-auto break-words text-[11px] text-[#bcbcbc]">{approval.summary}</p><div className="mt-2 flex gap-2"><button type="button" title={text.deny} onClick={()=>void bridge()?.sessionCommand?.(session,'deny',approval.id)} className="flex items-center gap-1 rounded-lg bg-[#1e1e1e] px-2 py-1 text-[11px] text-[#bbb]"><X size={12}/>{text.deny}</button><button type="button" title={text.allow} onClick={()=>void bridge()?.sessionCommand?.(session,'approve',approval.id)} className="flex items-center gap-1 rounded-lg bg-[#1687ff]/15 px-2 py-1 text-[11px] text-[#8bc7ff]"><Check size={12}/>{text.allow}</button></div></div>)}
        {session.busy&&!session.external&&<button type="button" title={text.cancel} onClick={()=>void bridge()?.sessionCommand?.(session,'cancel')} className="mt-2 flex items-center gap-1 text-[11px] text-[#888]"><Square size={10}/>{text.cancel}</button>}
      </div>)}</div>}
    </motion.section>}</AnimatePresence>
  </div>;
}
