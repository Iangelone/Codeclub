import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
const html=await readFile('android-companion/app/src/main/assets/mobile.html','utf8');
const assets=new Map(await Promise.all(['i18next.min.js','en.js','es.js','runtime.js'].map(async name=>['/i18n/'+name,await readFile('android-companion/app/src/main/assets/i18n/'+name,'utf8')])));
const server=createServer((request,response)=>{const asset=assets.get(request.url);response.setHeader('content-type',asset?'text/javascript':'text/html');response.end(asset||html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
  await page.addInitScript(()=>{window.mobileRequests=[];window.mobileState={language:'es',linked:false,connected:false,desktop:{chats:[]},localOutbox:[]};window.Codeclub={snapshot:()=>JSON.stringify(window.mobileState),request:value=>window.mobileRequests.push(JSON.parse(value))};});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Escanear QR'}).click();assert.equal(await page.evaluate(()=>mobileRequests.at(-1).action),'scan');
  const key='a'.repeat(64);await page.evaluate(key=>{mobileState={language:'es',linked:true,connected:true,accessibility:true,desktop:{chats:[{key,name:'Your orb',orb:{name:'Renamed orb',color:'#abcdef',shape:'square',model:'Configured model'}}],selectedKey:key,messages:[{id:'0',seq:0,role:'assistant',text:'Hello <img src=x onerror=alert(1)>'}],start:0,total:1,outbox:[]},localOutbox:[]};},key);
  await page.waitForFunction(()=>document.getElementById('name').textContent==='Renamed orb');assert.equal(await page.locator('#messages img').count(),0);assert.equal(await page.locator('#onboarding').isVisible(),false);
  await page.getByRole('textbox').fill('Message from Android');await page.getByRole('button',{name:'Enviar mensaje'}).click();const send=await page.evaluate(()=>mobileRequests.find(request=>request.operation==='send'));assert.equal(send.text,'Message from Android');assert.match(send.id,/^[a-f0-9]{32}$/);
  await page.evaluate(()=>{mobileState.language='en';});await page.waitForFunction(()=>document.getElementById('input').placeholder==='Message your agent…');
  await page.getByRole('button',{name:'Chats',exact:true}).click();assert.equal(await page.locator('#picker').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#picker').isVisible(),false);
  await page.evaluate(()=>{mobileState.desktop.busy=true;mobileState.desktop.approvals=[{id:'approval-test',summary:'Allow a test action'}];});await page.getByRole('button',{name:'Allow',exact:true}).click();assert.equal(await page.evaluate(()=>mobileRequests.find(request=>request.action==='approve').approvalId),'approval-test');
  await page.getByRole('button',{name:'Stop agent',exact:true}).click();assert.equal(await page.evaluate(()=>mobileRequests.find(request=>request.action==='cancel').operation),'control');
  await page.evaluate(()=>{mobileState.desktop.busy=false;mobileState.desktop.approvals=[];mobileState.desktop.messages=[{id:'40',seq:40,role:'assistant',text:'Latest message'}];mobileState.desktop.start=40;mobileState.desktop.total=41;mobileState.desktop.before=null;});
  await page.getByRole('button',{name:'Earlier messages'}).click();await page.waitForFunction(()=>mobileRequests.some(request=>request.before===40));
  await page.evaluate(()=>{mobileState.desktop.messages=[{id:'0',seq:0,role:'assistant',text:'Earlier history'}];mobileState.desktop.start=0;mobileState.desktop.before=40;});await page.waitForFunction(()=>document.getElementById('messages').textContent.includes('Earlier history'));
  await page.evaluate(()=>{mobileState.desktop.messages=[{id:'40',seq:40,role:'assistant',text:'Latest message'}];mobileState.desktop.start=40;mobileState.desktop.before=null;});await page.waitForFunction(()=>{const text=document.getElementById('messages').textContent;return text.includes('Earlier history')&&text.includes('Latest message');});
  await page.evaluate(()=>{mobileState.desktop.messages=[];mobileState.desktop.total=0;mobileState.desktop.start=0;});await page.waitForFunction(()=>document.getElementById('messages').textContent==='');
  await page.evaluate(()=>{mobileState.connected=false;});await page.waitForFunction(()=>document.getElementById('status').textContent==='Reconnecting…');assert.equal(await page.getByRole('textbox').isEnabled(),true);
  console.log('Mobile UI: compact paired screen, ES/EN, QR action, safe text, message identity, picker, keyboard and reconnect state passed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
