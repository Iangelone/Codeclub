import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const listeners = {};
const sockets = [];
const timers = [];
const timerDelays = [];
const event = name => ({addListener(fn) {listeners[name] = fn;}});
class Socket {
  static OPEN = 1; static CONNECTING = 0;
  constructor(url) { this.url=url;this.readyState=0;this.listeners={};sockets.push(this); }
  addEventListener(name,fn) {this.listeners[name]=fn;}
}
const alarms = [];
const context = {WebSocket:Socket,navigator:{userAgent:'Edg/123'},chrome:{alarms:{onAlarm:event('alarm'),create:(...args)=>alarms.push(args)},runtime:{onStartup:event('startup'),onInstalled:event('installed')},action:{onClicked:event('click')},debugger:{onDetach:event('detach')}},setTimeout:(fn,ms)=>{timers.push(fn);timerDelays.push(ms);return timers.length;},clearTimeout(){},setInterval(){},clearInterval(){}};
vm.runInNewContext(readFileSync('browser-extension/service-worker.js','utf8'),context);
assert.equal(sockets.length,1);
listeners.startup(); listeners.installed(); listeners.click();
assert.equal(sockets.length,1,'Wake events must not duplicate an active connection');
sockets[0].readyState=3;sockets[0].listeners.close();
assert.equal(timers.length,1);
// Model a suspended worker: the short retry timer never executes.
listeners.alarm({name:'unrelated'});assert.equal(sockets.length,1);
listeners.alarm({name:'codeclub-browser-reconnect'});assert.equal(sockets.length,2,'Alarm reconnects after suspended timers');
assert.match(sockets[1].url,/:47833/);
assert.equal(alarms[0][1].periodInMinutes,1);
sockets[1].readyState=3;listeners.click();assert.equal(sockets.length,3,'Toolbar click reconnects');
const manifest=JSON.parse(readFileSync('browser-extension/manifest.json','utf8'));
assert.ok(manifest.permissions.includes('alarms'));
for (let attempt = 0; attempt < 66; attempt++) {
  const current = sockets.at(-1);
  current.readyState = 3;
  current.listeners.close();
  timers.at(-1)();
}
assert.deepEqual(timerDelays.filter(ms => ms > 250), [1000, 2000, 4000, 8000, 15000, 15000],
  'Backoff must grow across scans instead of resetting at each port');
console.log('Companion wake-up alarms, startup, installation, toolbar reconnect and duplicate protection passed.');
