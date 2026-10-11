/** Real paired Android WebView -> TLS -> desktop renderer -> configured free model. */
import assert from 'node:assert/strict';
import {_electron as electron,chromium} from '@playwright/test';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';
import {findAndroidAdb} from '../electron-dist/android-use.js';
const execute=promisify(execFile),adb=await findAndroidAdb(path.join(process.env.LOCALAPPDATA,'Codeclub'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CODECLUB_NEXT_DEV_URL;
let app,browser,forwardPort;
try{
  app=await electron.launch({args:['.'],cwd:path.resolve('.'),env});const desktop=await app.firstWindow();await desktop.waitForFunction(()=>Boolean(window.codeclub?.mobileNext));
  await execute(adb,['shell','input','keyevent','KEYCODE_WAKEUP'],{windowsHide:true});await execute(adb,['shell','am','start','--activity-clear-top','-n','com.codeclub.android/.MainActivity'],{windowsHide:true});
  await new Promise(resolve=>setTimeout(resolve,2000));const pid=(await execute(adb,['shell','pidof','com.codeclub.android'],{windowsHide:true})).stdout.trim().split(' ')[0];assert.match(pid,/^\d+$/);
  const sockets=(await execute(adb,['shell','cat','/proc/net/unix'],{windowsHide:true})).stdout;assert.ok(sockets.includes(`webview_devtools_remote_${pid}`));
  forwardPort=(await execute(adb,['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`],{windowsHide:true})).stdout.trim();
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`);const phone=browser.contexts()[0].pages().find(page=>page.url()==='file:///android_asset/mobile.html');assert.ok(phone);
  await phone.waitForFunction(()=>JSON.parse(Codeclub.snapshot()).desktop.chats?.length>0,{},{timeout:30000});
  const state=await phone.evaluate(()=>JSON.parse(Codeclub.snapshot()));assert.equal(state.connected,true);
  const free=state.desktop.chats.find(chat=>chat.orb?.model.endsWith(':free'));assert.ok(free,'Use an already-configured free orb; never alter credentials/model configuration.');
  const models=await (await fetch('https://openrouter.ai/api/v1/models')).json();const pricing=models.data.find(model=>model.id===free.orb.model)?.pricing;assert.ok(pricing&&Number(pricing.prompt)===0&&Number(pricing.completion)===0,'Verify the configured model is free before sending.');
  await phone.evaluate(key=>pick(key),free.key);await phone.waitForFunction(key=>JSON.parse(Codeclub.snapshot()).desktop.selectedKey===key,free.key);
  const marker=`Mobile sync verification ${Date.now()}`;const prompt=`${marker}. Respondé solamente "Sincronización confirmada". No uses herramientas ni realices acciones.`;
  await phone.locator('#input').fill(prompt);await phone.locator('#send').click();
  await desktop.waitForFunction(async()=>{const api=window.codeclub;const next=await api.mobileNext();return !next;},{},{timeout:30000});
  const orbs=await desktop.evaluate(()=>window.codeclub.settingsGet('codeclub_orbs'));const orb=orbs.find(item=>item.id===free.orb.id);assert.ok(orb);const chatId=orb.chatId||`orb-chat-${orb.id}`;
  await desktop.waitForFunction(async({chatId,marker})=>(await window.codeclub.chatAll('',chatId)).some(message=>message.role==='user'&&String(message.content).includes(marker)),{chatId,marker},{timeout:45000});
  await phone.waitForFunction(marker=>{const desktop=JSON.parse(Codeclub.snapshot()).desktop;return desktop.messages?.some(message=>message.role==='user'&&message.text.includes(marker))&&!desktop.busy&&desktop.messages?.some(message=>message.role==='assistant'&&message.text.includes('Sincronización confirmada'));},marker,{timeout:150000});
  const history=await desktop.evaluate(chatId=>window.codeclub.chatAll('',chatId),chatId);assert.equal(history.filter(message=>message.role==='user'&&String(message.content).includes(marker)).length,1);
  const before=history.length;const request=history.find(message=>message.mobileRequestId&&String(message.content).includes(marker));assert.ok(request);
  await phone.evaluate(({id,text,chatKey})=>post({operation:'send',id,text,chatKey}),{id:request.mobileRequestId,text:prompt,chatKey:free.key});await new Promise(resolve=>setTimeout(resolve,3000));
  assert.equal((await desktop.evaluate(chatId=>window.codeclub.chatAll('',chatId),chatId)).length,before,'A retry cannot create another user turn.');
  await phone.screenshot({path:path.join(process.env.TEMP,'codeclub-mobile-synced.png')});
  console.log(JSON.stringify({pairedPhone:true,phoneToDesktop:true,realFreeModel:free.orb.model,desktopToPhone:true,retryDeduplication:true,screenshot:path.join(process.env.TEMP,'codeclub-mobile-synced.png')}));
}finally{await browser?.close();await app?.close();if(forwardPort)await execute(adb,['forward','--remove',`tcp:${forwardPort}`],{windowsHide:true}).catch(()=>undefined);}
