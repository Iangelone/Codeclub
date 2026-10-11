/** Physical companion checks through the real app/preload/TLS/Accessibility path.
 * Uses the user's already-paired development profile. Keep the phone available.
 * ADB is used only to open the APK and resume locally after testing remote pause.
 */
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findAndroidAdb, parseAndroidHierarchy } from '../electron-dist/android-use.js';
const execute = promisify(execFile);
const adb = await findAndroidAdb(path.join(process.env.LOCALAPPDATA || '', 'Codeclub'));
async function resumeLocally(required=false){
  const file='/data/local/tmp/codeclub-companion-test.xml';
  await new Promise(resolve=>setTimeout(resolve,1200));
  try{
    for(let attempt=0;attempt<3;attempt++){
      await execute(adb,['shell','uiautomator','dump',file],{windowsHide:true});
      const xml=(await execute(adb,['shell','cat',file],{windowsHide:true})).stdout;
      const resume=parseAndroidHierarchy(xml).find(element=>/^(Reanudar control|Resume control)$/.test(element.text));
      if(required&&attempt===0)assert.ok(resume);
      if(!resume)return;
      // Keyboard focus avoids manufacturer-specific mismatches between bounds and touch coordinates.
      for(let focusAttempt=0;focusAttempt<10;focusAttempt++){
        await execute(adb,['shell','input','keyevent','KEYCODE_TAB'],{windowsHide:true});
        await execute(adb,['shell','uiautomator','dump',file],{windowsHide:true});
        const focusedXml=(await execute(adb,['shell','cat',file],{windowsHide:true})).stdout;
        const focused=parseAndroidHierarchy(focusedXml).find(element=>element.focused&&/^(Reanudar control|Resume control)$/.test(element.text));
        if(focused){await execute(adb,['shell','input','keyevent','KEYCODE_ENTER'],{windowsHide:true});break;}
      }
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
    throw new Error('Local resume did not update the observed button.');
  }finally{await execute(adb,['shell','rm','-f',file],{windowsHide:true}).catch(()=>undefined);}
}
let instance, deviceId, fixturePort;
const fixtureHtml=await readFile(new URL('./fixtures/android-companion.html',import.meta.url));
const fixture=createServer((_,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixtureHtml);});
const env = { ...process.env, CODECLUB_NEXT_DEV_URL: 'http://127.0.0.1:3000' }; delete env.ELECTRON_RUN_AS_NODE;
try {
  instance = await electron.launch({ args: ['.'], env, cwd: path.resolve('.') });
  const page = await instance.firstWindow(); await page.waitForFunction(() => Boolean(window.codeclub?.invoke));
  const invoke = (operation, request = {}) => page.evaluate(({ operation, request }) => window.codeclub.invoke(`codeclub_android_${operation}`, { request }), { operation, request });
  await execute(adb,['shell','am','start','--activity-clear-top','-n','com.codeclub.android/.MainActivity'],{windowsHide:true});
  await resumeLocally();
  let peers = [];
  for(let attempt=0;attempt<40;attempt++){
    const result=await page.evaluate(()=>window.codeclub.invoke('codeclub_android_pairing_status',{}));peers=result.devices.filter(device=>device.state==='device');
    if(peers.length)break;await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(peers.length,1,'Exactly one paired companion must reconnect to the desktop.');deviceId=peers[0].deviceId;
  assert.ok(deviceId.startsWith('companion:'));assert.equal(peers[0].permissions.accessibility,true);
  await execute(adb,['shell','am','start','--activity-clear-top','-n','com.codeclub.android/.MainActivity'],{windowsHide:true});
  await new Promise(resolve=>setTimeout(resolve,600));
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));fixturePort=fixture.address().port;
  await execute(adb,['reverse',`tcp:${fixturePort}`,`tcp:${fixturePort}`],{windowsHide:true});
  await execute(adb,['shell','am','start','-a','android.intent.action.VIEW','-p','com.android.chrome','-d',`http://127.0.0.1:${fixturePort}`],{windowsHide:true});
  await new Promise(resolve=>setTimeout(resolve,1000));
  let state;
  for(let attempt=0;attempt<12;attempt++){
    state=await invoke('get_state',{deviceId});
    if(state.ok&&state.elements.some(element=>element.text==='Codeclub Android test'))break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(state.ok,true,state.error);
  assert.ok(state.elements.some(element=>element.text==='Codeclub Android test'),'Open the harmless local fixture before running.');
  const captured=await invoke('screenshot',{deviceId});assert.equal(captured.ok,true,captured.error);
  state=captured;
  const png=Buffer.from(captured.data,'base64');assert.equal(png.readUInt32BE(16),captured.width);assert.equal(png.readUInt32BE(20),captured.height);
  const act=async request=>{
    await new Promise(resolve=>setTimeout(resolve,650));
    state=await invoke('get_state',{deviceId});if(!state.ok&&request.action==='key')state=await invoke('screenshot',{deviceId});assert.equal(state.ok,true,state.error);
    const result=await invoke('action',{deviceId,snapshotId:state.snapshotId,...request});assert.equal(result.ok,true,result.error);assert.equal(result.dispatched,true);state=result.state;return result;
  };
  let field;for(let attempt=0;attempt<5;attempt++){field=state.elements.find(element=>element.className.endsWith('EditText')&&!element.password&&(/Codeclub test input/.test(element.text+element.description)||element.resourceId==='message'));if(field)break;await new Promise(resolve=>setTimeout(resolve,250));state=await invoke('get_state',{deviceId});}assert.ok(field,`The test input must be observed (classes=${[...new Set(state.elements.map(e=>e.className))]}).`);
  await act({action:'tap',ref:field.ref});
  const typed='Codeclub Android — á ñ ✓';await act({action:'type',text:typed});
  assert.ok(state.elements.some(element=>element.text===typed),'The actual phone contains the exact Unicode input.');
  await act({action:'key',key:'back'});
  state=await invoke('get_state',{deviceId});const apply=state.elements.find(element=>element.text==='Apply test');assert.ok(apply);
  await act({action:'tap',ref:apply.ref});assert.ok(state.elements.some(element=>element.text===`Applied: ${typed}`),'The local page confirms the real tap.');
  state=await invoke('get_state',{deviceId});const before=JSON.stringify(state.elements.map(element=>[element.text,element.bounds]));
  await act({action:'swipe',x:Math.floor(state.width*.5),y:Math.floor(state.height*.7),endX:Math.floor(state.width*.5),endY:Math.floor(state.height*.3),durationMs:500});
  assert.notEqual(JSON.stringify(state.elements.map(element=>[element.text,element.bounds])),before,'The real page scrolls.');
  await act({action:'key',key:'recents'});await act({action:'key',key:'back'});
  assert.equal((await invoke('unlock',{deviceId,labels:{title:'Unlock Android',hint:'Private PIN',cancel:'Cancel',unlock:'Unlock'}})).alreadyUnlocked,true);
  await execute(adb,['shell','am','start','--activity-clear-top','-n','com.codeclub.android/.MainActivity'],{windowsHide:true});
  await new Promise(resolve=>setTimeout(resolve,600));state=await invoke('get_state',{deviceId});
  const pause=state.elements.find(element=>/^(Pausar control|Pause control)$/.test(element.text));assert.ok(pause);
  const pauseResult=await invoke('action',{deviceId,snapshotId:state.snapshotId,action:'tap',ref:pause.ref});
  assert.equal(pauseResult.dispatched,true);
  if(!pauseResult.ok)assert.match(pauseResult.error,/cancelled after dispatch/i);
  const paused=await invoke('get_state',{deviceId});assert.equal(paused.ok,false);assert.match(paused.error,/paused/i);
  await resumeLocally(true);
  await new Promise(resolve=>setTimeout(resolve,600));const resumed=await invoke('get_state',{deviceId});assert.equal(resumed.ok,true,resumed.error||'Local resume restores control.');
  await invoke('stop');
  console.log(JSON.stringify({physicalCompanion:'passed',desktopRestart:true,pinnedTls:true,accessibility:true,screenshot:true,unicode:true,tap:true,swipe:true,navigation:true,pause:true,resume:true,transport:'Wi-Fi companion; no ADB action transport'}));
}finally{
  await instance?.close();
  if(fixturePort)await execute(adb,['reverse','--remove',`tcp:${fixturePort}`],{windowsHide:true}).catch(()=>undefined);
  fixture.closeAllConnections();if(fixture.listening)await new Promise(resolve=>fixture.close(resolve));
}
