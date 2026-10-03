import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { providers, models } from '../src/lib/ai-catalog.ts';
import { credentialKeyFor, modelIdFor } from '../src/lib/ai-routing.ts';

// Supply the Gateway credential through stdin only. No credentials in arguments,
// fixtures, settings, snapshots, error dumps or reports.
const useSaved=process.env.CODECLUB_QA_USE_SAVED==='1';
const repairProfile=process.env.CODECLUB_QA_REPAIR_PROFILE==='1';
let gatewayKey;
if(!useSaved){const input=createInterface({input:process.stdin,terminal:false});gatewayKey=await new Promise(resolve=>{input.once('line',resolve);input.once('close',()=>resolve(''));});input.close();assert.ok(gatewayKey,'Supply a credential on stdin or enable the saved encrypted credential');}
const repo=process.cwd();
const packageInfo=JSON.parse(await readFile(path.join(repo,'package.json'),'utf8'));
const configDirectory=path.join(process.env.APPDATA,packageInfo.name);
let encryptedCredentials='{}';
try{encryptedCredentials=await readFile(path.join(configDirectory,'credentials.encrypted.json'),'utf8');}catch{}
const encryptedKeys=new Set(Object.keys(JSON.parse(encryptedCredentials)));
const legacyCredentials=new Map();
for(const entry of await readdir(process.env.APPDATA,{withFileTypes:true})) {
  if(!entry.isDirectory()||!entry.name.toLowerCase().includes('codeclub'))continue;
  try {
    const settings=JSON.parse(await readFile(path.join(process.env.APPDATA,entry.name,'settings.json'),'utf8'));
    for(const provider of providers) {const key=credentialKeyFor(provider);if(typeof settings[key]==='string'&&settings[key])legacyCredentials.set(key,settings[key]);}
  } catch { /* No legacy settings in this directory. */ }
}
const gatewayProvider=providers.find(provider=>provider.gateway);
const freeGateway=models.filter(model=>model.gatewayAvailable&&model.gatewayCost?.input===0&&model.gatewayCost?.output===0&&model.toolCall)
  .sort((a,b)=>Number(/free/i.test(b.label))-Number(/free/i.test(a.label))||(b.contextWindow||0)-(a.contextWindow||0));
const freeDirect=models.filter(model=>!model.gatewayOnly&&model.cost?.input===0&&model.cost?.output===0&&model.toolCall)
  .map(model=>({model,provider:providers.find(provider=>provider.id===model.providerId)}))
  .filter(({provider})=>provider?.api&&(provider.requiresApiKey===false||legacyCredentials.has(credentialKeyFor(provider))||encryptedKeys.has(credentialKeyFor(provider))))
  .sort((a,b)=>Number(a.model.reasoning)-Number(b.model.reasoning)||(b.model.contextWindow||0)-(a.model.contextWindow||0));
const availableDirect=new Map();
const configuredProviderHeaders=new Map();
for(const provider of new Map(freeDirect.map(item=>[item.provider.id,item.provider])).values()) {
  try {
    const key=legacyCredentials.get(credentialKeyFor(provider));
    const response=await fetch(provider.api.replace(/\/$/,'')+'/models',{headers:key?{authorization:`Bearer ${key}`}:{},signal:AbortSignal.timeout(10000)});
    if(response.ok){const data=await response.json();if(Array.isArray(data.data))availableDirect.set(provider.id,new Set(data.data.map(model=>model.id)));}
    if(provider.doc) {
      const documentation=await fetch(provider.doc,{signal:AbortSignal.timeout(10000)}).then(response=>response.text());
      const sessionHeaders=[...new Set(documentation.match(/\bx-[a-z0-9-]+-session\b/gi)||[])];
      if(sessionHeaders.length)configuredProviderHeaders.set(provider.id,Object.fromEntries(sessionHeaders.map(name=>[name,'${chatId}'])));
    }
  } catch { /* Providers without discovery still use the public catalog. */ }
}
const directCandidates=freeDirect.filter(({provider,model})=>!availableDirect.has(provider.id)||availableDirect.get(provider.id).has(model.id))
  .sort((a,b)=>Number(configuredProviderHeaders.has(b.provider.id))-Number(configuredProviderHeaders.has(a.provider.id)));
assert.ok(freeGateway.length,'No free tool-capable Gateway model in the live catalog');
assert.ok(freeDirect.length,'No free direct model with an available credential');
const directory=await mkdtemp(path.join(tmpdir(),'codeclub-ai-live-'));
let desktop;
const passed=[];
try {
  const launcher=path.join(directory,'launcher.mjs');
  await writeFile(launcher,`import {app} from 'electron';app.setPath('userData',${JSON.stringify(directory)});app.setPath('sessionData',${JSON.stringify(directory)});await import(${JSON.stringify(pathToFileURL(path.join(repo,'electron-dist/main.js')).href)});`);
  // Chromium safeStorage ciphertext uses the profile's encrypted OS key.
  // An isolated profile must share that encrypted key to read copied ciphertext.
  const localState=JSON.parse(await readFile(path.join(configDirectory,'Local State'),'utf8'));
  assert.ok(localState.os_crypt?.encrypted_key,'Original profile encryption key missing');
  await writeFile(path.join(directory,'Local State'),JSON.stringify({os_crypt:localState.os_crypt}));
  if(useSaved)await writeFile(path.join(directory,'credentials.encrypted.json'),encryptedCredentials);
  desktop=await _electron.launch({args:[launcher],cwd:repo,env:{...process.env,CODECLUB_NEXT_DEV_URL:''},timeout:30000});
  const main=await desktop.firstWindow();
  // Avoid dumping SDK errors: they can contain request bodies and headers.
  await main.getByRole('button',{name:'Actividad',exact:true}).waitFor({timeout:30000});
  if(gatewayKey)await main.evaluate(({key,value,origin})=>window.codeclub.credentialSet(key,value,origin),{key:credentialKeyFor(gatewayProvider),value:gatewayKey,origin:'https://ai-gateway.vercel.sh'});
  if(gatewayKey && (repairProfile||process.env.CODECLUB_QA_SAVE_GATEWAY==='1')){
    const original=JSON.parse(encryptedCredentials),updated=JSON.parse(await readFile(path.join(directory,'credentials.encrypted.json'),'utf8'));
    original[credentialKeyFor(gatewayProvider)]=updated[credentialKeyFor(gatewayProvider)];
    const vaultPath=path.join(configDirectory,'credentials.encrypted.json');
    await writeFile(vaultPath+'.tmp',JSON.stringify(original));
    await rename(vaultPath+'.tmp',vaultPath);
  }
  assert.equal(await main.evaluate(key=>window.codeclub.credentialPresent(key),credentialKeyFor(gatewayProvider)),true,'The actual saved Gateway credential is present');
  const rest=await main.evaluate(async ({model,key})=>{
    const result=await window.codeclub.invoke('codeclub_http_fetch',{request:{url:'https://ai-gateway.vercel.sh/v1/chat/completions',method:'POST',headers:[{name:'content-type',value:'application/json'}],body:JSON.stringify({model,messages:[{role:'user',content:'Respond only VALIDACION_OK'}],max_tokens:64}),credentialKey:key}});
    const body=JSON.parse(result.body);return {status:result.status,response:body.choices?.[0]?.message?.content,error:body.error?.message||body.error?.type};
  },{model:modelIdFor(gatewayProvider,freeGateway[0]),key:credentialKeyFor(gatewayProvider)});
  console.log(JSON.stringify({gatewayREST:rest}));
  const seededKeys=new Set();
  for(const {provider} of freeDirect) {
    const key=credentialKeyFor(provider);if((useSaved&&!repairProfile)||!legacyCredentials.has(key)||seededKeys.has(key))continue;
    await main.evaluate(({key,value,origin})=>window.codeclub.credentialSet(key,value,origin),{key,value:legacyCredentials.get(key),origin:provider.api});
    seededKeys.add(key);
  }
  if(repairProfile&&seededKeys.size){
    const vaultPath=path.join(configDirectory,'credentials.encrypted.json');
    const original=JSON.parse(await readFile(vaultPath,'utf8'));
    const updated=JSON.parse(await readFile(path.join(directory,'credentials.encrypted.json'),'utf8'));
    for(const key of seededKeys)original[key]=updated[key];
    await writeFile(vaultPath+'.tmp',JSON.stringify(original));
    await rename(vaultPath+'.tmp',vaultPath);
  }
  for(const provider of new Map(freeDirect.map(item=>[item.provider.id,item.provider])).values()){
    const probe=await main.evaluate(async ({origin,key})=>{
      try{const result=await window.codeclub.invoke('codeclub_http_fetch',{request:{url:origin.replace(/\/$/,'')+'/models',method:'GET',headers:[],credentialKey:key}});return {status:result.status,decrypted:true};}
      catch{return {decrypted:false};}
    },{origin:provider.api,key:credentialKeyFor(provider)});
    console.log(JSON.stringify({credentialProbe:provider.id,...probe}));
    assert.equal(probe.decrypted,true,'Saved provider credential must decrypt in the original profile');
  }
  if(process.env.CODECLUB_QA_CREDENTIALS_ONLY==='1'){
    console.log(JSON.stringify({savedCredentialTransportVerified:true}));
  }else{
  const routes=[['vercel-gateway',freeGateway.map(model=>({model,provider:gatewayProvider}))],['models.dev',directCandidates]].filter(([route])=>!process.env.CODECLUB_QA_ROUTE||route===process.env.CODECLUB_QA_ROUTE);
  for(const [route,candidates] of routes) {
    let success=false;
    for(const {provider,model} of candidates.slice(0,3)) {
      await main.evaluate(async selection=>{
        const config=await window.codeclub.appConfigDir();
        await window.codeclub.writeTextFile(await window.codeclub.joinPath(config,'settings.json'),JSON.stringify(selection));
      },{codeclub_last_provider_id:provider.id,codeclub_last_model_id:model.gatewayId||model.id,[`codeclub_provider_headers_${provider.id}`]:configuredProviderHeaders.get(provider.id)||{}});
      await main.reload();await main.locator('textarea').first().waitFor();
      await main.waitForTimeout(500);
      await main.evaluate(()=>window.dispatchEvent(new CustomEvent('codeclub:open-empty-chat')));
      await main.locator('.messages-area[data-chat-transition="idle"]').waitFor();
      await main.locator('textarea').first().fill('Respondé solamente VALIDACION_OK, sin herramientas.');
      const sentAt=Date.now();
      await main.locator('textarea').first().press('Enter');
      try {
        await main.waitForFunction(since=>window.codeclub.sessionList().then(items=>items.some(item=>item.startedAt>=since&&!item.busy)),sentAt,{timeout:90000});
        await expect(main.locator('.chat-assistant-message').last()).toContainText('VALIDACION_OK',{timeout:10000});
        if(process.env.CODECLUB_QA_WIDGET==='1'){
          const existingFloating=desktop.windows().find(page=>page.url().includes('floating=1'));
          const floatingPromise=existingFloating?Promise.resolve(existingFloating):desktop.waitForEvent('window');
          await main.evaluate(()=>window.codeclub.windowClose());
          const floating=await floatingPromise;
          await floating.locator('.floating-shell').waitFor();
          await floating.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.floating-shell')).opacity)===1);
          await floating.locator('textarea').click();
          await floating.locator('.floating-shell.is-expanded').waitFor();
          await floating.locator('.messages-area[data-chat-transition="idle"]').waitFor();
          await expect(floating.locator('.chat-assistant-message').last()).toContainText('VALIDACION_OK',{timeout:10000});
          await floating.locator('textarea').fill('Respondé solamente WIDGET_OK, sin herramientas.');
          const widgetSentAt=Date.now();
          await floating.locator('textarea').press('Enter');
          await floating.waitForFunction(since=>window.codeclub.sessionList().then(items=>items.some(item=>item.startedAt>=since&&!item.busy)),widgetSentAt,{timeout:90000});
          await expect(floating.locator('.chat-assistant-message').last()).toContainText('WIDGET_OK',{timeout:10000});
          assert.equal(await floating.locator('.chat-user-message').count(),0);
          assert.equal(await floating.locator('.chat-assistant-message').count(),1);
          await floating.evaluate(()=>window.codeclub.floatingOpenMain());
          console.log(JSON.stringify({widgetRealResponse:true,agentOnly:true,latestOnly:true}));
        }
        if(process.env.CODECLUB_QA_SAVE_SELECTION==='1'){
          const settingsPath=path.join(configDirectory,'settings.json');
          const settings=JSON.parse(await readFile(settingsPath,'utf8'));
          settings.codeclub_last_provider_id=provider.id;
          settings.codeclub_last_model_id=model.gatewayId||model.id;
          await writeFile(settingsPath+'.tmp',JSON.stringify(settings));
          await rename(settingsPath+'.tmp',settingsPath);
        }
        passed.push({route,provider:provider.id,model:modelIdFor(provider,model),response:'VALIDACION_OK'});success=true;break;
      } catch(error) {
        let diagnostic=String(error?.message||error);
        for(const secret of [gatewayKey,...legacyCredentials.values()])if(secret)diagnostic=diagnostic.split(secret).join('[redacted]');
        console.log(JSON.stringify({route,provider:provider.id,model:modelIdFor(provider,model),response:false,message:(await main.locator('.chat-assistant-message').last().innerText().catch(()=>'' )).slice(0,300),diagnostic:diagnostic.slice(0,600)}));
        const sessions=await main.evaluate(()=>window.codeclub.sessionList());
        console.log(JSON.stringify({sessionResults:sessions.slice(0,2).map(item=>({state:item.state,busy:item.busy,messages:item.messages.slice(-2).map(message=>({role:message.role,content:String(message.content).slice(0,150)}))}))}));
        for(const session of sessions.filter(item=>item.busy))await main.evaluate(chat=>window.codeclub.sessionCommand(chat,'cancel'),session);
        await main.waitForTimeout(500);
      }
    }
    if(!success)console.log(JSON.stringify({route,passed:false}));
  }
  console.log(JSON.stringify({passed,credentialEncrypted:true,realSettingsPreserved:process.env.CODECLUB_QA_SAVE_SELECTION!=='1'}));
  assert.equal(passed.length,routes.length,'Every requested route must produce a real response');
  }
} finally {
  await desktop?.close();
  if(path.dirname(directory)!==path.resolve(tmpdir())||!path.basename(directory).startsWith('codeclub-ai-live-'))throw new Error('Unexpected test directory');
  await rm(directory,{recursive:true,force:true});
}
