import { spawn } from 'node:child_process';

/** Run a fixed PowerShell script without interpolating renderer-controlled command text. */
function powershell(script: string, environment: Record<string, string | undefined> = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, ...environment } });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('ORB_ADMIN_DENIED')));
  });
}

/** Check the current process token; group membership alone does not imply elevation. */
export async function isAdministrator() {
  if (process.platform !== 'win32') return false;
  return await powershell("$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)") === 'True';
}

/** Observe only the foreground process name, never window titles, screenshots, or keystrokes. */
export async function foregroundApplication() {
  if (process.platform !== 'win32') return '';
  return powershell(`
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OrbForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId); }'
    $foregroundProcessId = [uint32]0
    [void][OrbForeground]::GetWindowThreadProcessId([OrbForeground]::GetForegroundWindow(), [ref]$foregroundProcessId)
    if ($foregroundProcessId) { (Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue).ProcessName }
  `);
}

/** Windows owns the UAC prompt. Cancellation leaves the current application running. */
export async function launchAdministrator(executable: string, applicationPath: string | undefined, maximumAutonomy: boolean) {
  if (process.platform !== 'win32') throw new Error('ORB_ADMIN_UNAVAILABLE');
  await powershell(`
    $ErrorActionPreference = 'Stop'
    $launchArguments = '--orb-admin-setup --orb-maximum-autonomy=' + $env:CODECLUB_ADMIN_AUTONOMY
    if ($env:CODECLUB_ADMIN_APPLICATION) { $launchArguments = '"' + $env:CODECLUB_ADMIN_APPLICATION + '" ' + $launchArguments }
    Start-Process -FilePath $env:CODECLUB_ADMIN_EXECUTABLE -ArgumentList $launchArguments -Verb RunAs -WindowStyle Hidden
  `, { CODECLUB_ADMIN_EXECUTABLE: executable, CODECLUB_ADMIN_APPLICATION: applicationPath, CODECLUB_ADMIN_AUTONOMY: maximumAutonomy ? '1' : '0' });
}
