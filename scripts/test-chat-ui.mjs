import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { ChatStore } from '../electron-dist/chat-store.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=await mkdtemp(path.join(tmpdir(),'codeclub-chat-ui-'));
const store=new ChatStore(directory);
const files=new Map();
let browser,server;
let networkMessages=[];
const pageErrors=[];
try {
  const rows=Array.from({length:10000},(_,index)=>({role:index%2?'assistant':'user',content:`QA message ${index}`,createdAt:Date.now()+index}));
  await store.saveTail('','long',0,rows);
  await store.saveTail('','retry',0,rows.map((row,index)=>index===9998?{...row,content:'QA tall retry '+ 'paragraph '.repeat(400)}:row));
  await store.saveTail('','slow',0,[{role:'user',content:'SLOW user'},{role:'assistant',content:'SLOW response'}]);
  await store.saveTail('','fast',0,[{role:'user',content:'FAST user'},{role:'assistant',content:'FAST response'}]);
  await store.saveTail('','varied',0,rows.map((row,index)=>({...row,content:index===9999?'QA varied last':index%2===1?`QA varied ${index}\n\n${'Paragraph with different wrapping and line height. '.repeat(index%7*12+1)}`:row.content})));
  const entry=path.join(directory,'entry.tsx'),bundle=path.join(directory,'app.js');
  await writeFile(entry,`import React from 'react';import {createRoot} from 'react-dom/client';import ChatInterface from ${JSON.stringify(path.join(repo,'src/components/ChatInterface.tsx'))};const provider={id:'qa',label:'QA',api:location.origin+'/v1',type:'provider',requiresApiKey:false};const model={id:'qa-model',label:'QA model',providerId:'qa',type:'model',contextWindow:32768};createRoot(document.getElementById('root')!).render(<div style={{height:'100vh',background:'var(--codeclub-chat-background)'}}><ChatInterface catalog={[provider,model]} defaultProvider={provider} defaultModel={model} eventPrefix="codeclub:qa"/></div>);`);
  await build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(repo,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const cssDirectory=path.join(repo,'out/_next/static/chunks');
  const styles=(await readdir(cssDirectory)).filter(file=>file.endsWith('.css'));
  const stylesheet=(await Promise.all(styles.map(file=>readFile(path.join(cssDirectory,file),'utf8')))).join('\n');
  files.set('/qa/settings.json',JSON.stringify({codeclub_last_provider_id:'qa',codeclub_last_model_id:'qa-model',codeclub_api_key_qa:'fixture-only'}));
  server=createServer(async (request,response)=>{
    if(request.url==='/app.js'){response.setHeader('content-type','text/javascript');response.end(await readFile(bundle));return;}
    if(request.url==='/style.css'){response.setHeader('content-type','text/css');response.end(stylesheet);return;}
    if(request.url?.startsWith('/v1')) {
      let body='';for await(const chunk of request)body+=chunk;
      const data=JSON.parse(body||'{}');networkMessages=data.messages||[];
      response.setHeader('access-control-allow-origin','*');
      if(data.stream) {
        response.setHeader('content-type','text/event-stream');
        const delta=(text,finish=null)=>response.write('data: '+JSON.stringify({id:'qa',object:'chat.completion.chunk',created:1,model:'qa-model',choices:[{index:0,delta:text?{content:text}:{},finish_reason:finish}]})+'\n\n');
        for(let index=0;index<30;index++){delta(index===0?'Respuesta QA. ':`stream ${index} `);await new Promise(resolve=>setTimeout(resolve,15));}
        delta('', 'stop');response.end('data: [DONE]\n\n');
      } else {response.setHeader('content-type','application/json');response.end(JSON.stringify({id:'qa',object:'chat.completion',created:1,model:'qa-model',choices:[{index:0,message:{role:'assistant',content:'Respuesta QA.'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));}
      return;
    }
    response.setHeader('content-type','text/html');response.end('<html><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  page.on('pageerror',error=>{pageErrors.push(error.message);console.error('UI error:',error.message);});
  page.on('console',message=>{if(message.type()==='error')console.error('Browser:',message.text().slice(0,1200));});
  await page.route('https://models.dev/**',route=>route.fulfill({json:{providers:{}}}));
  await page.route('https://ai-gateway.vercel.sh/**',route=>route.fulfill({json:{data:[]}}));
  await page.exposeFunction('qaBridge',async ({method,args})=>{
    switch(method){
      case 'chatTurns':if(args[1]==='slow')await new Promise(resolve=>setTimeout(resolve,200));if(args[1]==='retry'){args[3]=1;}return store.turnPage(...args);
      case 'chatPage':return store.page(...args);
      case 'chatContext':return store.context(...args);
      case 'chatSaveTail':return store.saveTail(...args);
      case 'chatAppend':return store.append(...args);
      case 'chatSearch':return store.search(...args);
      case 'chatTranscript':return store.transcript(...args);
      case 'chatAll':return store.all(...args);
      case 'fileExists':return files.has(args[0]);
      case 'readTextFile':return files.get(args[0])||'';
      case 'writeTextFile':files.set(args[0],args[1]);return true;
      case 'joinPath':return args.join('/').replace(/\/+/g,'/');
      case 'appConfigDir':return '/qa';
      case 'appCacheDir':return '/qa/cache';
      case 'makeDirectory':return true;
      case 'invoke':
        if(args[0]==='codeclub_http_fetch'){
          const request=args[1].request;
          if(!request.url.startsWith(`http://127.0.0.1:${server.address().port}/v1/`))throw new Error('Unexpected test provider URL');
          const response=await fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers.map(header=>[header.name,header.value])),body:request.body});
          return {body:await response.text(),status:response.status,status_text:response.statusText,headers:[...response.headers].map(([name,value])=>({name,value}))};
        }
        if(args[0]==='codeclub_get_username')return 'QA';if(args[0]==='codeclub_get_system_root')return '/qa';if(args[0]==='codeclub_run_command')return {stdout:'',stderr:'',code:0};return [];
      default:return null;
    }
  });
  await page.addInitScript(()=>{const bridge={};for(const method of ['invoke','chatTurns','chatPage','chatContext','chatSaveTail','chatAppend','chatSearch','chatTranscript','chatAll','fileExists','readTextFile','writeTextFile','joinPath','appConfigDir','appCacheDir','makeDirectory'])bridge[method]=(...args)=>window.qaBridge({method,args});window.codeclub=bridge;});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector('#root > div > div');
  await page.waitForTimeout(150);
  const open=id=>page.evaluate(chatId=>window.dispatchEvent(new CustomEvent('codeclub:qa:open-chat',{detail:{chatId,projectPath:'',name:chatId}})),id);
  await open('long');
  await page.getByText('QA message 9999',{exact:true}).waitFor();
  await page.waitForTimeout(150);
  const mounted=await page.locator('.chat-turn').count();assert.ok(mounted<30,`Too many mounted turns: ${mounted}`);
  const bottom=await page.locator('.messages-area').evaluate(area=>area.scrollHeight-area.scrollTop-area.clientHeight);assert.ok(bottom<10,'Opened chat is pinned to its latest turn');
  await page.locator('.messages-area').evaluate(area=>{area.scrollTop=0;});
  await page.waitForTimeout(250);
  const firstIndex=await page.locator('.chat-turn').first().getAttribute('aria-label');assert.ok(Number(firstIndex.match(/\d+/)[0])<9971,'Older turns load when scrolling up');
  await page.evaluate(()=>{
    window.qaTransitionFrames=[];window.qaRecording=true;
    const sample=()=>{
      const area=document.querySelector('.messages-area');
      if(area)window.qaTransitionFrames.push({text:area.textContent,opacity:Number(getComputedStyle(area).opacity),phase:area.dataset.chatTransition,bottom:area.scrollHeight-area.scrollTop-area.clientHeight});
      if(window.qaRecording)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
  await open('slow');await open('fast');await page.getByText('FAST response',{exact:true}).waitFor();await page.waitForTimeout(300);
  const transitionFrames=await page.evaluate(()=>{window.qaRecording=false;return window.qaTransitionFrames;});
  assert.ok(transitionFrames.some(frame=>frame.phase==='exiting'),'Old chat finishes its exit');
  assert.ok(transitionFrames.some(frame=>frame.phase==='entering'),'New chat enters after loading');
  assert.ok(!transitionFrames.some(frame=>frame.text.includes('FAST response')&&frame.text.includes('QA message')),'Chats never overlap');
  assert.ok(!transitionFrames.some(frame=>frame.text.includes('FAST response')&&frame.opacity>0.1&&frame.bottom>10),'New chat is positioned before appearing');
  assert.equal(await page.getByText('SLOW response',{exact:true}).count(),0,'Late history cannot replace the active chat');
  await page.evaluate(()=>{
    window.qaLayoutFrames=[];window.qaRecordingLayout=true;
    const sample=()=>{
      const area=document.querySelector('.messages-area'),last=area?.querySelector('.chat-turn.is-last');
      if(last?.textContent.includes('QA varied last')&&Number(getComputedStyle(area).opacity)>0.1)window.qaLayoutFrames.push(last.getBoundingClientRect().top);
      if(window.qaRecordingLayout)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
  await open('varied');await page.getByText('QA varied last',{exact:true}).waitFor();
  await page.locator('.messages-area[data-chat-transition="idle"]').waitFor();
  await page.waitForTimeout(200);
  const layoutFrames=await page.evaluate(()=>{window.qaRecordingLayout=false;return window.qaLayoutFrames;});
  assert.ok(layoutFrames.length>3,'Sampled visible variable-height history');
  assert.ok(Math.max(...layoutFrames)-Math.min(...layoutFrames)<1,'Last turn stays in position throughout and after entry');
  await open('long');await page.getByText('QA message 9999',{exact:true}).waitFor();
  await page.locator('.messages-area[data-chat-transition="idle"]').waitFor();
  const input=page.locator('textarea').first();await input.fill('Hola QA');await input.press('Enter');
  try{await page.getByText(/Respuesta QA\./).waitFor({timeout:10000});}catch(error){console.error('After send:',(await page.locator('body').innerText()).slice(-1800));console.error('Stored tail:',(await store.page('','long',undefined,2)).messages);throw error;}
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');
  for(let attempt=0;attempt<100&&(await store.page('','long')).total!==10002;attempt++)await page.waitForTimeout(50);
  assert.equal((await store.page('','long')).total,10002,'Streaming saves only the two new messages');
  assert.equal((await store.page('','long',1,1)).messages[0].content,'QA message 0','Oldest history remains intact after sending');
  assert.ok(networkMessages.length<100,'Provider receives bounded context');
  assert.ok(networkMessages.some(message=>typeof message.content==='string'&&message.content.includes('Hola QA')),'Latest prompt remains in context');
  assert.ok((await store.page('','long')).messages.at(-1).content.includes('Respuesta QA.'),'Final stream was persisted');
  await open('retry');await page.getByText('QA message 9999',{exact:true}).waitFor();
  await page.locator('.messages-area[data-chat-transition="idle"]').waitFor();
  await page.getByRole('button',{name:'Más opciones de la respuesta'}).last().click();
  await page.getByRole('button',{name:'Regenerar respuesta'}).click();
  await page.getByText(/Respuesta QA\./).waitFor();
  for(let attempt=0;attempt<100;attempt++){
    if((await store.page('','retry')).messages.at(-1)?.content.includes('Respuesta QA.'))break;
    await page.waitForTimeout(50);
  }
  assert.equal((await store.page('','retry')).total,10000,'Retry of first visible user preserves absolute position');
  assert.equal((await store.page('','retry',1,1)).messages[0].content,'QA message 0','Retry preserves unloaded prefix');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:language-change',{detail:{language:'en'}})));
  await page.getByRole('button',{name:'Más opciones de la respuesta'}).last().click();
  await page.getByRole('button',{name:'Regenerate response'}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:language-change',{detail:{language:'es'}})));
  await page.getByRole('button',{name:'Regenerar respuesta'}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat')));
  await page.locator('.messages-area[data-chat-transition="idle"]').waitFor();
  assert.equal(await page.locator('.chat-turn').count(),0,'New chat clears the previous turn after its exit');
  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({passed:true,fixtureMessages:10000,mountedTurns:mounted,providerMessages:networkMessages.length,raceProtected:true,streamPersisted:true,sequentialTransitions:true,stableEntry:true}));
}finally{
  await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());store.close();
  const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('codeclub-chat-ui-'))throw new Error('Unexpected UI test directory');
  await rm(resolved,{recursive:true,force:true});
}
