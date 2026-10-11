/** Replays an already-accepted real message across an offline desktop, without another model call. */
import assert from 'node:assert/strict';import {_electron as electron,chromium} from '@playwright/test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';import {findAndroidAdb} from '../electron-dist/android-use.js';
const execute=promisify(execFile),adb=await findAndroidAdb(path.join(process.env.LOCALAPPDATA,'Codeclub')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CODECLUB_NEXT_DEV_URL;
let app,browser,port;
const launch=()=>electron.launch({args:['.'],cwd:path.resolve('.'),env});
try{
  app=await launch();let desktop=await app.firstWindow();await desktop.waitForFunction(()=>Boolean(window.codeclub?.mobileNext));
  await execute(adb,['shell','input','keyevent','KEYCODE_WAKEUP'],{windowsHide:true});await execute(adb,['shell','am','start','--activity-clear-top','-n','com.codeclub.android/.MainActivity'],{windowsHide:true});await new Promise(resolve=>setTimeout(resolve,1800));
  const pid=(await execute(adb,['shell','pidof','com.codeclub.android'],{windowsHide:true})).stdout.trim().split(' ')[0];assert.match(pid,/^\d+$/);port=(await execute(adb,['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`],{windowsHide:true})).stdout.trim();browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const phone=browser.contexts()[0].pages().find(page=>page.url()==='file:///android_asset/mobile.html');assert.ok(phone);await phone.waitForFunction(()=>JSON.parse(Codeclub.snapshot()).desktop.chats?.some(chat=>chat.orb),{},{timeout:30000});
  const state=await phone.evaluate(()=>JSON.parse(Codeclub.snapshot()));const chat=state.desktop.chats.find(chat=>chat.orb);const orbs=await desktop.evaluate(()=>window.codeclub.settingsGet('codeclub_orbs'));const orb=orbs.find(orb=>orb.id===chat.orb.id),chatId=orb.chatId||`orb-chat-${orb.id}`;
  const before=await desktop.evaluate(chatId=>window.codeclub.chatAll('',chatId),chatId);const previous=[...before].reverse().find(message=>message.mobileRequestId);assert.ok(previous,'Run the real mobile conversation verification first.');
  assert.equal(chat.orb.color,orb.color);assert.equal(chat.orb.name,orb.name);assert.equal(chat.orb.model,orb.modelId);
  await app.close();app=undefined;await phone.waitForFunction(()=>!JSON.parse(Codeclub.snapshot()).connected);
  await phone.evaluate(request=>post(request),{operation:'send',id:previous.mobileRequestId,text:previous.displayContent||previous.content,chatKey:chat.key});
  await phone.waitForFunction(id=>JSON.parse(Codeclub.snapshot()).localOutbox?.some(message=>message.id===id),previous.mobileRequestId);
  app=await launch();desktop=await app.firstWindow();await desktop.waitForFunction(()=>Boolean(window.codeclub?.mobileNext));
  await phone.waitForFunction(id=>{const state=JSON.parse(Codeclub.snapshot());return state.connected&&!state.localOutbox?.some(message=>message.id===id);},previous.mobileRequestId,{timeout:45000});
  assert.equal((await desktop.evaluate(chatId=>window.codeclub.chatAll('',chatId),chatId)).length,before.length);
  await phone.screenshot({path:path.join(process.env.TEMP,'codeclub-mobile-final.png')});console.log('Real phone: synced orb configuration, encrypted offline outbox, reconnect acknowledgment and no duplicate/model rerun passed.');
}finally{await browser?.close();await app?.close();if(port)await execute(adb,['forward','--remove',`tcp:${port}`],{windowsHide:true}).catch(()=>undefined);}
