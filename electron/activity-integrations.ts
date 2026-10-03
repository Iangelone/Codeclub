import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { CredentialVault } from './credential-vault.js';
import type { SessionHub } from './session-hub.js';

export type IntegrationConfig = { githubRepo: string; githubUser: string; vercelProject: string; vercelTeam: string; paused: boolean; externalAgents?: boolean };
const empty: IntegrationConfig = { githubRepo:'', githubUser:'', vercelProject:'', vercelTeam:'', paused:false, externalAgents:false };
export function validateIntegrationConfig(value: any): IntegrationConfig {
  const config = { ...empty, ...Object.fromEntries(Object.keys(empty).map(key => [key, value?.[key] ?? empty[key as keyof IntegrationConfig]])) } as IntegrationConfig;
  for (const key of ['githubRepo','githubUser','vercelProject','vercelTeam'] as const) {
    config[key] = String(config[key]).trim();
    if (config[key].length > 200 || (config[key] && !(key==='githubRepo'?/^[\w.-]+\/[\w.-]+$/:/^[\w.-]+$/).test(config[key]))) throw new Error('Invalid integration identifier');
  }
  config.paused = config.paused === true; config.externalAgents = config.externalAgents === true;
  return config;
}

/** Read-only, opt-in poller. One round at a time; pause aborts requests immediately. */
export class ActivityIntegrations {
  private config: IntegrationConfig;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seen = new Map<string,string>();
  private enabled=false;
  constructor(private file: string, private vault: CredentialVault, private hub: SessionHub, private request: typeof fetch = fetch) {
    this.config = existsSync(file) ? validateIntegrationConfig(JSON.parse(readFileSync(file,'utf8'))) : {...empty};
  }
  getConfig() { return {...this.config}; }
  save(value: unknown) {
    const config = validateIntegrationConfig(value);
    const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(config));renameSync(temp,this.file);
    this.config=config;this.seen.clear();this.stop();this.start();return this.getConfig();
  }
  start() { this.enabled=true;if (!this.config.paused && !this.timer && !this.controller) void this.poll(); }
  stop() { this.enabled=false;clearTimeout(this.timer);this.timer=undefined;this.controller?.abort(); }
  private emit(id:string, name:string, state:string, url?:string) {
    if (this.seen.get(id)===state) return;
    this.seen.set(id,state);
    if(this.seen.size>200)this.seen.delete(this.seen.keys().next().value!);
    this.hub.external(id,name,state,'',url);
  }
  async poll() {
    if(this.config.paused || this.controller)return;
    const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),15000);
    const config=this.getConfig();
    const get=async(url:string,key:string)=>{
      const credential=this.vault.authorization(key,url);
      const response=await this.request(url,{headers:{Accept:'application/json',...(credential?{Authorization:`Bearer ${credential}`}:{})},signal:controller.signal,redirect:'error'});
      if(!response.ok)throw new Error('Integration unavailable');return response.json();
    };
    const jobs: Promise<void>[]=[];
    if(config.githubRepo)jobs.push((async()=>{
      try {
        const data=await get(`https://api.github.com/repos/${config.githubRepo}/actions/runs?per_page=5`,'github_integration_api_key');
        if(controller.signal.aborted)return;
        for(const run of data.workflow_runs||[])this.emit(`github-run:${run.id}`,`GitHub · ${run.name||config.githubRepo}`,run.status!=='completed'?'working':run.conclusion==='success'?'finished':run.conclusion==='cancelled'?'cancelled':'error',run.html_url);
        if(config.githubUser){
          const pulls=await get(`https://api.github.com/repos/${config.githubRepo}/pulls?state=open&per_page=30`,'github_integration_api_key');
          if(controller.signal.aborted)return;
          for(const pull of pulls)if(pull.requested_reviewers?.some((user:any)=>user.login.toLowerCase()===config.githubUser.toLowerCase()))this.emit(`github-pr:${pull.id}`,`GitHub · ${pull.title}`,'question',pull.html_url);
        }
      }catch{if(!controller.signal.aborted)this.emit('github-status','GitHub','error');}
    })());
    if(config.vercelProject&&this.vault.present('vercel_integration_api_key'))jobs.push((async()=>{
      try {
        const params=new URLSearchParams({projectId:config.vercelProject,limit:'5'});if(config.vercelTeam)params.set('teamId',config.vercelTeam);
        const data=await get(`https://api.vercel.com/v6/deployments?${params}`,'vercel_integration_api_key');
        if(controller.signal.aborted)return;
        for(const deploy of data.deployments||[]){const state=deploy.readyState||deploy.state;this.emit(`vercel:${deploy.uid}`,`Vercel · ${deploy.name||config.vercelProject}`,state==='READY'?'finished':state==='ERROR'?'error':state==='CANCELED'?'cancelled':'working',deploy.url?`https://${deploy.url}`:undefined);}
      }catch{if(!controller.signal.aborted)this.emit('vercel-status','Vercel','error');}
    })());
    try {await Promise.all(jobs);}finally{
      clearTimeout(timeout);this.controller=null;
      if(this.enabled&&!this.config.paused)this.timer=setTimeout(()=>{this.timer=undefined;void this.poll();},60000);
    }
  }
}
