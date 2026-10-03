import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SessionHub } from './session-hub.js';

/** Status-only relay. External permission decisions always stay in the originating terminal. */
export class AgentRelay {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  private plans = new Map<string, {root:string;file:string;before:string;after:string;createdAt:number}>();
  constructor(private directory:string, private helper:string, private hub:SessionHub) {}
  async start() {
    if(this.server)return;
    const pipe=`\\\\.\\pipe\\codeclub-${randomUUID()}`;
    const server=createServer(socket=>{
      this.sockets.add(socket);socket.setTimeout(1000,()=>socket.destroy());
      socket.on('close',()=>this.sockets.delete(socket));socket.on('error',()=>socket.destroy());
      let input='';socket.setEncoding('utf8');
      socket.on('data',chunk=>{
        input+=chunk;if(Buffer.byteLength(input)>16384){socket.destroy();return;}
        if(!input.includes('\n'))return;
        try {this.receive(JSON.parse(input.split('\n')[0]));socket.end('{"handled":false}\n');}catch{socket.destroy();}
      });
    });
    this.server=server;
    try {await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(pipe,()=>{server.removeListener('error',reject);resolve();});});
      server.on('error',()=>this.stop());
      await fs.writeFile(path.join(this.directory,'agent-relay.json'),JSON.stringify({pipe}));
    }catch(error){this.stop();throw error;}
  }
  stop() {this.sockets.forEach(socket=>socket.destroy());this.sockets.clear();this.server?.close();this.server=null;}
  receive(value:any) {
    if(typeof value?.session_id!=='string'||value.session_id.length>200)throw new Error('Invalid external session');
    const states:Record<string,string>={SessionStart:'idle',UserPromptSubmit:'thinking',PreToolUse:'working',PostToolUse:'thinking',PostToolUseFailure:'error',Notification:'question',Stop:'finished',StopFailure:'error',SessionEnd:'finished'};
    const state=states[value.hook_event_name];if(!state)return;
    // Deliberately discard prompts, tool inputs, messages and credential-bearing fields.
    this.hub.external(`agent:${value.session_id}`,`Claude Code · ${path.basename(String(value.cwd||'')).slice(0,80) || 'Session'}`,state,String(value.tool_name||'').slice(0,100));
  }
  async preview(root:string) {
    const canonical=await fs.realpath(root);
    const folder=path.join(canonical,'.claude');
    try {const actual=await fs.realpath(folder);if(actual!==folder)throw new Error('Hooks folder must not be a link');}catch(error:any){if(error.code!=='ENOENT')throw error;}
    const file=path.join(folder,'settings.local.json');let before='';
    try {if((await fs.lstat(file)).isSymbolicLink())throw new Error('Hook settings must not be a link');before=await fs.readFile(file,'utf8');}catch(error:any){if(error.code!=='ENOENT')throw error;}
    const settings=before?JSON.parse(before):{};
    if(!settings||typeof settings!=='object'||Array.isArray(settings)|| (settings.hooks && (typeof settings.hooks!=='object'||Array.isArray(settings.hooks))))throw new Error('Invalid hook settings');
    settings.hooks ||= {};
    for(const event of ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','Notification','Stop','StopFailure','SessionEnd']){
      const command=`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${this.helper}" -RelayFile "${path.join(this.directory,'agent-relay.json')}"`;
      const entries=settings.hooks[event] || [];
      if(!Array.isArray(entries))throw new Error('Invalid hook entries');
      if(!entries.some((entry:any)=>entry.hooks?.some((hook:any)=>hook.command===command)))entries.push({hooks:[{type:'command',command,timeout:2,async:true}]});
      settings.hooks[event]=entries;
    }
    const after=JSON.stringify(settings,null,2)+'\n',id=randomUUID();
    this.plans.clear();this.plans.set(id,{root:canonical,file,before,after,createdAt:Date.now()});return {id,file,before,after};
  }
  async install(id:string) {
    const plan=this.plans.get(id);this.plans.delete(id);
    if(!plan || Date.now()-plan.createdAt>300000)throw new Error('Hook preview expired');
    const current=await this.preview(plan.root);this.plans.clear();
    if(current.before!==plan.before)throw new Error('Hook settings changed. Preview again.');
    await fs.mkdir(path.dirname(plan.file),{recursive:true});
    let backup:string|undefined;
    if(plan.before){backup=`${plan.file}.codeclub-${Date.now()}.bak`;await fs.writeFile(backup,plan.before,{flag:'wx'});}
    const temp=`${plan.file}.codeclub-${randomUUID()}.tmp`;await fs.writeFile(temp,plan.after,{flag:'wx'});await fs.rename(temp,plan.file);
    return {file:plan.file,backup};
  }
}
