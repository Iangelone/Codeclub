import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';

/** Own pending requests and settle them on every transport shutdown path. */
export function createMcpSession(child: ChildProcessByStdio<Writable, Readable, null>) {
  let nextId = 1;
  let closed: Error | undefined;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const lines = createInterface({ input: child.stdout });
  const fail = (error: Error) => {
    closed ??= error;
    for (const request of pending.values()) request.reject(closed);
    pending.clear();
  };
  lines.on('line', line => {
    let value: any;
    try { value = JSON.parse(line); } catch { return; }
    if (typeof value?.id !== 'number') return;
    const request = pending.get(value.id);
    if (!request) return;
    if (value.error) request.reject(new Error(JSON.stringify(value.error)));
    else if ('result' in value) request.resolve(value.result);
  });
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.stdout.on('close', () => fail(new Error('MCP cerró stdout.')));
  lines.on('close', () => fail(new Error('MCP cerró stdout.')));
  child.on('exit', () => fail(new Error('El proceso MCP terminó.')));
  return {
    child,
    request(method: string, params: Record<string, unknown>, timeoutMs = 120000) {
      if (closed || child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed || !child.stdin.writable) {
        return Promise.reject(closed || new Error('MCP no tiene stdin disponible.'));
      }
      const id = nextId++;
      return new Promise<any>((resolve, reject) => {
        const settle = (error?: Error, value?: any) => {
          clearTimeout(timer);
          pending.delete(id);
          if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => settle(new Error(`MCP timeout: ${method}`)), timeoutMs);
        pending.set(id, { resolve: value => settle(undefined, value), reject: error => settle(error) });
        try {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, error => {
            if (error) pending.get(id)?.reject(error);
          });
        } catch (error) { settle(error instanceof Error ? error : new Error(String(error))); }
      });
    },
    close() {
      fail(new Error('Sesión MCP cerrada.'));
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}
