// Teacher auth + remote course.yaml fetch (GitHub/Gitee URL → course-as-code Git-sync).
// Teacher login is a shared secret (TEACHER_PASSWORD env, default "demo1234").
// Tokens expire after 24h; stored in data/teacher.json (single-writer lock).

import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseYaml } from "./yaml.mjs";
import { validateCourse } from "../shared/course-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const TEACHER_FILE = join(DATA_DIR, "teacher.json");
const REMOTE_COURSE_FILE = join(DATA_DIR, "remote-course.yaml");
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// ---------- single-writer lock (same pattern as store.mjs) ----------

let opChain = Promise.resolve();
function withLock(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function readAll() {
  if (!existsSync(TEACHER_FILE)) return { tokens: [] };
  const raw = await readFile(TEACHER_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return { tokens: [] };
  }
}

async function writeAll(data) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${TEACHER_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, TEACHER_FILE);
}

// ---------- Auth ----------

export function teacherPassword() {
  return process.env.TEACHER_PASSWORD || "demo1234";
}

// Login: verify password, issue token. Returns token string or null.
export async function login(password) {
  if (password !== teacherPassword()) return null;
  const token = `t_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const entry = { token, createdAt: new Date().toISOString() };
  await withLock(async () => {
    const data = await readAll();
    // Prune expired tokens.
    const now = Date.now();
    data.tokens = data.tokens.filter((t) => now - new Date(t.createdAt).getTime() < TOKEN_TTL_MS);
    data.tokens.push(entry);
    await writeAll(data);
  });
  return token;
}

export async function verifyToken(token) {
  const data = await readAll();
  const now = Date.now();
  return data.tokens.some((t) => t.token === token && now - new Date(t.createdAt).getTime() < TOKEN_TTL_MS);
}

// ---------- Remote course (Git-sync-lite) ----------

// Normalises a GitHub/Gitee blob URL to its raw equivalent.
function toRawUrl(url) {
  let u = url.trim();
  // GitHub: https://github.com/user/repo/blob/branch/path → https://raw.githubusercontent.com/user/repo/branch/path
  u = u.replace(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/,
    "https://raw.githubusercontent.com/$1/$2",
  );
  // Gitee: https://gitee.com/user/repo/blob/branch/path → https://gitee.com/user/repo/raw/branch/path
  u = u.replace(
    /^https?:\/\/gitee\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/,
    "https://gitee.com/$1/raw/$2",
  );
  return u;
}

// Fetches a course.yaml from a remote URL, validates it, writes to remote-course.yaml.
// Returns { ok: true, meta } or { ok: false, error }.
export async function fetchRemoteCourse(url) {
  const rawUrl = toRawUrl(url);
  let res;
  try {
    res = await fetch(rawUrl, {
      headers: {
        "User-Agent": "nexus-course/1.0 (Course-as-Code fetcher)",
        Accept: "text/plain, */*",
      },
    });
  } catch (err) {
    return { ok: false, error: `Network error fetching course: ${err.message}` };
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    return { ok: false, error: `Server ${res.status} at ${rawUrl}: ${text}` };
  }
  const raw = await res.text();
  let parsed;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    return { ok: false, error: `YAML parse error: ${err.message}` };
  }
  const result = validateCourse(parsed);
  if (!result.ok) return { ok: false, error: `Course invalid: ${result.errors.join("; ")}` };

  // Write to disk for archival record.
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(REMOTE_COURSE_FILE, raw, "utf8");
  return {
    ok: true,
    meta: {
      id: result.value.meta.id,
      title: result.value.meta.title,
      levels: result.value.levels.length,
      source: rawUrl,
    },
  };
}

export function remoteCourseFile() {
  return existsSync(REMOTE_COURSE_FILE) ? REMOTE_COURSE_FILE : null;
}

export async function clearRemoteCourse() {
  try {
    await rm(REMOTE_COURSE_FILE, { force: true });
  } catch {}
}