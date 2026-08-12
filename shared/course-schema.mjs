// The shape of a course.yaml (Course-as-Code). Single source of truth shared by
// the loader, the API and the UI. A course is a Git-tracked YAML file; levels
// contain an ordered sequence of "blocks": animated scenes, MC questions, tutor
// prompts, videos, code tasks. Old-style quiz+code tasks still supported.

export const LANGUAGES = ["python", "javascript"];

export const LEVEL_XP = 50;

export const DEFAULT_AVATAR = {
  name: "Nova",
  emoji: "🪐",
  voice: "en-US-JennyNeural",
  prompt:
    "You are Nova, an encouraging AI tutor on a learning platform. Keep replies short and friendly. Coach with hints, never hand over a full answer to a quiz or code task. Ask one question at the end to keep the learner working.",
};

// ---------- Block validators ----------

function validateBlock(block, levelIdx, blockIdx) {
  if (!block || typeof block !== "object") return null;
  const type = String(block.type || "").toLowerCase();
  switch (type) {
    case "scene":
      return {
        type: "scene",
        animation: String(block.animation || "").trim(),
        title: String(block.title || "").trim(),
        caption: String(block.caption || "").trim(),
      };
    case "mc":
      return {
        type: "mc",
        question: String(block.question || "").trim(),
        options: Array.isArray(block.options) ? block.options.map((o) => String(o)) : [],
        answer: Number.isInteger(block.answer) ? block.answer : 0,
        hint: String(block.hint || "").trim(),
      };
    case "video":
      return {
        type: "video",
        url: String(block.url || "").trim(),
        caption: String(block.caption || "").trim(),
        duration: String(block.duration || "").trim(),
      };
    case "tutor":
      return {
        type: "tutor",
        prompt: String(block.prompt || "").trim(),
      };
    case "code":
      return {
        type: "code",
        title: String(block.title || "Code task"),
        description: String(block.description || "").trim(),
        language: LANGUAGES.includes(block.language) ? block.language : "python",
        starter: String(block.starter || "").trim(),
      };
    case "poll":
      // Opinion poll — no correct answer
      return {
        type: "poll",
        question: String(block.question || "").trim(),
        options: Array.isArray(block.options) ? block.options.map((o) => String(o)) : [],
        hint: String(block.hint || "").trim(),
      };
    default:
      return null;
  }
}

export function validateCourse(input) {
  const errors = [];
  const c = input && typeof input === "object" ? input : {};

  const meta = c.meta || {};
  if (!meta.id || !String(meta.id).trim()) errors.push("meta.id is required");
  if (!meta.title || !String(meta.title).trim()) errors.push("meta.title is required");

  const avatar = { ...DEFAULT_AVATAR, ...(meta.avatar || {}) };
  avatar.prompt = String(avatar.prompt || DEFAULT_AVATAR.prompt);

  if (!Array.isArray(c.levels) || c.levels.length === 0) {
    errors.push("levels must be a non-empty array");
  }

  const levels = (Array.isArray(c.levels) ? c.levels : []).map((raw, i) => {
    const level = raw && typeof raw === "object" ? raw : {};
    if (!level.id || !String(level.id).trim()) errors.push(`levels[${i}].id is required`);
    if (!level.title || !String(level.title).trim()) errors.push(`levels[${i}].title is required`);

    // --- Legacy fields (quiz + code task, kept for backward compat) ---
    const quiz = Array.isArray(level.quiz)
      ? level.quiz.map((q, j) => {
          const question = q && typeof q === "object" ? q : {};
          if (!question.question) errors.push(`levels[${i}].quiz[${j}].question is required`);
          if (!Array.isArray(question.options) || question.options.length < 2) {
            errors.push(`levels[${i}].quiz[${j}].options needs at least 2 options`);
          }
          if (!Number.isInteger(question.answer)) {
            errors.push(`levels[${i}].quiz[${j}].answer must be an integer index`);
          } else if (Array.isArray(question.options) && question.answer >= question.options.length) {
            errors.push(`levels[${i}].quiz[${j}].answer index out of range`);
          }
          return {
            question: String(question.question || ""),
            options: (question.options || []).map((o) => String(o)),
            answer: question.answer,
            hint: String(question.hint || ""),
          };
        })
      : [];

    const code = level.code && typeof level.code === "object" ? level.code : null;

    // --- New block array (ordered blocks replaces linear watch->quiz->code) ---
    const blocks = Array.isArray(level.blocks)
      ? level.blocks.map((b, j) => {
          const v = validateBlock(b, i, j);
          if (!v) errors.push(`levels[${i}].blocks[${j}] has unknown or empty type: "${b.type}"`);
          return v;
        }).filter(Boolean)
      : [];

    return {
      id: String(level.id || "").trim(),
      title: String(level.title || "").trim(),
      emoji: String(level.emoji || "🎯").trim().slice(0, 4) || "🎯",
      description: String(level.description || "").trim(),
      video: level.video && typeof level.video === "object" ? level.video : null,
      quiz,
      code: code
        ? {
            title: String(code.title || "Code task"),
            description: String(code.description || ""),
            language: LANGUAGES.includes(code.language) ? code.language : "python",
            starter: String(code.starter || ""),
          }
        : null,
      blocks,
      avatarPrompt: String(level.avatar?.prompt || "").trim(),
    };
  });

  if (errors.length) return { ok: false, errors };

  const value = {
    meta: {
      id: String(meta.id).trim(),
      code: String(meta.code || meta.id).trim(),
      title: String(meta.title).trim(),
      subtitle: String(meta.subtitle || "").trim(),
      language: String(meta.language || "en"),
      teacher: String(meta.teacher || "").trim(),
      repo: String(meta.repo || "").trim(),
      xpPerQuestion: Number(meta.xpPerQuestion) > 0 ? Number(meta.xpPerQuestion) : 10,
      avatar,
    },
    levels,
  };

  return { ok: true, value };
}

// Level as served to students: answer keys stripped.
export function publicLevel(level) {
  return {
    id: level.id,
    title: level.title,
    emoji: level.emoji,
    description: level.description,
    video: level.video
      ? {
          url: level.video.url || "",
          caption: String(level.video.caption || ""),
        }
      : null,
    quiz: level.quiz.map((q) => ({
      question: q.question,
      options: q.options,
      hint: q.hint,
    })),
    code: level.code,
    hasAvatarPrompt: Boolean(level.avatarPrompt),
    blocks: (level.blocks || []).map((b) => {
      switch (b.type) {
        case "mc":
          return { type: "mc", question: b.question, options: b.options, hint: b.hint };
        case "scene":
          return { type: "scene", animation: b.animation, title: b.title, caption: b.caption };
        case "video":
          return { type: "video", url: b.url, caption: b.caption, duration: b.duration };
        case "tutor":
          return { type: "tutor", prompt: b.prompt };
        case "code":
          return { type: "code", title: b.title, description: b.description, language: b.language, starter: b.starter };
        case "poll":
          return { type: "poll", question: b.question, options: b.options, hint: b.hint };
        default:
          return { type: b.type };
      }
    }),
  };
}