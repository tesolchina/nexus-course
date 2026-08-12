# Nexus · 智课 (Course-as-Code)

A deploy-first re-implementation of the FITE Agent MVP around a new concept:
**the course is a Git-tracked `course.yaml`**. Students play through levels
(watch video → pass quiz → submit code), earn XP as an anonymous codename,
and get help from a floating AI avatar whose answers are semantically cached
so classmates never pay the same LLM token twice.

Zero runtime dependencies (Node 20 built-ins only), no build step — same
deploy philosophy as `fite-agent-mvp`.

## Run locally

```bash
cp .env.example .env        # optional: add OPENAI_API_KEY for the AI avatar
npm start                   # node server/index.mjs
# open http://localhost:3000
```

Everything works without an API key: levels, video, quiz, code sandbox, XP,
anonymity, semantic cache, TTS. Only the avatar's live chat needs an
OpenAI-compatible key (or bring your own key per request — BYOK).

## The concept, mapped to code

| Concept | Where |
|---|---|
| Course-as-Code (`course.yaml` on Git) | [courses/genai-101.yaml](courses/genai-101.yaml) + `server/course.mjs` (live reload on edit) |
| Minimal single-screen UI (HUD + stage + avatar) | [public/index.html](public/index.html), [public/app.js](public/app.js) |
| Watch → quiz → code level flow | `public/app.js` stage renderers + `/api/course/:level/quiz`, `/code/run`, `/code/submit` |
| Semantic caching + community guides | `server/cache.mjs` + `GET /api/guides` (⚡ badge in chat) |
| BYOK + keyless AI | `server/llm.mjs` (reused from the MVP) |
| 3-level voice degradation | Web Speech API (client) → WASM (future) → `GET /api/tts` proxy (`server/tts.mjs`) |
| Double-blind anonymity | `server/store.mjs` (hash + codename only) + `POST /api/session` |
| Teacher local settlement | `scripts/reveal.mjs` (joins server hash-export with local roster CSV) |
| XP / level-up | `shared/course-schema.mjs` (`LEVEL_XP`) + HUD XP bar |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status, LLM configured, course summary |
| GET | `/api/course` | Course meta + level list (no answer keys) |
| GET | `/api/course/:levelId` | One level (video, quiz without answers, code task) |
| POST | `/api/course/:levelId/quiz` | `{ answers, hash }` → per-question result + XP |
| POST | `/api/course/:levelId/code/run` | `{ code, language }` → sandboxed output |
| POST | `/api/course/:levelId/code/submit` | Record submission + XP (runs server-side) |
| POST | `/api/chat` | Avatar reply; served from semantic cache when possible |
| POST | `/api/session` | Create/load anonymous session `{ codename }` |
| GET | `/api/session/:hash` | Recover a session by SHA-256 hash |
| GET | `/api/guides?limit=10` | Top community guides (auto-sedimented cache) |
| GET | `/api/teacher/export` | Hash-only CSV (names never leave the teacher's machine) |
| GET | `/api/tts?text=..&lang=..` | Free keyless TTS proxy (level-3 fallback) |

## Authoring: make your own course

Fork `courses/genai-101.yaml`, change `meta` and `levels`, restart (or just
save — the server live-reloads on file change). Levels are:
`video.url` → `quiz[]` (options + answer index + hint) → `code` (language,
starter, description). Push to GitHub/Gitee and the course travels with the
repo — zero data lock-in.

## Deploy

Same recipe as the MVP: a Node.js container with `npm start`, tiny image, no
build step. Set `PORT`, optionally `OPENAI_API_KEY` / `OPENAI_BASE_URL`.

See `PLAN.md` for the full architecture and the fite-agent-mvp diff.
