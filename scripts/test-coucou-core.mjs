import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SessionHub } from '../electron-dist/session-hub.js';
import { CredentialVault } from '../electron-dist/credential-vault.js';
import { ActivityIntegrations } from '../electron-dist/activity-integrations.js';
import { AgentRelay } from '../electron-dist/agent-relay.js';
import { idleWidgetMode } from '../src/lib/widget-state.ts';

const directory=await mkdtemp(path.join(tmpdir(),'codeclub-coucou-test-'));
let poller;
try {
  const key=randomBytes(32);
  const crypto={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(16),cipher=createCipheriv('aes-256-cbc',key,iv);return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final()]);},decryptString(bytes){const decipher=createDecipheriv('aes-256-cbc',key,bytes.subarray(0,16));return Buffer.concat([decipher.update(bytes.subarray(16)),decipher.final()]).toString();}};
  const vault=new CredentialVault(directory,crypto);
  const settingsFile=path.join(directory,'settings.json');
  await writeFile(settingsFile,JSON.stringify({qa_api_key:'fixture-secret',language:'es'}));vault.migrate(settingsFile);
  assert.equal(vault.present('qa_api_key'),true);assert.deepEqual(JSON.parse(await readFile(settingsFile,'utf8')),{language:'es'});
  assert.ok(!(await readFile(path.join(directory,'credentials.encrypted.json'),'utf8')).includes('fixture-secret'));
  assert.equal(vault.authorization('qa_api_key','https://fixture.example/v1'),'fixture-secret');
  assert.throws(()=>vault.authorization('qa_api_key','https://other.example/v1'),/mismatch/);
  assert.equal(new CredentialVault(directory,crypto).authorization('qa_api_key','https://fixture.example/v1'),'fixture-secret');
  assert.throws(()=>new CredentialVault(directory,{...crypto,isEncryptionAvailable:()=>false}).set('x_api_key','fixture'),/unavailable/);
  vault.set('qa_api_key','');assert.equal(vault.present('qa_api_key'),false);

  const hub=new SessionHub();const chat={chatId:'same',projectPath:'C:/Project',name:'Test'};
  const run=hub.claim(1,chat);
  assert.throws(()=>hub.claim(2,{...chat,projectPath:'c:\\project\\'}),/ALREADY_RUNNING/);
  assert.equal(hub.publish(2,chat,run,{busy:false}),false);
  assert.equal(hub.publish(1,chat,'stale',{busy:false}),false);
  const future=Date.now()+60000;
  hub.publish(1,chat,run,{busy:true,state:'approval',messages:Array.from({length:200},(_,id)=>({id})),approvals:[{id:'a',expiresAt:future},{id:'b',expiresAt:future},{id:'expired',expiresAt:0}]});
  assert.equal(hub.list()[0].messages.length,80);assert.equal(hub.command(chat,'approve','expired'),null);
  assert.equal(hub.command(chat,'approve','a').owner,1);assert.equal(hub.command(chat,'approve','a'),null);
  assert.equal(hub.list()[0].approvals[0].id,'b','A second approval remains pending');
  assert.equal(hub.command(chat,'cancel').runId,run);
  hub.disconnect(1);assert.equal(hub.list()[0].state,'interrupted');assert.equal(hub.list()[0].busy,false);
  const next=hub.claim(2,chat);assert.notEqual(next,run);assert.equal(hub.publish(1,chat,run,{busy:true}),false);
  hub.publish(2,chat,next,{busy:false,state:'finished'});
  for(let id=0;id<200;id++)hub.external(`test-${id}`,'External','finished');assert.ok(hub.list().length<=100);
  assert.equal(idleWidgetMode('expanded',true,true),'expanded');assert.equal(idleWidgetMode('expanded',false,false),'expanded');assert.equal(idleWidgetMode('expanded',false,true),'compact');assert.equal(idleWidgetMode('compact',false,true),'retracted');

  let requests=0;
  vault.set('vercel_integration_api_key','fixture-vercel','https://api.vercel.com');
  poller=new ActivityIntegrations(path.join(directory,'integrations.json'),vault,hub,async url=>{
    requests++;
    return {ok:true,json:async()=>url.includes('/actions/')?{workflow_runs:[{id:1,name:'CI',status:'completed',conclusion:'failure',html_url:'https://github.com/qa/repo/actions/runs/1'}]}:url.includes('/pulls?')?[{id:2,title:'Review',requested_reviewers:[{login:'qa'}],html_url:'https://github.com/qa/repo/pull/2'}]:{deployments:[{uid:'deploy',name:'App',readyState:'READY',url:'qa.vercel.app'}]}};
  });
  poller.save({githubRepo:'qa/repo',githubUser:'qa',vercelProject:'prj_qa',paused:false});
  while(requests<3)await new Promise(resolve=>setTimeout(resolve,10));await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(hub.list().find(item=>item.chatId==='github-run:1').state,'error');
  assert.equal(hub.list().find(item=>item.chatId==='github-pr:2').state,'question');
  assert.equal(hub.list().find(item=>item.chatId==='vercel:deploy').state,'finished');
  poller.save({paused:true});const before=requests;await poller.poll();assert.equal(requests,before,'Pause prevents networking');
  assert.throws(()=>poller.save({githubRepo:'bad/../../repo'}),/Invalid/);
  const project=path.join(directory,'project');await mkdir(path.join(project,'.claude'),{recursive:true});
  const hookFile=path.join(project,'.claude','settings.local.json');const original=JSON.stringify({permissions:{allow:['Read']},hooks:{Stop:[{hooks:[{type:'command',command:'existing'}]}]}});
  await writeFile(hookFile,original);const relay=new AgentRelay(directory,path.join(directory,'helper.ps1'),hub);
  const preview=await relay.preview(project);assert.equal(await readFile(hookFile,'utf8'),original,'Preview is read-only');
  const installed=await relay.install(preview.id);assert.equal(await readFile(installed.backup,'utf8'),original);
  const hooks=JSON.parse(await readFile(hookFile,'utf8'));assert.deepEqual(hooks.permissions,{allow:['Read']});assert.equal(hooks.hooks.Stop.length,2);assert.equal(hooks.hooks.PermissionRequest,undefined);
  const again=await relay.preview(project);assert.equal(JSON.parse(again.after).hooks.Stop.length,2,'Hook installation is idempotent');
  await writeFile(hookFile,'{}');await assert.rejects(relay.install(again.id),/changed/);
  relay.receive({session_id:'external',hook_event_name:'PreToolUse',cwd:project,tool_name:'Read',tool_input:{secret:'never-forward'}});
  const session=hub.list().find(item=>item.chatId==='agent:external');assert.equal(session.state,'working');assert.ok(!JSON.stringify(session).includes('never-forward'));
  console.log(JSON.stringify({passed:true,ownership:true,approvalQueue:true,expiry:true,boundedHistory:true,encryptedMigration:true,originBinding:true,pausedIntegrations:true,hooksPreviewBackup:true,externalPrivacy:true}));
}finally{
  poller?.stop();const resolved=path.resolve(directory);
  if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('codeclub-coucou-test-'))throw new Error('Unexpected test directory');
  await rm(resolved,{recursive:true,force:true});
}
