// JSON-file store for sessions and submissions. Zero dependencies.
// Evolved from the fite-agent-mvp store.mjs: same single-writer lock and
// atomic-write pattern, but now keyed by anonymous hash instead of tools.
// A session carries ONLY: hash, codename, xp, per-level progress. No real
// identity ever touches this file (double-blind).

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { LEVEL_XP } from "../shared/course-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

let opChain = Promise.resolve();
function withLock(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function readAll(file, fallback) {
  if (!existsSync(file)) return fallback;
  const raw = await readFile(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    // Fail closed: never treat a corrupt file as empty (a write would erase data).
    throw new Error(`${file} is corrupted; refusing to continue: ${err.message}`);
  }
}

async function writeAll(file, value) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

// ---------- Sessions (double-blind: hash + codename only) ----------

export function hashOf(input) {
  return createHash("sha256").update(String(input)).digest("hex").slice(0, 32);
}

export async function getSession(hash) {
  const sessions = await readAll(SESSIONS_FILE, []);
  return sessions.find((s) => s.hash === hash) || null;
}

// Creates a fresh anonymous session. codenameHint lets a returning browser
// re-derive the same identity from its stored codename.
export async function createSession(codenameHint) {
  return withLock(async () => {
    const sessions = await readAll(SESSIONS_FILE, []);
    const codename = codenameHint || randomCodename();
    const hash = hashOf(codename);
    let session = sessions.find((s) => s.hash === hash);
    if (!session) {
      session = {
        hash,
        codename,
        xp: 0,
        levelProgress: {}, // levelId -> { quizCorrect, quizTotal, codeSubmitted, completed }
        createdAt: new Date().toISOString(),
      };
      sessions.push(session);
      await writeAll(SESSIONS_FILE, sessions);
    }
    return session;
  });
}

export async function addXp(hash, amount) {
  return withLock(async () => {
    const sessions = await readAll(SESSIONS_FILE, []);
    const idx = sessions.findIndex((s) => s.hash === hash);
    if (idx === -1) return null;
    sessions[idx].xp += amount;
    sessions[idx].updatedAt = new Date().toISOString();
    await writeAll(SESSIONS_FILE, sessions);
    return sessions[idx];
  });
}

export async function recordQuizResult(hash, levelId, correct, total, hasCode) {
  return withLock(async () => {
    const sessions = await readAll(SESSIONS_FILE, []);
    const idx = sessions.findIndex((s) => s.hash === hash);
    if (idx === -1) return null;
    const p = sessions[idx].levelProgress[levelId] || { quizCorrect: 0, codeSubmitted: false, completed: false };
    p.quizCorrect = Math.max(p.quizCorrect, correct);
    p.quizTotal = total;
    // A level is complete only after its code task too — unless it has none.
    if (p.quizCorrect >= total && !hasCode) p.completed = true;
    sessions[idx].levelProgress[levelId] = p;
    sessions[idx].updatedAt = new Date().toISOString();
    await writeAll(SESSIONS_FILE, sessions);
    return sessions[idx];
  });
}

export async function recordCodeSubmission(hash, levelId, code, stdout, passed) {
  return withLock(async () => {
    const sessions = await readAll(SESSIONS_FILE, []);
    const idx = sessions.findIndex((s) => s.hash === hash);
    if (idx === -1) return null;
    const p = sessions[idx].levelProgress[levelId] || {};
    p.codeSubmitted = true;
    p.lastCode = { code, stdout, passed, at: new Date().toISOString() };
    if (p.quizCorrect >= (p.quizTotal ?? 0)) p.completed = true;
    sessions[idx].levelProgress[levelId] = p;
    sessions[idx].updatedAt = new Date().toISOString();
    await writeAll(SESSIONS_FILE, sessions);
    return sessions[idx];
  });
}

// Teacher settlement export: hash + xp + progress only. Real names live ONLY
// in the teacher's local CSV, joined by scripts/reveal.mjs.
export async function exportSessions() {
  const sessions = await readAll(SESSIONS_FILE, []);
  return sessions.map((s) => ({
    hash: s.hash,
    codename: s.codename,
    xp: s.xp,
    level: Math.floor(s.xp / LEVEL_XP) + 1,
    completedLevels: Object.values(s.levelProgress).filter((p) => p.completed).length,
  }));
}

// ---------- Codename generation (CyberPanda_88 style) ----------

const ADJ = ["Cyber", "Quantum", "Neon", "Turbo", "Lunar", "Solar", "Nova", "Hyper", "Pixel", "Astro"];
const NOUN = ["Panda", "Fox", "Raven", "Tiger", "Wolf", "Falcon", "Otter", "Koala", "Gecko", "Lynx"];

export function randomCodename() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}${n}_${Math.floor(10 + Math.random() * 90)}`;
}

export { randomUUID };
