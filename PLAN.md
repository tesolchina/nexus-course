# Nexus · 智课 — architecture plan and the fite-agent-mvp diff

This document explains the new "Course-as-Code" architecture, and exactly how
the existing `fite-agent-mvp` code was changed to become it.

## 1. The shift in one sentence

The MVP sold **"create a tutor tool"**; Nexus sells **"the course is a Git
repo"** — levels, video links, quiz answers, code tasks and the AI persona all
live in `course.yaml`, and students play through them anonymously.

## 2. What we kept from fite-agent-mvp (reused, not rewritten)

| MVP file | Nexus equivalent | What changed |
|---|---|---|
| `server/index.mjs` | `server/index.mjs` | Same static+API-on-one-port pattern, same body/sendJson helpers; routes replaced |
| `server/store.mjs` | `server/store.mjs` | Same single-writer lock + atomic temp-file-rename writes; now stores sessions by hash instead of tools |
| `server/llm.mjs` | `server/llm.mjs` | Unchanged: BYOK → env → Replit key resolution, any OpenAI-compatible endpoint |
| `shared/tool-schema.mjs` | `shared/course-schema.mjs` | Same single-source-of-truth idea; now validates a course/level shape and strips answer keys |
| `server/prompt.mjs` | `server/course.mjs#buildAvatarSystemPrompt` | Tool config → avatar persona from `meta.avatar.prompt` + level context |
| `public/*` gallery/create/chat | `public/*` HUD/stage/avatar | Full rewrite for the single-screen game UI |

Deleted: the tool model, the create-tool form, `data/tools.json` seeds.

## 3. New modules (each maps to one concept in the architecture doc)

- `server/yaml.mjs` — zero-dep YAML subset parser (course.yaml needs no
  runtime dependency; a parse failure fails loudly, never silently).
- `server/course.mjs` — loads `course.yaml` with mtime-based live reload:
  edit the file and the next request serves the new course.
- `server/cache.mjs` — **semantic cache**: normalized-question hash key, exact
  + prefix match, hit counting; top entries exposed as community guides
  (`GET /api/guides`) — the "auto-沉淀为社区攻略" idea.
- `server/store.mjs` — **double-blind identity**: random codenames
  (`CyberPanda_88`) + one-way SHA-256; the server never stores a real name.
- `server/tts.mjs` — **level-3 voice fallback**: free keyless TTS proxy.
  Ladder: Web Speech API (client) → local WASM (future hook) → this proxy.
- `server/sandbox.mjs` — timeout-bounded (3 s, 4 KB) python3/node runner for
  code tasks. A classroom sandbox, explicitly not a security boundary.
- `scripts/reveal.mjs` — **teacher local settlement**: joins the server's
  hash-only CSV export with a roster CSV that only exists on the teacher's
  machine; the cloud never contains the join.

## 4. The double-blind flow, end to end

1. First visit → `POST /api/session` → server mints `{ codename, hash }`
   (hash = SHA-256 of codename, stored; codename generated server-side).
2. Browser keeps `{ codename, hash }` in localStorage; all progress requests
   send only the hash.
3. Forgotten ID → hash pasted into the recovery modal (or "Send & Forget"
   email in production) → `GET /api/session/:hash` → codename + progress.
4. Teacher at term end: `GET /api/teacher/export` (hash,xp,level) → run
   `scripts/reveal.mjs --roster roster.csv` locally → grades.csv. Names were
   never in the cloud; the join happens on the teacher's machine.

## 5. Cost control, end to end

Avatar chat: `POST /api/chat` → `cache.lookup(lastUserMessage)` → on hit,
return instantly with `cached: true` (zero tokens, ⚡ badge). On miss, one
LLM call, then `cache.remember()` so the next classmate with the same error
gets the answer free. `GET /api/guides` surfaces the top hits as community
攻略. Students without keys still get the tutor through the platform key
(BYOK override remains for anyone who brings their own).

## 6. Roadmap (each step independently shippable)

- **M0 — this folder.** Course-as-Code, single-screen UI, quiz + sandbox +
  XP, anonymity, semantic cache, TTS ladder. Runs with zero API keys.
- **M1 — Git sync + auth upgrade.** Pull `course.yaml` from a repo on boot
  (or webhook), GitHub/Gitee OAuth → personal portfolio repo auto-commit.
- **M2 — P2P messaging.** One-time handshake token for anonymous private
  chats between classmates (no WeChat/email exchange).
- **M3 — Moodle LTI 1.3.** Passwordless launch + XP → Moodle gradebook
  sync; Verified Educator badge + teacher avatar clone.
- **M4 — Community.** Giscus/GitHub Discussions embedding, course forks,
  public gallery of community courses.
- **M5 — Hardening.** Postgres/Replit DB, real rate limits, WASM voice
  (level-2 degradation), production Edge-TTS proxy.

## 7. Known limits (honest list)

- JSON-file storage: fine for one instance / a class; not multi-instance.
- Code sandbox is a friendly local runner, not a security boundary (no
  network namespace, no memory limits).
- Semantic cache is exact+prefix matching, not true embeddings (a real
  vector index is an M2 upgrade).
- TTS proxy hits a keyless public endpoint (rate limits apply; swap to
  Edge-TTS in production).
- No real auth yet: anyone with the URL can play. That is by design for a
  pilot class; OAuth lands in M1.

