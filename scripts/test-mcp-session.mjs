import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createMcpSession } from '../electron-dist/mcp-session.js';

const sessions = [];
const start = source => {
  const child = spawn(process.execPath, ['-e', source], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const session = createMcpSession(child);
  sessions.push(session);
  return session;
};
try {
  const server = start(`
    const {createInterface}=require('node:readline');
    createInterface({input:process.stdin}).on('line',line=>{
      const request=JSON.parse(line);
      if(request.method==='ignore')return;
      if(request.method==='exit'){process.exit(0);return;}
      console.log('non-protocol diagnostic');
      console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,...(request.method==='fail'?{error:{code:-32602,message:'invalid'}}:{result:request.params})}));
    });
  `);
  assert.deepEqual(await Promise.all([server.request('one', { value: 1 }), server.request('two', { value: 2 })]), [{ value: 1 }, { value: 2 }]);
  await assert.rejects(server.request('fail', {}), /invalid/);
  await assert.rejects(server.request('ignore', {}, 20), /timeout/);
  assert.deepEqual(await server.request('after-timeout', { recovered: true }), { recovered: true });
  const blocked = server.request('ignore', {});
  const exited = server.request('exit', {});
  const results = await Promise.allSettled([blocked, exited]);
  assert(results.every(result => result.status === 'rejected'), 'Exit settles all pending requests');
  await assert.rejects(server.request('after-exit', {}));

  const hanging = start('setInterval(()=>{},1000)');
  const pending = hanging.request('ignore', {});
  hanging.close();
  await assert.rejects(pending, /cerrada/);
  await assert.rejects(hanging.request('after-close', {}), /cerrada/);
  hanging.close();

  const closedOutput = start('setInterval(()=>{},1000)');
  const waitingForOutput = closedOutput.request('ignore', {}, 2000);
  closedOutput.child.stdout.destroy();
  await assert.rejects(waitingForOutput, /stdout/);
  closedOutput.close();
  console.log('MCP: concurrent requests, protocol errors, timeouts, recovery, process exit, stdout closure and explicit shutdown passed.');
} finally {
  await Promise.all(sessions.map(async session => {
    const child = session.child;
    const done = child.exitCode === null && child.signalCode === null ? once(child, 'exit') : Promise.resolve();
    session.close();
    await done;
  }));
}
