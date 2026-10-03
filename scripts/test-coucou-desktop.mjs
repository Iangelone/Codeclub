import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=await mkdtemp(path.join(tmpdir(),'codeclub-coucou-desktop-'));
let desktop,server;const errors=[];let cancelledRequests=0,completedRequests=0;
try {
  server=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    const data=JSON.parse(body||'{}');
    assert.equal(request.headers.authorization,'Bearer fixture-secret','Native transport supplies the secret');
    if(data.messages?.some(message=>String(message.content).includes('billing-check'))){response.statusCode=403;response.setHeader('content-type','application/json');response.end(JSON.stringify({error:{message:'A valid credit card on file is required.'}}));return;}
    if(data.stream){
      response.setHeader('content-type','text/event-stream');let complete=false;
      response.on('close',()=>{if(!complete)cancelledRequests++;});
      const delta=(content,finish=null)=>response.write('data: '+JSON.stringify({id:'qa',object:'chat.completion.chunk',created:1,model:'qa-model',choices:[{index:0,delta:content?{content}:{},finish_reason:finish}]})+'\n\n');
      const slow=data.messages?.some(message=>String(message.content).includes('cancel-me'));
      for(let i=0;i<(slow?100:12);i++){if(response.destroyed)return;delta(i===0?'Respuesta compartida QA. ':`parte ${i} `);await new Promise(resolve=>setTimeout(resolve,50));}
      complete=true;completedRequests++;delta('','stop');response.end('data: [DONE]\n\n');
    }else{response.setHeader('content-type','application/json');response.end(JSON.stringify({id:'qa',object:'chat.completion',created:1,model:'qa-model',choices:[{index:0,message:{role:'assistant',content:'Respuesta QA'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  await writeFile(path.join(directory,'settings.json'),JSON.stringify({qa_api_key:'fixture-secret',codeclub_last_provider_id:'qa',codeclub_last_model_id:'qa-model'}));
  const launcher=path.join(directory,'launcher.mjs');
  await writeFile(launcher,`import {app} from ${JSON.stringify(path.join(repo,'node_modules/electron/index.js'))};app.setPath('userData',${JSON.stringify(directory)});app.setPath('sessionData',${JSON.stringify(directory)});await new Promise(resolve=>setTimeout(resolve,1500));await import(${JSON.stringify(pathToFileURL(path.join(repo,'electron-dist/main.js')).href)});`);
  // Electron's built-in module must be imported by name, not the Node package shim.
  await writeFile(launcher,(await readFile(launcher,'utf8')).replace(JSON.stringify(path.join(repo,'node_modules/electron/index.js')),"'electron'"));
  await writeFile(launcher,`import {Tray} from 'electron';const original=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.__qaTrayMenu=menu;return original.call(this,menu)};`+await readFile(launcher,'utf8'));
  desktop=await _electron.launch({args:[launcher],cwd:repo,env:{...process.env,CODECLUB_NEXT_DEV_URL:''},timeout:30000});
  await desktop.context().route('https://models.dev/**',route=>route.fulfill({json:{providers:{qa:{id:'qa',name:'QA',api:origin+'/v1',env:['QA_API_KEY'],models:{'qa-model':{id:'qa-model',name:'QA model',limit:{context:32768}}}}}}}));
  await desktop.context().route('https://ai-gateway.vercel.sh/**',route=>route.fulfill({json:{data:[]}}));
  desktop.context().on('page',page=>page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);}));
  const main=await desktop.firstWindow();main.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
  await main.getByRole('button',{name:'Actividad',exact:true}).waitFor({timeout:30000});
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Codeclub')?.setTitle('Codeclub · QA Coucou'));
  main.on('console',message=>{if(message.type()==='error')console.error(message.text().slice(0,500));});
  await main.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat')));
  await main.locator('.messages-area[data-chat-transition="idle"]').waitFor();
  const input=main.locator('textarea').first();await input.waitFor();await input.fill('cancel-me');await input.press('Enter');
  try {await main.getByRole('button',{name:'Cancelar generación',exact:true}).waitFor({timeout:5000});}catch(error){console.log((await main.locator('body').innerText()).slice(-2000));console.log(await main.evaluate(()=>window.codeclub.sessionList()));throw error;}
  const list=await main.evaluate(()=>window.codeclub.sessionList());assert.equal(list.filter(item=>item.busy).length,1);
  const chat=list.find(item=>item.busy);
  const floatPromise=desktop.waitForEvent('window');await main.evaluate(()=>window.codeclub.windowClose());
  const floating=await floatPromise;floating.on('pageerror',error=>errors.push(error.message));
  await floating.locator('.floating-shell').waitFor();
  assert.equal(await floating.locator('.floating-activity').count(),0,'Widget has no status banner');
  assert.equal(await floating.getByRole('button',{name:'Adjuntar',exact:true}).count(),0,'Widget has no attachment icon');
  assert.equal(await floating.locator('.floating-model').count(),0,'Widget has no model selector');
  await floating.getByRole('button',{name:'Cancelar generación',exact:true}).waitFor();
  const remote=await floating.evaluate(()=>window.codeclub.sessionList());assert.equal(remote.find(item=>item.chatId===chat.chatId).localOwner,false);
  await assert.rejects(floating.evaluate(chat=>window.codeclub.sessionClaim(chat),chat),/SESSION_ALREADY_RUNNING/);
  await floating.getByRole('button',{name:'Cancelar generación',exact:true}).click();
  await floating.waitForFunction(()=>window.codeclub.sessionList().then(items=>!items.some(item=>item.busy)));
  await new Promise(resolve=>setTimeout(resolve,200));assert.ok(cancelledRequests>0,'Widget cancellation aborts native transport');
  await floating.locator('textarea').fill('hello fixture');await floating.locator('textarea').press('Enter');
  await floating.getByText(/Respuesta compartida QA/).first().waitFor({timeout:20000});
  await floating.waitForFunction(()=>window.codeclub.sessionList().then(items=>!items.some(item=>item.busy)));
  assert.equal(completedRequests,1);const current=await floating.evaluate(()=>window.codeclub.sessionSelected());
  assert.equal(await floating.locator('.chat-user-message').count(),0,'Widget never renders user messages');
  assert.equal(await floating.locator('.chat-assistant-message').count(),1,'Widget renders the latest agent response only');
  const widgetVisible=()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('floating=1'))?.isVisible());
  const toggleWidget=()=>desktop.evaluate(()=>globalThis.__qaTrayMenu.items.find(item=>item.label==='Widget').click());
  await floating.getByRole('button',{name:'Cerrar widget',exact:true}).click();
  await expect.poll(widgetVisible).toBe(false);
  await toggleWidget();
  await expect.poll(widgetVisible).toBe(true);
  await floating.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.floating-shell')).opacity)===1);
  await floating.locator('textarea').click();
  await floating.getByRole('button',{name:'Cerrar widget',exact:true}).click();
  await toggleWidget(); // A late exit acknowledgement must not hide the reopened widget.
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(await widgetVisible(),true,'Reopening cancels a pending close');
  await floating.locator('textarea').click();
  await floating.locator('.floating-shell.is-expanded').waitFor();
  await floating.getByRole('button',{name:'Abrir Codeclub',exact:true}).click();
  await expect.poll(widgetVisible).toBe(false);
  await main.getByText(/Respuesta compartida QA/).first().waitFor();
  assert.equal(await main.locator('.chat-user-message').count(),2,'ADE still renders the full conversation');
  const visible=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(window=>window.isVisible()).map(window=>window.getTitle()));
  assert.ok(!visible.includes('Codeclub · Orb'),'Opening ADE hides widget');
  const history=await main.evaluate(chat=>window.codeclub.chatAll(chat.projectPath,chat.chatId),current);
  assert.equal(history.filter(message=>message.role==='user').length,2,'Switching surfaces does not duplicate messages');
  assert.ok(!(await readFile(path.join(directory,'settings.json'),'utf8')).includes('fixture-secret'));
  assert.ok(!(await readFile(path.join(directory,'credentials.encrypted.json'),'utf8')).includes('fixture-secret'));
  await main.getByRole('button',{name:'Actividad',exact:true}).click();await main.getByRole('button',{name:'Integraciones',exact:true}).click();
  await main.getByText('Pausar consultas',{exact:true}).waitFor();
  await main.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:language-change',{detail:{language:'en'}})));
  await main.getByText('Pause polling',{exact:true}).waitFor();
  await main.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:language-change',{detail:{language:'es'}})));
  const pendingChat={chatId:'qa-pending-attention',projectPath:'',name:'QA pendiente'};
  await main.evaluate(async chat=>{
    const runId=await window.codeclub.sessionClaim(chat);
    await window.codeclub.sessionPublish(chat,runId,{state:'error',busy:false,messages:[],approvals:[]});
  },pendingChat);
  await main.evaluate(()=>window.codeclub.windowClose());
  const bell=floating.getByRole('button',{name:'Abrir pendiente',exact:true,includeHidden:true});
  await expect(bell).toBeEnabled();
  await floating.locator('textarea').click();
  await floating.getByRole('button',{name:'Contraer chat',exact:true}).click();
  await expect(bell).toBeHidden();
  await expect(floating.getByRole('button',{name:'Cerrar widget',exact:true})).toBeHidden();
  await floating.locator('textarea').click();
  await expect(bell).toBeVisible();
  await bell.click();
  await floating.locator('.floating-shell.is-expanded').waitFor();
  await expect.poll(()=>floating.evaluate(()=>window.codeclub.sessionSelected().then(chat=>chat?.chatId))).toBe(pendingChat.chatId);
  assert.ok(!(await floating.locator('.floating-shell').innerText()).includes('Requiere atención'));
  await floating.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:language-change',{detail:{language:'en'}})));
  await expect(floating.getByRole('button',{name:'Open pending item',exact:true})).toBeEnabled();
  await floating.evaluate(()=>window.codeclub.floatingOpenMain());
  await main.evaluate(()=>{window.dispatchEvent(new CustomEvent('codeclub:language-change',{detail:{language:'en'}}));window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat'));});
  await main.locator('.messages-area[data-chat-transition="idle"]').waitFor();
  await main.locator('textarea').first().fill('billing-check');await main.locator('textarea').first().press('Enter');
  await expect(main.locator('.chat-assistant-message').last()).toContainText('payment method on file',{timeout:15000});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,nativeEncryption:true,sharedExecution:true,remoteCancel:true,transportAbort:true,noDuplicateMessages:true,sharedHistory:true,languageSwitch:true,widgetAgentOnly:true,widgetLatestOnly:true,widgetMinimalControls:true,widgetCloseReopen:true,widgetCloseRace:true}));
  if(process.env.CODECLUB_QA_KEEP_OPEN){
    await main.evaluate(()=>window.codeclub.windowClose());
    await floating.locator('textarea').click();
    await floating.locator('.floating-shell.is-expanded').waitFor();
    await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Codeclub · Orb')?.setTitle('Codeclub · Widget QA'));
    console.log('QA_READY_FOR_COMPUTER_USE');
    await new Promise(resolve=>{let input='';const finish=data=>{input+=String(data);if(input.includes('finish')){process.stdin.removeListener('data',finish);resolve();}};process.stdin.on('data',finish);});
  }
}finally{
  await desktop?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
  const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('codeclub-coucou-desktop-'))throw new Error('Unexpected desktop test directory');
  await rm(resolved,{recursive:true,force:true});
}
