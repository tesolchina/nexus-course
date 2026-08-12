// Semantic cache (cost control): when a student hits the same error or asks
// the same question as a classmate, we serve the stored AI answer instead of
// spending another LLM call. The most-cached entries are exposed as community
// guides ("同伴攻略") through GET /api/guides.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const CACHE_FILE = join(DATA_DIR, "cache.json");
const MAX_ENTRIES = 200;

// Normalizes a student message so near-identical questions share one key:
// lowercased, whitespace collapsed, trailing punctuation dropped.
export function normalizeQuestion(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.?!,;:]+$/g, "")
    .trim();
}

export function cacheKey(question) {
  return createHash("sha256").update(normalizeQuestion(question)).digest("hex").slice(0, 24);
}

async function readCache() {
  if (!existsSync(CACHE_FILE)) return [];
  const raw = await readFile(CACHE_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // a broken cache must never block learning; it just re-populates
  }
}

async function writeCache(entries) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await rename(tmp, CACHE_FILE);
}

// Looks up a cached answer. Exact key first, then a normalized-prefix match
// (first 20 chars) as a cheap "semantic" approximation for near-duplicates.
// Returns { hit, answer, hits } or { hit: false }.
export async function lookup(question) {
  const key = cacheKey(question);
  const entries = await readCache();
  const found = entries.find((e) => e.key === key);
  if (found) return { hit: true, answer: found.answer, hits: found.hits };
  const prefix = normalizeQuestion(question).slice(0, 20);
  if (prefix.length >= 12) {
    const near = entries.find((e) => e.question.startsWith(prefix));
    if (near) return { hit: true, answer: near.answer, hits: near.hits, near: true };
  }
  return { hit: false };
}

// Stores (or bumps) an answer in the cache. Returns the new hit count.
export async function remember(question, answer) {
  const key = cacheKey(question);
  const entries = await readCache();
  const found = entries.find((e) => e.key === key);
  if (found) {
    found.hits += 1;
    found.answer = answer; // last-write-wins keeps the freshest advice
    found.updatedAt = new Date().toISOString();
  } else {
    entries.push({
      key,
      question: normalizeQuestion(question),
      answer,
      hits: 1,
      createdAt: new Date().toISOString(),
    });
  }
  const trimmed = entries.sort((a, b) => b.hits - a.hits).slice(0, MAX_ENTRIES);
  await writeCache(trimmed);
  return found ? found.hits : 1;
}

// Community guides: top cached entries by hit count.
export async function topGuides(limit = 10) {
  const entries = await readCache();
  return entries
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((e) => ({ question: e.question, answer: e.answer, hits: e.hits }));
}
