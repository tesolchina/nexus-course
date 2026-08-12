// Nexus · 智课 — zero-dependency HTTP server: static frontend + JSON API on one
// port. Deploy-first, same pattern as fite-agent-mvp.
//
//   start:  node server/index.mjs
//
//   API:
//   GET    /api/health                          status + llm configured
//   GET    /api/registry                        list all registered courses
//   GET    /api/course                          course meta + level list (public, or 404 if none loaded)
//   POST   /api/course/load                     { code } or { url } -> load + return meta
//   GET    /api/course/:levelId                 one level (no answer keys)
//   POST   /api/course/:levelId/quiz            { answers, hash, sessionCode? } -> result
//   POST   /api/course/:levelId/code/run        { code, language } -> sandboxed output
//   POST   /api/course/:levelId/code/submit     { code, language, hash, sessionCode? } -> record + XP
//   POST   /api/chat                            { messages, levelId, hash?, apiKey? } -> avatar
//   POST   /api/session                         { codename? } -> anonymous session
//   GET    /api/session/:hash                   progress by recovery hash
//   GET    /api/guides?limit=10                 top community guides
//   GET    /api/teacher/export                  CSV of hash,xp,level
//   GET    /api/tts?text=..&lang=..             level-3 free TTS proxy
//   POST   /api/teacher/login                   { password } -> token
//   GET    /api/teacher/registry               (auth) -> list courses in registry
//   POST   /api/teacher/registry               (auth) -> add/edit registry entry
//   DELETE /api/teacher/registry/:code         (auth) -> remove from registry
//   POST   /api/teacher/session               (auth) -> create classroom session
//   POST   /api/session/:code/join             { hash, codename } -> join
//   POST   /api/session/:code/heartbeat         { hash } -> update lastSeen
//   GET    /api/session/:code/stats             -> session stats (teacher dashboard)
//   POST   /api/session/:code/close            (auth) -> close session
//   GET    /*                                   static files from ../public

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";

// Zero-dep .env loader (local dev only — Railway uses dashboard env vars).
try {
  const envSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"), "utf8");
  for (const line of envSrc.split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.+)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

import { fileURLToPath } from "node:url";

import {
  getCoursePublic,
  getLevelPublic,
  getLevelWithKeys,
  buildAvatarSystemPrompt,
  setCurrentCourse,
  loadFromPath,
  clearCurrentCourse,
  getCurrentCourse,
} from "./course.mjs";
import {
  createSession,
  getSession,
  addXp,
  recordQuizResult,
  recordCodeSubmission,
  exportSessions,
} from "./store.mjs";
import { lookup, remember, topGuides } from "./cache.mjs";
import { proxyTts } from "./tts.mjs";
import { runCode, isSupportedLanguage } from "./sandbox.mjs";
import { chat, llmConfigured } from "./llm.mjs";
import { LEVEL_XP } from "../shared/course-schema.mjs";
import { login, verifyToken } from "./teacher.mjs";
import {
  createSession as createLiveSession,
  joinSession,
  recordSessionAnswer,
  recordSessionCode,
  recordHeartbeat,
  getSessionStats,
  closeSession,
} from "./live.mjs";
import {
  listCourses,
  getByCode,
  getCourseFile,
  saveCourseFile,
  addOrUpdate,
  remove,
  codeFromUrl,
} from "./registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;
const CODE_XP = 10;
const SPA_REROUTE = /\/(login|teacher|join\/[a-z0-9]+).*/;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) {
        data = "";
        finish({ error: "too_large" });
        req.destroy();
      }
    });
    req.on("aborted", () => finish({ error: "too_large" }));
    req.on("error", () => finish({ error: "bad_json" }));
    req.on("end", () => {
      if (!data) return finish({ value: {} });
      try {
        finish({ value: JSON.parse(data) });
      } catch {
        finish({ error: "bad_json" });
      }
    });
  });
}

function bodyError(res, body) {
  if (body.error === "too_large") {
    sendJson(res, 413, { error: "Request body too large" });
    return true;
  }
  if (body.error) {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return true;
  }
  return false;
}

async function withAuth(req, res) {
  let token;
  let bodyValue = {};
  if (req.method === "GET") {
    // GET: token in query param ?_t=...
    const sp = new URL(req.url, "http://x").searchParams;
    token = sp.get("_t") || "";
  } else {
    const body = await readBody(req);
    if (bodyError(res, body)) return null;
    token = body.value?.token || "";
    bodyValue = body.value;
  }
  if (!token) {
    sendJson(res, 401, { error: "Missing teacher token. Authenticate via POST /api/teacher/login" });
    return null;
  }
  const ok = await verifyToken(token);
  if (!ok) {
    sendJson(res, 403, { error: "Invalid or expired teacher token" });
    return null;
  }
  return { value: bodyValue };
}

function publicSession(s) {
  return {
    hash: s.hash,
    codename: s.codename,
    xp: s.xp,
    level: Math.floor(s.xp / LEVEL_XP) + 1,
    xpToNext: LEVEL_XP - (s.xp % LEVEL_XP),
    levelProgress: s.levelProgress,
    completedLevels: Object.values(s.levelProgress).filter((p) => p.completed).length,
  };
}

async function handleApi(req, res, urlPath) {
  // GET /api/health
  if (req.method === "GET" && urlPath === "/api/health") {
    const course = await getCoursePublic();
    return sendJson(res, 200, {
      ok: true,
      llmConfigured: llmConfigured(),
      courseLoaded: Boolean(course),
      course: course
        ? { id: course.meta.id, code: course.meta.code, title: course.meta.title, levels: course.levels.length }
        : null,
    });
  }

  // GET /api/registry — list all registered courses (public catalog)
  if (req.method === "GET" && urlPath === "/api/registry") {
    const courses = await listCourses();
    return sendJson(res, 200, { courses });
  }

  // POST /api/course/load — load a course by code or GitHub URL
  if (req.method === "POST" && urlPath === "/api/course/load") {
    const body = await readBody(req);
    if (bodyError(res, body)) return;
    const payload = body.value;
    let code = String(payload.code || "").trim().toLowerCase();
    let url = String(payload.url || "").trim();

    if (!code && !url) return sendJson(res, 400, { error: "code or url is required" });

    let filePath;

    // Load by code: first check registry, then look for local/cached file.
    if (code) {
      const entry = await getByCode(code);
      if (entry?.githubUrl && !url) url = entry.githubUrl;
      filePath = await getCourseFile(code);
      if (!filePath && !url) return sendJson(res, 404, { error: `Course "${code}" not found in registry. Paste a GitHub raw URL to load it directly.` });
    }

    // Load by URL.
    if (url) {
      if (!code) code = codeFromUrl(url);
      const rawUrl = toRawUrl(url);
      let res2;
      try {
        res2 = await fetch(rawUrl, {
          headers: { "User-Agent": "nexus-course/1.0", Accept: "text/plain, */*" },
        });
      } catch (err) {
        return sendJson(res, 400, { error: `Network error: ${err.message}` });
      }
      if (!res2.ok) return sendJson(res, 400, { error: `Failed to fetch: ${res2.status} ${rawUrl}` });
      const raw = await res2.text();
      filePath = await saveCourseFile(code, raw);
    }

    // Parse and validate.
    let course;
    try {
      course = await loadFromPath(filePath);
    } catch (err) {
      return sendJson(res, 400, { error: `Invalid course: ${err.message}` });
    }

    // Register it.
    const regCode = course.meta.code || code;
    await addOrUpdate(regCode, {
      title: course.meta.title,
      description: course.meta.subtitle || "",
      githubUrl: url,
      levels: course.levels.length,
    });

    // Set as current.
    setCurrentCourse(course);
    // Return full public course view (levels as array, needed by frontend renderHud).
    const pub = await getCoursePublic();
    return sendJson(res, 200, {
      course: {
        ...pub.meta,
        id: pub.meta.id,
        code: regCode,
        subtitle: pub.meta.subtitle,
        language: pub.meta.language,
        levels: pub.levels,
      },
    });
  }

  // GET /api/course — returns current course or 404
  if (req.method === "GET" && urlPath === "/api/course") {
    const course = await getCoursePublic();
    if (!course) return sendJson(res, 404, { error: "No course loaded. POST /api/course/load first." });
    return sendJson(res, 200, course);
  }
  if (req.method === "POST" && urlPath === "/api/session") {
    const body = await readBody(req);
    if (bodyError(res, body)) return;
    const session = await createSession(body.value?.codename || null);
    return sendJson(res, 201, { session: publicSession(session) });
  }

  // GET /api/session/:hash  (recovery by hash)
  let m = urlPath.match(/^\/api\/session\/([a-f0-9]{8,64})$/);
  if (m && req.method === "GET") {
    const session = await getSession(m[1]);
    if (!session) return sendJson(res, 404, { error: "No session matches that hash" });
    return sendJson(res, 200, { session: publicSession(session) });
  }

  // GET /api/guides
  if (req.method === "GET" && urlPath === "/api/guides") {
    const limit = Math.min(Number(new URL(req.url, "http://x").searchParams.get("limit")) || 10, 50);
    return sendJson(res, 200, { guides: await topGuides(limit) });
  }

  // GET /api/teacher/export  (hash-only CSV)
  if (req.method === "GET" && urlPath === "/api/teacher/export") {
    const rows = await exportSessions();
    const csv = [
      "hash,codename,xp,level,completed_levels",
      ...rows.map((r) => `${r.hash},${r.codename},${r.xp},${r.level},${r.completedLevels}`),
    ].join("\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
    return res.end(csv);
  }

  // GET /api/tts?text=..&lang=..
  if (req.method === "GET" && urlPath === "/api/tts") {
    const sp = new URL(req.url, "http://x").searchParams;
    const text = (sp.get("text") || "").trim();
    if (!text) return sendJson(res, 400, { error: "text is required" });
    const result = await proxyTts(text, sp.get("lang") || "en");
    if (!result.ok) return sendJson(res, 502, { error: result.error });
    res.writeHead(200, {
      "Content-Type": result.type,
      "Cache-Control": "public, max-age=3600",
    });
    return res.end(result.audio);
  }

  // POST /api/chat  (avatar tutor, with semantic cache)
  if (req.method === "POST" && urlPath === "/api/chat") {
    const body = await readBody(req);
    if (bodyError(res, body)) return;
    const payload = body.value;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const levelId = String(payload.levelId || "");
    const lastUser = [...messages].reverse().find((msg) => msg.role === "user");

    if (!lastUser || !String(lastUser.content || "").trim()) {
      return sendJson(res, 400, { error: "messages must include at least one user message" });
    }

    const cached = await lookup(lastUser.content);
    if (cached.hit) {
      return sendJson(res, 200, {
        reply: cached.answer,
        cached: true,
        cacheHits: cached.hits,
      });
    }

    const system = await buildAvatarSystemPrompt(levelId);
    const llmMessages = [
      { role: "system", content: system },
      ...messages
        .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant"))
        .map((msg) => ({ role: msg.role, content: String(msg.content || "") })),
    ];
    const reply = await chat(llmMessages, { apiKey: payload.apiKey });
    if (!reply.ok) return sendJson(res, 502, { error: reply.error });
    await remember(lastUser.content, reply.content);
    return sendJson(res, 200, { reply: reply.content, cached: false });
  }

  // ========== TEACHER AUTH ROUTES ==========

  // POST /api/teacher/login { password } -> { token }
  if (req.method === "POST" && urlPath === "/api/teacher/login") {
    const body = await readBody(req);
    if (bodyError(res, body)) return;
    const token = await login(body.value.password || "");
    if (!token) return sendJson(res, 401, { error: "Invalid password" });
    return sendJson(res, 200, { token });
  }

// Convert GitHub/Gitee blob URLs to raw.
function toRawUrl(url) {
  let u = url.trim();
  u = u.replace(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/,
    "https://raw.githubusercontent.com/$1/$2",
  );
  u = u.replace(
    /^https?:\/\/gitee\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/,
    "https://gitee.com/$1/raw/$2",
  );
  return u;
}

  // ========== CLASSROOM SESSION ROUTES ==========

  // GET /api/teacher/registry (auth) — list all registry entries
  if (req.method === "GET" && urlPath === "/api/teacher/registry") {
    const body = await withAuth(req, res);
    if (!body) return;
    const courses = await listCourses();
    const current = getCurrentCourse();
    return sendJson(res, 200, { courses, currentCourse: current ? { id: current.meta.id, code: current.meta.code, title: current.meta.title } : null });
  }

  // POST /api/teacher/registry (auth) — add/edit registry entry
  if (req.method === "POST" && urlPath === "/api/teacher/registry") {
    const body = await withAuth(req, res);
    if (!body) return;
    const { code, title, description, githubUrl } = body.value;
    if (!code) return sendJson(res, 400, { error: "code is required" });
    const entry = await addOrUpdate(code.toLowerCase(), { title, description, githubUrl });
    return sendJson(res, 200, { entry });
  }

  // DELETE /api/teacher/registry/:code (auth)
  m = urlPath.match(/^\/api\/teacher\/registry\/(.+)$/);
  if (m && req.method === "DELETE") {
    const body = await withAuth(req, res);
    if (!body) return;
    const code = m[1];
    const removed = await remove(code);
    if (!removed) return sendJson(res, 404, { error: "Course not found in registry" });
    // If it was the current course, clear it.
    const current = getCurrentCourse();
    if (current?.meta?.code === code || current?.meta?.id === code) clearCurrentCourse();
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/teacher/session — list active sessions (auth)
  if (req.method === "GET" && urlPath === "/api/teacher/sessions") {
    const body = await withAuth(req, res);
    if (!body) return;
    const sessions = await import("./live.mjs").then((m) => m.listSessions());
    return sendJson(res, 200, { sessions });
  }

  // POST /api/teacher/session (auth) — create live session
  if (req.method === "POST" && urlPath === "/api/teacher/session") {
    const body = await withAuth(req, res);
    if (!body) return;
    const course = await getCoursePublic();
    const title = course ? `${course.meta.title} (${course.meta.code})` : "Nexus Course";
    const session = await createLiveSession({ id: course?.meta?.id, code: course?.meta?.code, title, levels: course?.levels?.length || 0 });
    const host = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || `localhost:${PORT}`}`;
    return sendJson(res, 201, {
      code: session.code,
      createdAt: session.createdAt,
      joinUrl: `${host}/#/join/${session.code}`,
    });
  }

  // POST /api/session/:code/join  { hash, codename }
  m = urlPath.match(/^\/api\/session\/(\d{6})\/join$/);
  if (m && req.method === "POST") {
    const body = await readBody(req);
    if (bodyError(res, body)) return;
    const { hash, codename } = body.value;
    if (!hash || !codename) return sendJson(res, 400, { error: "hash and codename are required" });
    const result = await joinSession(m[1], hash, codename);
    if (!result.ok) return sendJson(res, 404, { error: result.error });
    return sendJson(res, 200, { codename: result.codename });
  }

  // POST /api/session/:code/heartbeat  { hash }
  m = urlPath.match(/^\/api\/session\/(\d{6})\/heartbeat$/);
  if (m && req.method === "POST") {
    const body = await readBody(req);
    if (bodyError(res, body)) return;
    const ok = await recordHeartbeat(m[1], body.value.hash);
    if (!ok) return sendJson(res, 404, { error: "Session or student not found" });
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/session/:code/stats
  m = urlPath.match(/^\/api\/session\/(\d{6})\/stats$/);
  if (m && req.method === "GET") {
    const stats = await getSessionStats(m[1]);
    if (!stats) return sendJson(res, 404, { error: "Session not found or closed" });
    return sendJson(res, 200, { stats });
  }

  // POST /api/session/:code/close (auth)
  m = urlPath.match(/^\/api\/session\/(\d{6})\/close$/);
  if (m && req.method === "POST") {
    const body = await withAuth(req, res);
    if (!body) return;
    const result = await closeSession(m[1], body.value.token);
    if (!result.ok) return sendJson(res, 404, { error: result.error });
    return sendJson(res, 200, { ok: true });
  }

  // ========== COURSE LEVEL ROUTES ==========

  // /api/course/:levelId and sub-routes (/quiz, /code/run, /code/submit)
  m = urlPath.match(/^\/api\/course\/([^/]+)(\/[a-z]+(?:\/[a-z]+)?)?$/);
  if (m) {
    const levelId = decodeURIComponent(m[1]);
    const action = m[2] ? m[2].slice(1) : ""; // "quiz" | "code/run" | "code/submit" | ""

    // GET level (public, no answers)
    if (!action && req.method === "GET") {
      const level = await getLevelPublic(levelId);
      if (!level) return sendJson(res, 404, { error: "Level not found" });
      return sendJson(res, 200, { level });
    }

    // POST quiz (with optional sessionCode -> record into live session)
    if (action === "quiz" && req.method === "POST") {
      const body = await readBody(req);
      if (bodyError(res, body)) return;
      const level = await getLevelWithKeys(levelId);
      if (!level) return sendJson(res, 404, { error: "Level not found" });
      const answers = Array.isArray(body.value.answers) ? body.value.answers : [];
      const correct = level.quiz.map((q, i) => Number(answers[i]) === q.answer);
      const score = correct.filter(Boolean).length;
      const total = level.quiz.length;
      const xpPerQuestion = await getLevelXpPerQuestion();
      const xpEarned = score * xpPerQuestion;

      let session = null;
      const hash = String(body.value.hash || "");
      if (/^[a-f0-9]{8,64}$/.test(hash)) {
        const prev = await getSession(hash);
        if (prev) {
          const old = prev.levelProgress[levelId]?.quizCorrect || 0;
          const newCorrect = Math.max(score, old);
          const gained = (newCorrect - old) * xpPerQuestion;
          if (gained > 0) session = await addXp(hash, gained);
          session = await recordQuizResult(hash, levelId, score, total, Boolean(level.code));
        }
        // Record into live session if sessionCode provided.
        const sessionCode = body.value.sessionCode;
        if (sessionCode) {
          await recordSessionAnswer(sessionCode, hash, levelId, score, total);
        }
      }
      return sendJson(res, 200, {
        correct,
        score,
        total,
        passed: score === total,
        xpEarned,
        session: session ? publicSession(session) : null,
      });
    }

    // POST code/run (sandbox, no session needed)
    if (action === "code/run" && req.method === "POST") {
      const body = await readBody(req);
      if (bodyError(res, body)) return;
      const { code, language } = body.value;
      if (!isSupportedLanguage(language)) {
        return sendJson(res, 400, { error: `Unsupported language: ${language}` });
      }
      const result = await runCode(code, language);
      return sendJson(res, 200, result);
    }

    // POST code/submit (record + XP, optional sessionCode)
    if (action === "code/submit" && req.method === "POST") {
      const body = await readBody(req);
      if (bodyError(res, body)) return;
      const { code, language, hash, sessionCode } = body.value;
      if (!isSupportedLanguage(language)) {
        return sendJson(res, 400, { error: `Unsupported language: ${language}` });
      }
      const result = await runCode(code, language);
      const passed = result.ok && result.code === 0 && !result.stderr.trim();
      let session = null;
      if (/^[a-f0-9]{8,64}$/.test(String(hash || ""))) {
        const prev = await getSession(hash);
        if (prev) {
          const already = prev.levelProgress[levelId]?.codeSubmitted;
          session = await recordCodeSubmission(hash, levelId, code, result.stdout, passed);
          if (!already && passed) session = await addXp(hash, CODE_XP);
        }
        // Record code event into live session.
        if (sessionCode && passed) {
          await recordSessionCode(sessionCode, hash, levelId);
        }
      }
      return sendJson(res, 200, {
        run: { ok: result.ok, stdout: result.stdout, stderr: result.stderr, passed, timedOut: result.timedOut },
        session: session ? publicSession(session) : null,
      });
    }

    return sendJson(res, 404, { error: "Unknown course route" });
  }

  return sendJson(res, 404, { error: "Unknown API route" });
}

async function getLevelXpPerQuestion() {
  const course = await getCoursePublic();
  return course?.meta?.xpPerQuestion || 10;
}

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  // SPA reroute: hash-based SPA routes -> serve index.html.
  if (SPA_REROUTE.test(urlPath)) {
    rel = "/index.html";
  }
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) filePath = join(PUBLIC_DIR, "index.html");
  if (!existsSync(filePath)) filePath = join(PUBLIC_DIR, "index.html");
  try {
    const buf = await readFile(filePath);
    const ext = extname(filePath);
    const noCache = [".html", ".js", ".css"].includes(ext);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (noCache) headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    res.writeHead(200, headers);
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURI((req.url || "/").split("?")[0]);
    if (urlPath.startsWith("/api/")) {
      await handleApi(req, res, urlPath);
    } else {
      await serveStatic(req, res, urlPath);
    }
  } catch (err) {
    sendJson(res, 500, { error: `Server error: ${err.message}` });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[nexus] listening on http://0.0.0.0:${PORT}`);
  console.log(`[nexus] LLM configured: ${llmConfigured()}`);
  console.log(`[nexus] Load a course: POST /api/course/load {code} or {url}`);
});