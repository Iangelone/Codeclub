import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ChatStore } from './chat-store.js';
import type { SettingsStore } from './settings-store.js';
import type { SessionHub } from './session-hub.js';

/** The paired phone is a chat client; execution and credentials stay on the desktop. */
export class MobileSync {
  private db:DatabaseSync;
  constructor(private directory:string,private chats:ChatStore,private settings:SettingsStore,private sessions:SessionHub,private projects:()=>{path:string;name:string}[],private control:(chat:any,action:string,approvalId?:string)=>boolean=()=>false){
    this.db=new DatabaseSync(path.join(directory,'mobile.sqlite'));
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,device TEXT NOT NULL,chatKey TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',owner INTEGER,claimed INTEGER,created INTEGER NOT NULL)");
  }
  /** Hide filesystem scopes behind stable, case-normalized conversation identifiers. */
  private key(projectPath:string,chatId:string){return createHash('sha256').update(JSON.stringify([projectPath.replaceAll('/','\\').toLowerCase(),chatId])).digest('hex');}
  /** Rebuild authorized global, registered-project and orb metadata from desktop storage. */
  private async catalog(){
    const savedOrbs=this.settings.get('codeclub_orbs');const orbs:any[]=Array.isArray(savedOrbs)?savedOrbs:[];
    const savedGlobals=this.settings.get('codeclub_global_chats');const globals:any[]=Array.isArray(savedGlobals)?savedGlobals:[];const savedShape=this.settings.get('codeclub_orb_shape');
    const projects=this.projects();const names=new Map<string,string>();const emptyEntries:{projectPath:string;chatId:string}[]=[];
    for(const chat of globals)if(typeof chat.id==='string'){names.set(this.key('',chat.id),String(chat.name||'Chat'));emptyEntries.push({projectPath:'',chatId:chat.id});}
    await Promise.all(projects.map(async project=>{
      try{const meta=JSON.parse(await readFile(path.join(this.directory,'projects',encodeURIComponent(project.path),'meta.json'),'utf8'));for(const chat of meta.chats||[])if(typeof chat.id==='string'){names.set(this.key(project.path,chat.id),String(chat.name||'Chat'));emptyEntries.push({projectPath:project.path,chatId:chat.id});}}catch{/* A project can have no chat metadata yet. */}
    }));
    const entries=[...emptyEntries,...this.chats.index()];
    for(const orb of orbs)if(typeof orb.id==='string')entries.push({projectPath:'',chatId:orb.chatId||`orb-chat-${orb.id}`});
    const unique=new Map<string,any>();
    for(const entry of entries){
      const project=entry.projectPath?projects.find(item=>path.resolve(item.path).toLowerCase()===path.resolve(entry.projectPath).toLowerCase()):undefined;
      if(entry.projectPath&&!project)continue;
      const key=this.key(entry.projectPath,entry.chatId),orb=orbs.find(item=>(item.chatId||`orb-chat-${item.id}`)===entry.chatId&&!entry.projectPath);
      unique.set(key,{...entry,key,name:orb?.name||names.get(key)||'Chat',project:project?.name||'',orb:orb?{id:String(orb.id),name:String(orb.name),purpose:String(orb.purpose||'').slice(0,2000),color:/^#[0-9a-f]{6}$/i.test(orb.color)?orb.color:'#2D5FD6',shape:['circle','cloud','triangle','square'].includes(String(savedShape))?savedShape:'circle',model:String(orb.modelId||''),maximumAutonomy:orb.maximumAutonomy===true}:undefined});
    }
    return [...unique.values()];
  }
  /** Reconcile a crashed renderer against committed chat history before retrying delivery. */
  private accepted(entry:any,chat:any){
    if(entry.state==='queued'&&typeof chat.projectPath==='string'&&this.chats.hasMobileMessage(chat.projectPath,chat.chatId,entry.id)){this.accept(entry.id);return 'accepted';}return entry.state;
  }
  /** Validate peer requests and export only visible chat text and non-secret configuration. */
  async request(device:string,request:any){
    if(!request||typeof request!=='object')throw new Error('INVALID_REQUEST');
    const catalog=await this.catalog();const chat=catalog.find(item=>item.key===request.chatKey);
    if(request.operation==='control'){
      if(!chat||!['cancel','approve','deny'].includes(request.action)||!this.control(chat,request.action,typeof request.approvalId==='string'?request.approvalId:undefined))throw new Error('CONTROL_UNAVAILABLE');
      return {controlled:true};
    }
    if(request.operation==='send'){
      if(!chat||typeof request.id!=='string'||!/^[-\w]{16,80}$/.test(request.id)||typeof request.text!=='string'||!request.text.trim()||request.text.length>16000)throw new Error('INVALID_MESSAGE');
      const existing=this.db.prepare('SELECT * FROM inbox WHERE id=?').get(request.id);
      if(existing){if(existing.device!==device||existing.chatKey!==chat.key||existing.text!==request.text)throw new Error('MESSAGE_ID_CONFLICT');return {state:this.accepted(existing,chat),id:request.id};}
      if(Number(this.db.prepare("SELECT count(*) AS count FROM inbox WHERE state='queued'").get()!.count)>=100)throw new Error('QUEUE_FULL');
      this.db.prepare('INSERT INTO inbox(id,device,chatKey,text,created) VALUES(?,?,?,?,?)').run(request.id,device,chat.key,request.text,Date.now());
      return {state:'queued',id:request.id};
    }
    if(request.operation!=='sync')throw new Error('UNKNOWN_REQUEST');
    const list=catalog.map(({projectPath,chatId,...item})=>item);
    const selected=chat||catalog.find(item=>item.orb)||catalog[0];
    const outbox=this.db.prepare('SELECT * FROM inbox WHERE device=? ORDER BY created DESC LIMIT 100').all(device).map(entry=>({id:entry.id,chatKey:entry.chatKey,state:this.accepted(entry,catalog.find(item=>item.key===entry.chatKey)||{})}));
    if(!selected)return {chats:list,messages:[],outbox};
    const session=this.sessions.list().find(item=>item.chatId===selected.chatId&&item.projectPath.toLowerCase()===selected.projectPath.toLowerCase());
    const before=typeof request.before==='number'&&Number.isSafeInteger(request.before)&&request.before>=0?request.before:undefined;
    const page=await this.chats.page(selected.projectPath,selected.chatId,before,40);
    const messages=before===undefined&&session?.busy&&session.messages.length?session.messages.slice(-40):page.messages;
    return {chats:list,selectedKey:selected.key,messages:messages.map((item:any,index:number)=>({...item,mobileSeq:item.historyIndex??(session?.busy&&index===messages.length-1?page.total:page.start+index)})).filter((item:any)=>!item.hidden&&['user','assistant'].includes(item.role)).map((item:any)=>({id:String(item.mobileSeq),seq:item.mobileSeq,requestId:item.mobileRequestId,role:item.role,text:String(item.displayContent||item.content||'')})),before:before??null,start:page.start,total:page.total,busy:session?.busy===true,activity:String(session?.tool||session?.state||''),error:session?.state==='error',approvals:(session?.approvals||[]).filter(item=>item.expiresAt>Date.now()).map(item=>({id:item.id,summary:String(item.summary||item.toolName||'').slice(0,500)})),outbox};
  }
  /** Skip busy conversations and live claims; expired claims can be recovered after a crash. */
  async next(){
    const catalog=await this.catalog();
    for(const entry of this.db.prepare("SELECT * FROM inbox WHERE state='queued' ORDER BY created").all()){
      const chat=catalog.find(item=>item.key===entry.chatKey);
      if(!chat){this.db.prepare("UPDATE inbox SET state='failed' WHERE id=?").run(entry.id);continue;}
      if(this.accepted(entry,chat)!=='queued')continue;
      if(this.sessions.list().some(item=>item.chatId===chat.chatId&&item.projectPath.toLowerCase()===chat.projectPath.toLowerCase()&&item.busy))continue;
      if(entry.claimed&&Date.now()-Number(entry.claimed)<30000)continue;
      return {id:entry.id,chat:{chatId:chat.chatId,projectPath:chat.projectPath,name:chat.name,projectName:chat.project,customName:true},text:entry.text};
    }
    return null;
  }
  /** Atomically lease one message to a matching desktop renderer for thirty seconds. */
  async take(owner:number,chat:any){const next=await this.next();if(!next||next.chat.chatId!==chat?.chatId||next.chat.projectPath.toLowerCase()!==String(chat?.projectPath).toLowerCase())return null;const claimed=this.db.prepare("UPDATE inbox SET owner=?,claimed=? WHERE id=? AND state='queued' AND (claimed IS NULL OR claimed<?)").run(owner,Date.now(),next.id,Date.now()-30000);return Number(claimed.changes)===1?next:null;}
  /** A persisted user message acknowledges acceptance, independently of model completion. */
  accept(id:string){this.db.prepare("UPDATE inbox SET state='accepted' WHERE id=?").run(id);}
  /** A failed owner relinquishes dispatch without silently replaying an uncertain message. */
  release(owner:number,id:string){this.db.prepare("UPDATE inbox SET state='failed',text='' WHERE id=? AND owner=? AND state='queued'").run(id,owner);}
  close(){this.db.close();}
}
