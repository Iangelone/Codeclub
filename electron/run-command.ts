import * as pty from 'node-pty';
import { stripVTControlCharacters } from 'node:util';
import { randomUUID } from 'node:crypto';

/** Finite commands use an isolated PTY; servers belong in persistent terminals. */
export async function runProjectCommand(request: any, cwd: string, active: Set<() => void>, signal?: AbortSignal) {
  let executable = String(request.command);
  let args: string[] = Array.isArray(request.args) ? request.args.map(String) : [];
  const marker = `codeclub-${randomUUID()}-exit:`;
  const frame = new RegExp(`${marker}(-?\\d+)\\r?\\n`);
  if (process.platform === 'win32') {
    const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
    // Keep the console owner alive until cleanup, including background descendants.
    const quote = (value: string) => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
    const command = /\.(cmd|bat)$/i.test(executable)
      ? `& ${literal(executable)} @(${args.map(literal).join(',')}); $code=$LASTEXITCODE`
      : `$info=New-Object System.Diagnostics.ProcessStartInfo; $info.FileName=${literal(executable)}; $info.Arguments=${literal(args.map(quote).join(' '))}; $info.UseShellExecute=$false; $child=[System.Diagnostics.Process]::Start($info); $child.WaitForExit(); $code=$child.ExitCode`;
    const script = `$ErrorActionPreference='Stop'; $code=1; try { ${command} } catch { [Console]::Error.WriteLine($_.Exception.Message) }; [Console]::WriteLine(); [Console]::WriteLine(${literal(marker)}+$code); while($true) { Start-Sleep -Seconds 60 }`;
    executable = 'powershell.exe';
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  }
  try {
    const terminal = pty.spawn(executable, args, { cwd, env: process.env as Record<string, string>, cols: 160, rows: 30 });
    return await new Promise<any>((resolve) => {
      let output = '', reason = '', finished = false, stopping = false, commandCode: number | undefined;
      const stop = () => { if (stopping) return; stopping = true; try { terminal.kill(); } catch { finish(1); } };
      const finish = (exitCode: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        active.delete(stop);
        data.dispose(); exit.dispose();
        if (!stopping) stop();
        const text = stripVTControlCharacters(output.replace(frame, '').replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')).replace(/\r\n/g, '\n');
        const code = commandCode ?? exitCode;
        resolve({ ok: !reason && !signal?.aborted && code === 0, stdout: text, stderr: '', code: reason || signal?.aborted ? 1 : code, ...(reason ? { error: reason, guidance: 'Use terminal for servers or other persistent processes.' } : {}) });
      };
      const data = terminal.onData(chunk => {
        output += chunk;
        const match = output.match(frame);
        if (match && commandCode === undefined) { commandCode = Number(match[1]); stop(); }
        if (output.length > 8 * 1024 * 1024) { output = output.slice(0, 8 * 1024 * 1024); reason = 'COMMAND_OUTPUT_LIMIT'; stop(); }
      });
      const exit = terminal.onExit(({ exitCode }) => finish(exitCode));
      const duration = Math.max(1000, Math.min(Number(request.timeoutMs) || 120000, 60 * 60 * 1000));
      const timer = setTimeout(() => { reason = 'COMMAND_TIMEOUT'; stop(); }, duration);
      active.add(stop);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
    });
  } catch (error: any) {
    return { ok: false, stdout: '', stderr: String(error.message || error), code: 1 };
  }
}
