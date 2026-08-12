// Runs student code from the code tasks in a timeout-bounded child process.
// MVP sandbox: python3 / node with a 3s kill, 4KB output cap. This is a
// friendly local sandbox for a classroom demo, NOT a security boundary.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TIMEOUT_MS = 3000;
const MAX_OUTPUT = 4096;

const RUNNERS = {
  python: { cmd: "python3", file: "main.py", run: (dir) => `python3 ${join(dir, "main.py")}` },
  javascript: { cmd: "node", file: "main.mjs", run: (dir) => `node ${join(dir, "main.mjs")}` },
};

export function isSupportedLanguage(lang) {
  return lang in RUNNERS;
}

// code: string, language: "python" | "javascript"
// Returns { ok, stdout, stderr, timedOut } — never throws for student code.
export async function runCode(code, language) {
  const runner = RUNNERS[language];
  if (!runner) return { ok: false, error: `Unsupported language: ${language}` };
  if (!code || !String(code).trim()) return { ok: false, error: "No code to run." };

  const dir = join(tmpdir(), `nexus-${randomUUID()}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, runner.file), code, "utf8");

    return await new Promise((resolve) => {
      const child = spawn(runner.run(dir), { shell: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGKILL");
          resolve({ ok: true, stdout, stderr, timedOut: true });
        }
      }, TIMEOUT_MS);

      child.stdout.on("data", (d) => {
        stdout += d;
        if (stdout.length > MAX_OUTPUT) child.kill("SIGKILL");
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, error: `Could not start runner: ${err.message}` });
        }
      });
      child.on("close", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, code, stdout, stderr });
        }
      });
    });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
