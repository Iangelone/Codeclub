import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { BrowserExtensionBridge } from '../electron-dist/browser-extension-bridge.js';
import { COMPANION_EXTENSION_IDS, EDGE_EXTENSION_URL, edgeExtensionPage, companionOriginAllowed } from '../electron-dist/browser-extension-config.js';
assert.equal(edgeExtensionPage('install'), EDGE_EXTENSION_URL);
assert.equal(edgeExtensionPage('uninstall'), 'edge://extensions/?id=bomojefgeconjddklieajpeimnjkkbbb');
for (const origin of ['https://example.com', 'null', '', 'chrome-extension://untrusted', `chrome-extension://${COMPANION_EXTENSION_IDS[1]}.evil`]) assert.equal(companionOriginAllowed(origin), false);
const bridge = new BrowserExtensionBridge();
try {
  assert.equal(await bridge.start(), true);
  const url = `ws://127.0.0.1:${bridge.server.address().port}/codeclub-browser`;
  for (const id of COMPANION_EXTENSION_IDS) {
    const socket = new WebSocket(url, { origin: `chrome-extension://${id}` });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({type:'hello',browser:'Origin test fixture'}));
    socket.on('message', data => { const request = JSON.parse(data); if(request.method === 'listTabs') socket.send(JSON.stringify({id:request.id,result:{ok:true,tabs:[]}})); });
    await new Promise(resolve=>setTimeout(resolve,30));
    const client = bridge.list().find(item => item.name === 'Origin test fixture');
    assert.ok(client);
    assert.equal(client.extensionId, id);
    assert.deepEqual(await bridge.tabs(client.browserId), []);
    await new Promise(resolve=>{socket.once('close',resolve);socket.close();});
  }
  const rejected = new WebSocket(url, { origin:'https://example.com' });
  await new Promise((resolve,reject)=>{rejected.once('open',()=>reject(Error('Unexpected accepted origin')));rejected.once('error',resolve);});
  console.log('Published Edge and unpacked origins connect and respond; foreign origins rejected; install/removal routes passed.');
} finally { bridge.stop(); }
