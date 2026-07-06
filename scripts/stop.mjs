import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";

async function run(command, args) {
  try {
    await execFileAsync(command, args, { windowsHide: true });
  } catch {
    // Best-effort cleanup: missing processes are fine.
  }
}

export async function stopDevProcesses() {
  await run(process.execPath, ["x", "astro", "dev", "stop"]);

  if (isWindows) {
    await run("taskkill", ["/F", "/IM", "codeclub-desktop.exe"]);
  }
}

if (import.meta.main) {
  await stopDevProcesses();
}
