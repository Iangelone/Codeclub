/** Physical portrait scanner verification; no pairing secrets or camera frames are recorded. */
import assert from 'node:assert/strict';import {chromium} from '@playwright/test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';import {findAndroidAdb} from '../build/electron/android-use.js';
const execute=promisify(execFile),adb=await findAndroidAdb(path.join(process.env.LOCALAPPDATA,'Codeclub'));let browser,port;
try{
  await execute(adb,['shell','am','start','--activity-clear-top','-n','com.codeclub.android/.MainActivity'],{windowsHide:true});await new Promise(resolve=>setTimeout(resolve,1500));
  const pid=(await execute(adb,['shell','pidof','com.codeclub.android'],{windowsHide:true})).stdout.trim().split(' ')[0];assert.match(pid,/^\d+$/);
  port=(await execute(adb,['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`],{windowsHide:true})).stdout.trim();browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=browser.contexts()[0].pages().find(page=>page.url()==='file:///android_asset/mobile.html');assert.ok(page);await page.evaluate(()=>post({action:'scan'}));await new Promise(resolve=>setTimeout(resolve,1200));
  const window=(await execute(adb,['shell','dumpsys','window'],{windowsHide:true})).stdout;assert.match(window,/mCurrentFocus=.*PortraitCaptureActivity/);assert.match(window,/mRotation=ROTATION_0|mRotation=0|rotation=0/);
  await execute(adb,['shell','input','keyevent','KEYCODE_BACK'],{windowsHide:true});console.log('Physical QR scanner: portrait activity/rotation confirmed; returned to the companion.');
}finally{await browser?.close();if(port)await execute(adb,['forward','--remove',`tcp:${port}`],{windowsHide:true}).catch(()=>undefined);}
