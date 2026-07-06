import { spawn } from "node:child_process";
import { stopDevProcesses } from "./stop.mjs";

await stopDevProcesses();

const child = spawn(process.execPath, ["x", "tauri", "dev"], {
  stdio: "inherit",
  shell: false,
});

let closing = false;

async function cleanupAndExit(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await stopDevProcesses();
  process.exit(code);
}

process.on("SIGINT", () => cleanupAndExit(130));
process.on("SIGTERM", () => cleanupAndExit(143));

child.on("exit", (code) => cleanupAndExit(code ?? 0));
