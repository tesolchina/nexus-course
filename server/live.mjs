// Live classroom sessions (Kahoot-lite, 30-min window).
// JSON-persisted store with single-writer lock. Each session is a 6-digit PIN
// that students join anonymously. Stats computed from join/answer/heartbeat events.
// NOT real-time: poll every 5s for the "past 30 minutes" view.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const LIVE_FILE = join(DATA_DIR, "live.json");
const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 h (auto-prune on write)
const ACTIVE_WINDOW = 30 * 60 * 1000; // 30 min for "past 30 minutes" stats
const ONLINE_WINDOW = 5 * 60 * 1000; // 5 min for "active now"

// ---------- single-writer lock ----------

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
  if (!existsSync(LIVE_FILE)) return { sessions: [] };
  const raw = await readFile(LIVE_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return { sessions: [] };
  }
}

async function writeAll(data) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const now = Date.now();
  // Prune expired sessions.
  data.sessions = data.sessions.filter((s) => now - new Date(s.createdAt).getTime() < SESSION_TTL);
  const tmp = `${LIVE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, LIVE_FILE);
}

// ---------- helpers ----------

function generateCode() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

function now() {
  return new Date().toISOString();
}

function ts(it) {
  return new Date(it).getTime();
}

// ---------- public API ----------

// Create a new session for the current course. Returns session metadata.
export async function createSession(courseMeta) {
  let result;
  await withLock(async () => {
    const data = await readAll();
    const code = generateCode();
    // Ensure unique code.
    while (data.sessions.some((s) => s.code === code && !s.closed)) {
      code = generateCode();
    }
    const session = {
      code,
      courseMeta,
      createdAt: now(),
      closed: false,
      joined: [], // { hash, codename, joinedAt, lastSeen, answers: [{levelId, score, total, at}], codeSubmitted: [levelId] }
      events: [], // { type: 'join'|'answer'|'code', codename, detail, at }
    };
    data.sessions.push(session);
    await writeAll(data);
    result = session;
  });
  return result;
}

// Student joins a session. Returns { ok, codename } or { ok: false, error }.
export async function joinSession(code, hash, codename) {
  return withLock(async () => {
    const data = await readAll();
    const session = data.sessions.find((s) => s.code === code && !s.closed);
    if (!session) return { ok: false, error: "Session not found or closed" };
    const existing = session.joined.find((j) => j.hash === hash);
    if (existing) {
      existing.lastSeen = now();
      await writeAll(data);
      return { ok: true, codename: existing.codename };
    }
    session.joined.push({ hash, codename, joinedAt: now(), lastSeen: now(), answers: [], codeSubmitted: [] });
    session.events.push({ type: "join", codename, detail: "", at: now() });
    await writeAll(data);
    return { ok: true, codename };
  });
}

// Record a quiz answer for a student in a session.
export async function recordSessionAnswer(code, hash, levelId, correctCount, total) {
  return withLock(async () => {
    const data = await readAll();
    const session = data.sessions.find((s) => s.code === code && !s.closed);
    if (!session) return;
    const joiner = session.joined.find((j) => j.hash === hash);
    if (!joiner) return;
    joiner.answers.push({ levelId, score: correctCount, total, at: now() });
    joiner.lastSeen = now();
    session.events.push({
      type: "answer",
      codename: joiner.codename,
      detail: `${levelId} ${correctCount}/${total}`,
      at: now(),
    });
    await writeAll(data);
  });
}

// Record a code submission for a student in a session.
export async function recordSessionCode(code, hash, levelId) {
  return withLock(async () => {
    const data = await readAll();
    const session = data.sessions.find((s) => s.code === code && !s.closed);
    if (!session) return;
    const joiner = session.joined.find((j) => j.hash === hash);
    if (!joiner) return;
    if (!joiner.codeSubmitted.includes(levelId)) joiner.codeSubmitted.push(levelId);
    joiner.lastSeen = now();
    session.events.push({
      type: "code",
      codename: joiner.codename,
      detail: levelId,
      at: now(),
    });
    await writeAll(data);
  });
}

// Update lastSeen (heartbeat). Returns true if session exists.
export async function recordHeartbeat(code, hash) {
  return withLock(async () => {
    const data = await readAll();
    const session = data.sessions.find((s) => s.code === code && !s.closed);
    if (!session) return false;
    const joiner = session.joined.find((j) => j.hash === hash);
    if (!joiner) return false;
    joiner.lastSeen = now();
    await writeAll(data);
    return true;
  });
}

// Close a session (teacher action).
export async function closeSession(code, teacherToken) {
  return withLock(async () => {
    const data = await readAll();
    const session = data.sessions.find((s) => s.code === code);
    if (!session) return { ok: false, error: "Session not found" };
    session.closed = true;
    await writeAll(data);
    return { ok: true };
  });
}

// Compute aggregate stats for a session.
// Core ask: "显示过去半个小时之内登录的所有人的这个答题的情况，包括有多少人这个登录了"
export async function getSessionStats(code) {
  const data = await readAll();
  const session = data.sessions.find((s) => s.code === code && !s.closed);
  if (!session) return null;

  const nowMs = Date.now();
  const bucket = (threshold) => session.joined.filter((j) => nowMs - ts(j.joinedAt) < threshold).length;

  const joinedList = session.joined.map((j) => ({
    hash: j.hash,
    codename: j.codename,
    joinedAt: j.joinedAt,
    lastSeen: j.lastSeen,
    isOnline: nowMs - ts(j.lastSeen) < ONLINE_WINDOW,
    answers: j.answers,
    codeSubmitted: j.codeSubmitted,
  }));

  // Aggregate per-level stats.
  const levelMap = {};
  for (const j of session.joined) {
    for (const a of j.answers) {
      if (!levelMap[a.levelId]) {
        levelMap[a.levelId] = { answerCount: 0, correctCount: 0, totalCount: 0 };
      }
      levelMap[a.levelId].answerCount++;
      levelMap[a.levelId].correctCount += a.score;
      levelMap[a.levelId].totalCount += a.total;
    }
  }

  // XP leaderboard: sum XP from the main store; here we just report answer score sum.
  // Simpler: just show answer scores as proxy for XP (actual XP lives in sessions.json).
  const scoreMap = {};
  for (const j of session.joined) {
    const totalScore = j.answers.reduce((s, a) => s + a.score, 0);
    scoreMap[j.hash] = { codename: j.codename, score: totalScore };
  }
  const leaderboard = Object.values(scoreMap).sort((a, b) => b.score - a.score).slice(0, 10);

  // Recent events (last 50).
  const recentEvents = session.events.slice(-50);

  return {
    code: session.code,
    courseMeta: session.courseMeta,
    createdAt: session.createdAt,
    closed: session.closed,
    joinedTotal: session.joined.length,
    joinedLast30m: bucket(ACTIVE_WINDOW),
    activeNow: session.joined.filter((j) => nowMs - ts(j.lastSeen) < ONLINE_WINDOW).length,
    lastSeenBuckets: {
      "5m": bucket(5 * 60 * 1000),
      "15m": bucket(15 * 60 * 1000),
      "30m": bucket(ACTIVE_WINDOW),
    },
    levels: Object.entries(levelMap).map(([levelId, s]) => ({
      levelId,
      answerCount: s.answerCount,
      correctRate: s.totalCount > 0 ? (s.correctCount / s.totalCount).toFixed(2) : 0,
      totalQuestions: s.totalCount,
      correctQuestions: s.correctCount,
    })),
    joinedList,
    leaderboard,
    recentEvents,
  };
}

// List active sessions for a teacher (for dashboard).
export async function listSessions() {
  const data = await readAll();
  return data.sessions
    .filter((s) => !s.closed)
    .map((s) => ({
      code: s.code,
      courseTitle: s.courseMeta?.title || "Untitled",
      createdAt: s.createdAt,
      joinedCount: s.joined.length,
    }));
}