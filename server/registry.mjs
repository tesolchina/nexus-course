// Course registry: maps course code -> { title, description, githubUrl }.
// Teacher manages via dashboard. Students load courses by code or GitHub URL.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const REGISTRY_FILE = join(DATA_DIR, "registry.json");
const COURSES_DIR = join(DATA_DIR, "courses");

// Known code -> filename mappings for courses whose disk filename differs from code string.
// e.g. code "ati271b" lives at courses/ati-271b.yaml (hyphenated).
const KNOWN_FILENAMES = {
  ati271b: "ati-271b.yaml",
  genai101: "genai-101.yaml",
  "gcap3226-ati271b": "gcap3226-ati271b.yaml",
};

// ---------- single-writer lock ----------

let opChain = Promise.resolve();
function withLock(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.then(() => {}, () => {});
  return run;
}

async function readAll() {
  if (!existsSync(REGISTRY_FILE)) return makeDefault();
  try {
    const data = JSON.parse(await readFile(REGISTRY_FILE, "utf8"));
    // Migration: backfill fileName for entries that don't have it.
    if (data.courses) {
      for (const [code, entry] of Object.entries(data.courses)) {
        if (!entry.fileName) {
          entry.fileName = KNOWN_FILENAMES[code] || `${code}.yaml`;
        }
      }
    }
    return data;
  } catch {
    return makeDefault();
  }
}

async function writeAll(data) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${REGISTRY_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, REGISTRY_FILE);
}

function makeDefault() {
  return {
    version: 1,
    courses: {
      ati271b: {
        code: "ati271b",
        fileName: "ati-271b.yaml",   // maps to courses/ati-271b.yaml on disk
        title: "ATI & 数据治理 · 271B 巴士案例",
        description: "用 accessinfo.hk 和《公开资料守则》追踪公共数据 — 知情权 × 数据治理",
        githubUrl: "",   // use local courses/ati-271b.yaml (no external repo required)
        levels: 4,
        addedAt: new Date().toISOString(),
      },
      genai101: {
        code: "genai101",
        fileName: "genai-101.yaml",   // maps to courses/genai-101.yaml on disk
        title: "GenAI 101 · 大模型入门",
        description: "Zero to agent with LLMs — watch, practice, build",
        githubUrl: "",
        levels: 3,
        addedAt: new Date().toISOString(),
      },
      "gcap3226-ati271b": {
        code: "gcap3226-ati271b",
        fileName: "gcap3226-ati271b.yaml",
        title: "ATI & 数据治理 · 271B 巴士案例 (GCAP3226)",
        description: "用 accessinfo.hk 和《公开资料守则》追踪公共数据 — 知情权 × 数据治理",
        githubUrl: "",   // local courses/gcap3226-ati271b.yaml (GitHub CDN propagation pending)
        levels: 4,
        addedAt: new Date().toISOString(),
      },
    },
  };
}

// Derive a stable code from a GitHub/Gitee URL (SHA-256 prefix, 12 hex chars).
export function codeFromUrl(url) {
  const u = url.trim().split("?")[0];
  return createHash("sha256").update(u).digest("hex").slice(0, 12);
}

export async function listCourses() {
  const data = await readAll();
  return Object.values(data.courses);
}

export async function getByCode(code) {
  const data = await readAll();
  return data.courses[code] || null;
}

export async function getCourseFile(code) {
  // Determine filename: explicit fileName in registry > known mapping > code.yaml
  const entry = await getByCode(code);
  let fileName = entry?.fileName || KNOWN_FILENAMES[code] || `${code}.yaml`;
  // Check local courses/ dir first (always present in container image).
  const local = join(__dirname, "..", "courses", fileName);
  if (existsSync(local)) return local;
  // Check cached data/courses/ (may persist across deploys).
  const filePath = join(COURSES_DIR, fileName);
  if (existsSync(filePath)) return filePath;
  return null;
}

export async function saveCourseFile(code, raw) {
  if (!existsSync(COURSES_DIR)) await mkdir(COURSES_DIR, { recursive: true });
  const filePath = join(COURSES_DIR, `${code}.yaml`);
  await writeFile(filePath, raw, "utf8");
  return filePath;
}

export async function addOrUpdate(code, meta) {
  return withLock(async () => {
    const data = await readAll();
    data.courses[code] = {
      code,
      title: meta.title || code,
      description: meta.description || "",
      githubUrl: meta.githubUrl || "",
      levels: meta.levels || 0,
      addedAt: new Date().toISOString(),
    };
    await writeAll(data);
    return data.courses[code];
  });
}

export async function remove(code) {
  return withLock(async () => {
    const data = await readAll();
    if (!data.courses[code]) return false;
    delete data.courses[code];
    await writeAll(data);
    // Also remove cached course file
    const filePath = join(COURSES_DIR, `${code}.yaml`);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(filePath, { force: true });
    } catch {}
    return true;
  });
}

export function coursesDir() {
  return COURSES_DIR;
}