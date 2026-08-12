// Nexus · 智课 — vanilla SPA with course-as-code loader.
// Landing page: student enters course code/URL, teacher enters password.
// After course loads, shows HUD + level stages + AI avatar.
// No build step.

const $ = (id) => document.getElementById(id);

const state = {
  course: null,        // { meta, levels } — set by loadCourse
  session: null,       // { hash, codename, xp, … }
  level: null,         // current public level
  quizAnswers: [],
  quizLocked: false,
  code: "",
  token: null,        // teacher auth token
  sessionCode: null,   // live classroom PIN
  teacherTimer: null,
};

// ---------- API helpers ----------

const api = {
  async get(path) {
    const r = await fetch(path);
    return { status: r.status, data: await r.json() };
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  },
  async postAuth(path, body) {
    if (!state.token) return { status: 401, data: { error: "Not authenticated" } };
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token: state.token }),
    });
    if (r.status === 403) { state.token = null; localStorage.removeItem("nexus_teacher_token"); }
    return { status: r.status, data: await r.json() };
  },
  async getAuth(path) {
    if (!state.token) return { status: 401, data: { error: "Not authenticated" } };
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${path}${sep}_t=${encodeURIComponent(state.token)}`);
    if (r.status === 403) { state.token = null; localStorage.removeItem("nexus_teacher_token"); }
    return { status: r.status, data: await r.json() };
  },
  async deleteAuth(path) {
    if (!state.token) return { status: 401, data: { error: "Not authenticated" } };
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${path}${sep}_t=${encodeURIComponent(state.token)}`, { method: "DELETE" });
    if (r.status === 403) { state.token = null; localStorage.removeItem("nexus_teacher_token"); }
    return { status: r.status, data: await r.json() };
  },
};

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// ---------- Student session ----------

async function ensureSession() {
  const saved = localStorage.getItem("nexus_session");
  if (saved) {
    try {
      const { codename } = JSON.parse(saved);
      const { status, data } = await api.post("/api/session", { codename });
      if (status === 201) {
        state.session = data.session;
        localStorage.setItem("nexus_session", JSON.stringify({ codename: data.session.codename, hash: data.session.hash }));
        return;
      }
    } catch {}
  }
  const { data } = await api.post("/api/session", {});
  state.session = data.session;
  localStorage.setItem("nexus_session", JSON.stringify({ codename: data.session.codename, hash: data.session.hash }));
}

function updateSessionOnly(session) {
  state.session = session;
  localStorage.setItem("nexus_session", JSON.stringify({ codename: session.codename, hash: session.hash }));
  renderHud();
}

function setSession(session) {
  state.session = session;
  localStorage.setItem("nexus_session", JSON.stringify({ codename: session.codename, hash: session.hash }));
  renderHud();
  if (state.course) renderStage();
}

// ---------- HUD ----------

function renderHud() {
  if (!state.course) return;
  const s = state.session;
  $("codename").textContent = `👤 ${s ? s.codename : "…"}`;
  if (!s) return;
  $("xp-label").textContent = `Lv.${s.level}`;
  $("xp-num").textContent = `${s.xp} XP`;
  $("xp-fill").style.width = `${Math.min(100, (s.xp % 50) / 0.5)}%`;

  const dots = state.course.levels;
  $("level-dots").innerHTML = dots.map((l) => {
    const prog = s.levelProgress[l.id] || {};
    const done = prog.completed ? "done" : "";
    const active = state.level && state.level.id === l.id ? "active" : "";
    return `<a class="level-dot ${done} ${active}" href="#/l/${esc(l.id)}/watch">${esc(l.emoji)} ${esc(l.title)}</a>`;
  }).join("");

  const sc = localStorage.getItem("nexus_session_code");
  if (sc) {
    $("session-badge").classList.remove("hidden");
    $("session-badge-code").textContent = sc;
  } else {
    $("session-badge").classList.add("hidden");
  }
}

// ---------- Course loader ----------

async function loadCourse(code, url) {
  const errEl = $("load-error");
  const sucEl = $("load-success");
  const btn = $("load-course-btn");
  errEl.textContent = "";
  sucEl.textContent = "";
  // Show loading state
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Loading course…"; btn.classList.add("loading"); }
  try {
    const body = {};
    if (code) body.code = code;
    if (url) body.url = url;
    const { status, data } = await api.post("/api/course/load", body);
    if (status !== 200) {
      errEl.textContent = data.error || "Failed to load course";
      if (btn) { btn.disabled = false; btn.textContent = "Load Course"; btn.classList.remove("loading"); }
      return false;
    }
    state.course = data.course;
    const courseCode = code || url || data.course.id;
    document.title = `${data.course.title} — Nexus`;
    // Update URL so it can be bookmarked / shared
    history.replaceState(null, "", `#/course/${encodeURIComponent(courseCode)}`);
    localStorage.setItem("nexus_last_course", JSON.stringify({ code: courseCode }));
    sucEl.textContent = `✅ Redirecting to ${data.course.title}…`;
    showApp();
    await ensureSession();
    renderHud();
    renderStage();
    if (btn) { btn.disabled = false; btn.textContent = "Load Course"; btn.classList.remove("loading"); }
    return true;
  } catch (err) {
    errEl.textContent = "Network error — please try again.";
    if (btn) { btn.disabled = false; btn.textContent = "Load Course"; btn.classList.remove("loading"); }
    return false;
  }
}

function showApp() {
  $("landing").classList.add("hidden");
  $("app-hud").classList.remove("hidden");
  $("stage").classList.remove("hidden");
  $("avatar-wrap").classList.remove("hidden");
  $("app-footer").classList.remove("hidden");
}

function showLanding() {
  // Clear course state so landing is shown even if user navigated here from a course page
  state.course = null;
  $("landing").classList.remove("hidden");
  $("app-hud").classList.add("hidden");
  $("stage").classList.add("hidden");
  $("avatar-wrap").classList.add("hidden");
  $("app-footer").classList.add("hidden");
}

// ---------- Landing page ----------

async function landingView() {
  console.log("[landingView] running, state.course:", state.course?.id);
  // Load registry catalog
  const { data } = await api.get("/api/registry");
  const list = $("registry-list");
  if (data.courses && data.courses.length) {
    list.innerHTML = data.courses.map((c) => `
      <div class="registry-item" data-code="${esc(c.code)}">
        <div>
          <div class="registry-item-title">${esc(c.title)}</div>
          <div class="registry-item-desc">${esc(c.code)} · ${c.levels} levels</div>
        </div>
        <span class="btn-ghost" style="font-size:12px">→</span>
      </div>`).join("");
    list.querySelectorAll(".registry-item").forEach((el) => {
      el.addEventListener("click", () => {
        const code = el.dataset.code;
        $("course-code").value = code;
        $("github-url").value = "";
        loadCourse(code, null);
      });
    });
  } else {
    list.innerHTML = `<p class="muted" style="font-size:13px">No courses in catalog yet.</p>`;
  }
}

function initLandingEvents() {
  $("load-course-btn").addEventListener("click", () => {
    const code = $("course-code").value.trim().toLowerCase();
    const url = $("github-url").value.trim();
    if (!code && !url) {
      $("load-error").textContent = "Enter a course code or a GitHub URL";
      return;
    }
    loadCourse(code || null, url || null);
  });
  // Enter key on inputs
  $("course-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("github-url").focus();
  });
  $("github-url").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("load-course-btn").click();
  });
}

// ---------- Level views ----------

function overviewView() {
  const c = state.course;
  const s = state.session;
  const firstOpen = c.levels.find((l) => !(s?.levelProgress?.[l.id]?.completed)) || c.levels[0];
  const completed = Object.values(s?.levelProgress || {}).filter((p) => p.completed).length;
  $("stage").innerHTML = `
    <section class="panel complete">
      <div class="big">${esc(c.meta?.avatar?.emoji || "⚡")}</div>
      <h2>${esc(c.meta?.title || "Course")}</h2>
      <p class="muted">${esc(c.meta?.subtitle || "")}</p>
      <p class="muted">关卡 ${completed}/${c.levels.length} 完成 · 当前 Lv.${s ? s.level : 1}</p>
      ${firstOpen ? `<a class="btn btn-lg" href="#/l/${esc(firstOpen.id)}/watch" style="margin-top:16px;display:inline-block">${firstOpen.emoji} ${esc(firstOpen.title)} →</a>` : ""}
      ${state.token ? `<a class="btn-ghost" href="#/teacher" style="margin-top:12px;display:inline-block;margin-left:12px">📊 教师控制台</a>` : `<a class="btn-ghost" href="#/login" style="margin-top:12px;display:inline-block;margin-left:12px">🔑 教师登录</a>`}
    </section>`;
}

function watchView() {
  const l = state.level;
  const prog = state.session.levelProgress[l.id] || {};
  const hasVideo = l.video && l.video.url;
  $("stage").innerHTML = `
    <section class="panel">
      <h2>${esc(l.emoji)} ${esc(l.title)}</h2>
      <p class="desc">${esc(l.description || "")}</p>
      ${hasVideo ? `<div class="video-frame"><iframe src="${esc(l.video.url)}" title="${esc(l.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
      <p class="video-caption">${esc(l.video.caption || "")}</p>` : ""}
      <div class="stage-actions">
        <a class="btn" href="#/l/${esc(l.id)}/content">继续 →</a>
        ${prog.quizCorrect >= l.quiz.length ? `<span class="muted" style="font-size:13px">✓ 题目已完成 (${prog.quizCorrect}/${l.quiz.length})</span>` : ""}
      </div>
    </section>`;
}

function contentView() {
  // Renders the ordered blocks for this level.
  const l = state.level;
  const blocks = l.blocks || [];
  const hasBlocks = blocks.length > 0;

  if (!hasBlocks) {
    // Fallback: quiz view
    quizView();
    return;
  }

  // Render blocks
  let html = `<section class="panel"><h2>${esc(l.emoji)} ${esc(l.title)}</h2>`;
  for (const block of blocks) {
    switch (block.type) {
      case "scene":
        html += `
          <div class="scene-block">
            <h3>${esc(block.title)}</h3>
            <div class="scene-canvas" id="scene-${esc(block.animation)}"></div>
            <p class="muted" style="font-size:13px;margin-top:6px">${esc(block.caption)}</p>
          </div>`;
        break;
      case "video":
        if (block.url) {
          html += `<div class="video-frame"><iframe src="${esc(block.url)}" title="${esc(block.caption)}" allowfullscreen></iframe></div>`;
          if (block.caption) html += `<p class="video-caption">${esc(block.caption)}</p>`;
        } else {
          html += `<p class="muted">${esc(block.caption || "（视频待添加）")}</p>`;
        }
        break;
      case "mc":
        html += `
          <div class="mc-block" data-level="${esc(l.id)}" data-question="${esc(block.question)}">
            <h3 class="mc-q">${esc(block.question)}</h3>
            <div class="mc-options">${block.options.map((o, j) => `
              <button class="mc-opt" data-j="${j}">${esc(o)}</button>`).join("")}</div>
            <p class="mc-hint" id="hint-${esc(block.question.slice(0, 20))}"></p>
          </div>`;
        break;
      case "poll":
        html += `
          <div class="poll-block" data-question="${esc(block.question)}">
            <h3 class="poll-q">${esc(block.question)}</h3>
            <div class="mc-options">${block.options.map((o, j) => `
              <button class="mc-opt poll-opt" data-j="${j}">${esc(o)}</button>`).join("")}</div>
          </div>`;
        break;
      case "tutor":
        html += `
          <div class="tutor-block">
            <div class="tutor-avatar">💬</div>
            <div class="tutor-content">
              <h3>AI 导师讨论</h3>
              <p class="muted">${esc(block.prompt)}</p>
              <button class="btn tutor-ask-btn" data-prompt="${esc(block.prompt)}">向 AI 导师提问</button>
            </div>
          </div>`;
        break;
      case "code":
        html += `
          <div class="code-block">
            <h3>💻 ${esc(block.title || "代码任务")}</h3>
            <p class="desc">${esc(block.description || "")}</p>
            <textarea class="code-editor" id="block-code-editor" spellcheck="false">${esc(block.starter || "")}</textarea>
            <div class="code-actions">
              <button class="btn" id="block-code-run">▶ 运行</button>
              <button class="btn" id="block-code-submit">📤 提交</button>
            </div>
            <pre class="code-output muted" id="block-code-output"></pre>
          </div>`;
        break;
    }
  }
  html += `</section>`;
  $("stage").innerHTML = html;

  // Load and render animated scenes
  $("stage").querySelectorAll(".scene-canvas").forEach((el) => {
    const animation = el.id.replace("scene-", "");
    import(`/scenes/${animation}.js`)
      .then((m) => m.render(el))
      .catch(() => { el.textContent = `(Scene: ${animation})`; });
  });

  // Attach event listeners
  attachBlockListeners(l.id, blocks);
}

function attachBlockListeners(levelId, blocks) {
  // MC blocks
  $("stage").querySelectorAll(".mc-block").forEach((el) => {
    el.querySelectorAll(".mc-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        el.querySelectorAll(".mc-opt").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });
  });

  // Tutor blocks
  $("stage").querySelectorAll(".tutor-ask-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prompt = btn.dataset.prompt;
      toggleAvatar(true);
      $("avatar-input").value = prompt;
      sendChat();
    });
  });

  // Code blocks
  $("stage").querySelectorAll(".code-block").forEach((block) => {
    const editor = block.querySelector(".code-editor");
    const runBtn = block.querySelector("#block-code-run");
    const subBtn = block.querySelector("#block-code-submit");
    const output = block.querySelector(".code-output");
    const lang = "python3";

    const runCode = async (submit) => {
      const code = editor.value;
      output.textContent = submit ? "Submitting…" : "Running…";
      output.className = "code-output muted";
      const { status, data } = await api.post(`/api/course/${encodeURIComponent(levelId)}/code/${submit ? "submit" : "run"}`, {
        code, language: lang,
        hash: state.session?.hash,
        sessionCode: state.sessionCode || undefined,
      });
      if (status !== 200) { output.className = "code-output err"; output.textContent = data.error; return; }
      if (submit) {
        const r = data.run;
        output.className = r.passed ? "code-output ok" : "code-output err";
        output.textContent = r.passed
          ? `✅ +10 XP\n${r.stdout}`
          : `❌ 报错: ${r.stderr || r.stdout}`;
        if (data.session) updateSessionOnly(data.session);
      } else {
        output.className = data.code === 0 ? "code-output ok" : "code-output err";
        output.textContent = `$ exit ${data.code}\n${data.stdout}${data.stderr ? "\n" + data.stderr : ""}`;
      }
    };

    runBtn?.addEventListener("click", () => runCode(false));
    subBtn?.addEventListener("click", () => runCode(true));
  });
}

function quizView() {
  const l = state.level;
  state.quizAnswers = new Array(l.quiz.length).fill(null);
  state.quizLocked = false;
  $("stage").innerHTML = `
    <section class="panel">
      <h2>${esc(l.emoji)} ${esc(l.title)}</h2>
      <p class="desc">回答全部题目后提交。全对才可通过。</p>
      <div id="quiz-list">${l.quiz.map((q, i) => `
        <div class="quiz-q" data-q="${i}">
          <h3>Q${i + 1}. ${esc(q.question)}</h3>
          <div class="options">${q.options.map((o, j) => `
            <button class="option" data-i="${i}" data-j="${j}">${esc(o)}</button>`).join("")}</div>
          <p class="hint" data-role="hint"></p>
        </div>`).join("")}</div>
      <div class="stage-actions">
        <a href="#/l/${esc(l.id)}/watch" class="btn-ghost">← 返回</a>
        <button class="btn" id="quiz-submit">提交答案</button>
      </div>
      <p class="quiz-result" id="quiz-result"></p>
    </section>`;

  $("stage").querySelectorAll(".option").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.quizLocked) return;
      const i = Number(btn.dataset.i);
      state.quizAnswers[i] = Number(btn.dataset.j);
      $("stage").querySelectorAll(`.option[data-i="${i}"]`).forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });
  $("quiz-submit").addEventListener("click", submitQuiz);
}

async function submitQuiz() {
  const l = state.level;
  const btn = $("quiz-submit");
  btn.disabled = true;
  const { status, data } = await api.post(`/api/course/${encodeURIComponent(l.id)}/quiz`, {
    answers: state.quizAnswers,
    hash: state.session?.hash,
    sessionCode: state.sessionCode || undefined,
  });
  btn.disabled = false;
  if (status !== 200) { $("quiz-result").textContent = data.error; return; }
  state.quizLocked = true;
  data.correct.forEach((ok, i) => {
    const qEl = $("stage").querySelector(`.quiz-q[data-q="${i}"]`);
    const chosen = state.quizAnswers[i];
    qEl.querySelectorAll(".option").forEach((b) => {
      b.disabled = true;
      if (Number(b.dataset.j) === chosen) b.classList.add(ok ? "right" : "wrong");
    });
    qEl.querySelector('[data-role="hint"]').textContent = ok ? "✓" : `提示: ${l.quiz[i].hint}`;
  });
  $("quiz-result").innerHTML = `得分 ${data.score}/${data.total} · ${data.passed ? "🎉 通过！" : ""} +${data.xpEarned} XP`;
  if (data.session) updateSessionOnly(data.session);
}

function codeView() {
  const l = state.level;
  if (!l.code) { $("stage").innerHTML = `<section class="panel"><p class="muted">无代码任务。</p></section>`; return; }
  state.code = l.code.starter;
  $("stage").innerHTML = `
    <section class="panel">
      <h2>${esc(l.emoji)} ${esc(l.title)} <span class="code-lang">${esc(l.code.language)}</span></h2>
      <p class="desc">${esc(l.code.description)}</p>
      <textarea class="code-editor" id="code-editor" spellcheck="false">${esc(state.code)}</textarea>
      <div class="code-actions">
        <a href="#/l/${esc(l.id)}/content" class="btn-ghost">← 返回</a>
        <button class="btn" id="code-run">▶ 运行</button>
        <button class="btn" id="code-submit">📤 提交</button>
      </div>
      <pre class="code-output muted" id="code-output"></pre>
    </section>`;
  $("code-editor").addEventListener("input", (e) => (state.code = e.target.value));
  $("code-run").addEventListener("click", async () => {
    const out = $("code-output");
    out.textContent = "Running…"; out.className = "code-output muted";
    const { status, data } = await api.post(`/api/course/${encodeURIComponent(l.id)}/code/run`, { code: state.code, language: l.code.language });
    if (status !== 200) { out.className = "code-output err"; out.textContent = data.error; return; }
    out.className = data.code === 0 ? "code-output ok" : "code-output err";
    out.textContent = `$ exit ${data.code}\n${data.stdout}${data.stderr ? "\n" + data.stderr : ""}`;
  });
  $("code-submit").addEventListener("click", async () => {
    const out = $("code-output");
    out.textContent = "Submitting…"; out.className = "code-output muted";
    const { status, data } = await api.post(`/api/course/${encodeURIComponent(l.id)}/code/submit`, {
      code: state.code, language: l.code.language, hash: state.session?.hash, sessionCode: state.sessionCode || undefined,
    });
    if (status !== 200) { out.className = "code-output err"; out.textContent = data.error; return; }
    const r = data.run;
    out.className = r.passed ? "code-output ok" : "code-output err";
    out.textContent = r.passed ? `✅ +10 XP\n${r.stdout}` : `❌ ${r.stderr || r.stdout}`;
    if (data.session) updateSessionOnly(data.session);
  });
}

// ---------- Router ----------

let loadingLevel = null;
async function loadLevel(levelId, view) {
  state.level = { id: levelId };
  renderHud();
  if (loadingLevel === levelId) return;
  loadingLevel = levelId;
  const { data } = await api.get(`/api/course/${encodeURIComponent(levelId)}`);
  loadingLevel = null;
  if (!data.level) { $("stage").innerHTML = `<p class="muted center">Level not found.</p>`; return; }
  state.level = data.level;
  renderHud();
  if (view === "content") contentView();
  else if (view === "quiz") quizView();
  else if (view === "code") codeView();
  else watchView();
}

function renderStage() {
  if (!state.course) return;
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/l\/([^/]+)\/(watch|content|quiz|code)$/);
  if (m) {
    const level = state.course.levels.find((x) => x.id === decodeURIComponent(m[1]));
    if (!level) { $("stage").innerHTML = `<p class="muted center">Level not found.</p>`; return; }
    loadLevel(level.id, m[2]);
    return;
  }
  overviewView();
}

// ========== TEACHER PAGES ==========

function loginView() {
  const savedToken = localStorage.getItem("nexus_teacher_token");
  if (savedToken) { state.token = savedToken; teacherView(); return; }
  $("stage").classList.remove("hidden");
  $("landing").classList.add("hidden");
  $("app-hud").classList.add("hidden");
  $("avatar-wrap").classList.add("hidden");
  $("app-footer").classList.add("hidden");
  $("stage").innerHTML = `
    <section class="panel" style="max-width:420px;margin:0 auto">
      <h2>🔑 教师登录</h2>
      <form id="login-form" style="margin-top:16px;display:flex;flex-direction:column;gap:12px">
        <input type="password" id="login-password" placeholder="教师密码" style="padding:12px;font-size:16px;border:1px solid var(--border);border-radius:8px;background:var(--panel-2);color:var(--fg)"/>
        <button class="btn" type="submit" style="width:100%">登录</button>
        <p id="login-msg" class="muted"></p>
      </form>
      <a href="#/" class="btn-ghost" style="margin-top:12px;display:inline-block">← 返回首页</a>
    </section>`;
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("login-password").value.trim();
    const { status, data } = await api.post("/api/teacher/login", { password: pw });
    if (status !== 200) { $("login-msg").textContent = data.error || "登录失败"; return; }
    state.token = data.token;
    localStorage.setItem("nexus_teacher_token", data.token);
    teacherView();
  });
}

function teacherView() {
  if (!state.token) { loginView(); return; }
  if (state.teacherTimer) { clearInterval(state.teacherTimer); state.teacherTimer = null; }
  $("stage").classList.remove("hidden");
  $("landing").classList.add("hidden");
  $("app-hud").classList.add("hidden");
  $("avatar-wrap").classList.add("hidden");
  $("app-footer").classList.add("hidden");

  $("stage").innerHTML = `
    <section class="panel" style="max-width:800px;margin:0 auto">
      <h2>📊 教师控制台</h2>

      <div class="teacher-card">
        <h3>📚 课程注册表</h3>
        <div id="reg-list" class="muted">加载中…</div>
        <form id="reg-form" style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <input id="reg-code" placeholder="课程代码 (e.g. ati271b)" />
          <input id="reg-title" placeholder="课程名称" />
          <input id="reg-desc" placeholder="描述" style="grid-column:1/-1" />
          <input id="reg-url" placeholder="GitHub Raw URL (可选)" style="grid-column:1/-1" />
          <button class="btn" type="submit" style="grid-column:1/-1">添加 / 更新</button>
        </form>
        <p id="reg-msg" class="muted" style="margin-top:6px"></p>
      </div>

      <div class="teacher-card">
        <h3>📱 课堂会话</h3>
        <div id="t-session-null"><button class="btn btn-lg" id="t-create-session">开始新课堂</button></div>
        <div id="t-session-active" class="hidden">
          <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:start">
            <div style="text-align:center;min-width:140px">
              <div id="t-qr" style="background:#fff;border-radius:8px;padding:8px;display:inline-block"></div>
              <p style="font-size:28px;letter-spacing:4px;font-weight:700;color:var(--gold);margin:8px 0" id="t-pin"></p>
              <p class="muted" style="font-size:12px" id="t-join-url"></p>
            </div>
            <div style="flex:1;min-width:200px">
              <p><span id="t-joined-total">0</span> 加入 · <span id="t-joined-30m">0</span> 过去30分钟 · <span id="t-active-now">0</span> 在线</p>
              <hr style="border-color:var(--border);margin:8px 0"/>
              <div id="t-level-stats"></div>
              <hr style="border-color:var(--border);margin:8px 0"/>
              <h4 style="margin:4px 0">🏆 排行榜</h4>
              <div id="t-leaderboard"></div>
              <hr style="border-color:var(--border);margin:8px 0"/>
              <h4 style="margin:4px 0">👥 已加入</h4>
              <div id="t-joined-list" style="font-size:13px;max-height:180px;overflow-y:auto"></div>
              <hr style="border-color:var(--border);margin:8px 0"/>
              <h4 style="margin:4px 0">📝 最近事件</h4>
              <div id="t-events" style="font-size:12px;max-height:130px;overflow-y:auto"></div>
              <p style="margin-top:12px">
                <button class="btn-ghost" id="t-close-session">结束课堂</button>
                <button class="btn-ghost" id="t-refresh-now">🔄 刷新</button>
              </p>
            </div>
          </div>
        </div>
      </div>

      <a href="#/" class="btn-ghost">← 返回首页</a>
    </section>`;

  loadRegList();
  $("reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("reg-msg");
    const entry = {
      code: $("reg-code").value.trim().toLowerCase(),
      title: $("reg-title").value.trim(),
      description: $("reg-desc").value.trim(),
      githubUrl: $("reg-url").value.trim(),
    };
    if (!entry.code) { msg.textContent = "课程代码必填"; return; }
    const { status, data } = await api.postAuth("/api/teacher/registry", entry);
    if (status !== 200) { msg.textContent = data.error || "Failed"; return; }
    msg.textContent = `✅ 已保存: ${entry.title}`;
    $("reg-code").value = ""; $("reg-title").value = ""; $("reg-desc").value = ""; $("reg-url").value = "";
    loadRegList();
  });

  $("t-create-session").addEventListener("click", async () => {
    const { status, data } = await api.postAuth("/api/teacher/session", {});
    if (status !== 201) { alert(data.error || "Failed"); return; }
    startSessionDisplay(data);
  });
}

async function loadRegList() {
  const el = $("reg-list");
  if (!el) return;
  const { status, data } = await api.getAuth("/api/teacher/registry");
  if (status !== 200) { el.innerHTML = `<p class="muted">加载失败</p>`; return; }
  const current = data.currentCourse;
  el.innerHTML = data.courses.map((c) => `
    <div class="registry-item" style="margin-bottom:4px">
      <div>
        <div class="registry-item-title">${esc(c.title)} <span style="color:var(--muted);font-size:12px">[${esc(c.code)}]</span></div>
        <div class="registry-item-desc">${esc(c.description)}</div>
        ${current?.code === c.code ? `<span style="color:var(--ok);font-size:12px"> · 当前加载</span>` : ""}
      </div>
      <button class="btn-ghost reg-del" data-code="${esc(c.code)}" style="font-size:11px;color:var(--bad)">删除</button>
    </div>`).join("") || `<p class="muted">无课程</p>`;
  el.querySelectorAll(".reg-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`删除课程 ${btn.dataset.code}?`)) return;
      await api.deleteAuth(`/api/teacher/registry/${btn.dataset.code}`);
      loadRegList();
    });
  });
}

function startSessionDisplay(data) {
  $("t-session-null").classList.add("hidden");
  $("t-session-active").classList.remove("hidden");
  const code = data.code;
  $("t-pin").textContent = code;
  $("t-join-url").innerHTML = `<a href="${esc(data.joinUrl)}" target="_blank">打开加入页</a>`;
  $("t-qr").innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data.joinUrl)}" alt="QR" style="width:160px;height:160px;border-radius:4px"/>`;
  if (state.teacherTimer) clearInterval(state.teacherTimer);
  const poll = async () => {
    const { status, data } = await api.get(`/api/session/${code}/stats`);
    if (status !== 200) return;
    renderStats(data.stats);
  };
  poll();
  state.teacherTimer = setInterval(poll, 5000);
  $("t-close-session")?.addEventListener("click", async () => {
    if (!confirm("结束这个课堂？")) return;
    await api.postAuth(`/api/session/${code}/close`, {});
    clearInterval(state.teacherTimer); state.teacherTimer = null;
    $("t-session-active").classList.add("hidden");
    $("t-session-null").classList.remove("hidden");
  });
  $("t-refresh-now")?.addEventListener("click", poll);
}

function renderStats(stats) {
  $("t-joined-total").textContent = stats.joinedTotal;
  $("t-joined-30m").textContent = stats.joinedLast30m;
  $("t-active-now").textContent = stats.activeNow;
  $("t-level-stats").innerHTML = stats.levels.length
    ? stats.levels.map((l) => `<p style="font-size:13px;margin:2px 0"><strong>${esc(l.levelId)}</strong>: ${l.answerCount} 人答题 · 正确率 ${(l.correctRate * 100).toFixed(0)}%</p>`).join("")
    : `<p class="muted" style="font-size:13px">暂无答题数据</p>`;
  $("t-leaderboard").innerHTML = stats.leaderboard.length
    ? stats.leaderboard.slice(0, 5).map((e, i) => `<p style="font-size:13px;margin:2px 0">${i + 1}. ${esc(e.codename)} — ${e.score} 分</p>`).join("")
    : `<p class="muted" style="font-size:13px">暂无</p>`;
  $("t-joined-list").innerHTML = stats.joinedList.slice(-20).map((j) => {
    const dot = j.isOnline ? "🟢" : "⚪";
    return `<p style="margin:2px 0">${dot} ${esc(j.codename)} (答题 ${j.answers.length})</p>`;
  }).join("") || `<p class="muted" style="font-size:13px">无</p>`;
  $("t-events").innerHTML = stats.recentEvents.slice(-15).reverse().map((e) => {
    const icon = e.type === "join" ? "🟢" : e.type === "answer" ? "📝" : "💻";
    return `<p style="margin:1px 0">${icon} ${esc(e.codename)} ${esc(e.detail)}</p>`;
  }).join("") || `<p class="muted" style="font-size:12px">无</p>`;
}

// ---------- Join page ----------

function joinView(code) {
  state.sessionCode = code;
  localStorage.setItem("nexus_session_code", code);
  $("stage").classList.remove("hidden");
  $("landing").classList.add("hidden");
  $("app-hud").classList.add("hidden");
  $("avatar-wrap").classList.add("hidden");
  $("app-footer").classList.add("hidden");
  $("stage").innerHTML = `
    <section class="panel" style="max-width:500px;margin:0 auto;text-align:center">
      <h2>📱 加入课堂</h2>
      <p class="muted">课堂代码: <strong style="font-size:24px;color:var(--gold);letter-spacing:4px">${esc(code)}</strong></p>
      <p id="j-status" class="muted">正在加入…</p>
      <div id="j-detail" class="hidden" style="text-align:left;margin-top:12px">
        <h4>你的进度</h4>
        <p id="j-answers" class="muted">暂无答题记录</p>
      </div>
      <a href="#/" class="btn" style="margin-top:16px">← 返回首页</a>
    </section>`;
  (async () => {
    if (!state.session) await ensureSession();
    const { status, data } = await api.post(`/api/session/${code}/join`, {
      hash: state.session.hash,
      codename: state.session.codename,
    });
    if (status !== 200) { $("j-status").textContent = `❌ 加入失败: ${data.error}`; return; }
    $("j-status").textContent = `✅ 已加入 — ${esc(data.codename)}`;
    $("j-status").style.color = "var(--ok)";
    startHeartbeat(code);
    renderJoinProgress(code);
  })();
}

let heartbeatTimer = null;
function startHeartbeat(code) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!state.session || !code) return;
    api.post(`/api/session/${code}/heartbeat`, { hash: state.session.hash }).catch(() => {});
  }, 30000);
}

async function renderJoinProgress(code) {
  const { status, data } = await api.get(`/api/session/${code}/stats`);
  if (status !== 200) return;
  const me = data.stats.joinedList.find((j) => j.hash === state.session?.hash);
  if (!me) return;
  $("j-answers").innerHTML = me.answers.length
    ? me.answers.map((a) => `<p>${esc(a.levelId)}: ${a.score}/${a.total}</p>`).join("")
    : "尚未答题";
  $("j-detail").classList.remove("hidden");
}

// ========== PAGE ROUTER ==========

function pageRouter() {
  const hash = location.hash || "#/";
  if (hash === "#/" || hash === "#") {
    // Always show landing page at root — course restoration only happens via /course/:code
    showLanding();
    landingView();
    return;
  }
  if (hash.startsWith("#/login")) { loginView(); return; }
  if (hash.startsWith("#/teacher")) { teacherView(); return; }
  const jm = hash.match(/^#\/join\/(\d{6})$/);
  if (jm) { joinView(jm[1]); return; }
  // /course/:code — load course then redirect to overview
  const cm = hash.match(/^#\/course\/(.+)$/);
  if (cm) {
    const code = decodeURIComponent(cm[1]);
    if (state.course && (state.course.id === code || state.course.meta?.id === code)) {
      showApp(); overviewView();
    } else if (!bootDone) {
      // boot() is still running — don't interfere
    } else {
      showLanding();
      loadCourse(code, null);
    }
    return;
  }
  if (!state.course) { location.hash = "#/"; return; }
  renderStage();
}

// ========== AVATAR CHAT ==========

const chat = [];
let avatarOpen = false;

function say(text) {
  if (!$("tts-toggle")?.checked) return;
  const lang = (state.course?.meta?.language || "en") === "zh" ? "zh-CN" : "en-US";
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = 1.05;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    $("avatar-btn")?.classList.add("speaking");
    u.onend = () => $("avatar-btn")?.classList.remove("speaking");
    return;
  }
  new Audio(`/api/tts?text=${encodeURIComponent(text.slice(0, 200))}&lang=${lang}`).play().catch(() => {});
}

function renderChat() {
  const el = $("avatar-chat");
  el.innerHTML = chat.map((m) =>
    `<div class="msg ${m.role}">${esc(m.content)}${m.cached ? `<span class="cache-tag">⚡ ×${m.cached}</span>` : ""}</div>`
  ).join("");
  el.scrollTop = el.scrollHeight;
}

async function sendChat() {
  const input = $("avatar-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  chat.push({ role: "user", content: text });
  renderChat();
  chat.push({ role: "bot", content: "…" });
  renderChat();
  const { status, data } = await api.post("/api/chat", {
    messages: chat.filter((m) => m.content !== "…").map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.content })),
    levelId: state.level?.id || "",
    hash: state.session?.hash,
  });
  chat.pop();
  if (status !== 200) {
    chat.push({ role: "bot", content: data.error || "Chat failed." });
  } else {
    chat.push({ role: "bot", content: data.reply, cached: data.cached ? data.cacheHits : 0 });
    say(data.reply);
  }
  renderChat();
}

function toggleAvatar(open) {
  avatarOpen = open;
  $("avatar-panel")?.classList.toggle("hidden", !open);
  if (open && !chat.length) {
    chat.push({
      role: "bot",
      content: `Hi! I'm ${state.course?.meta?.avatar?.name || "Nova"} 🪐. Ask me anything about this course.`,
    });
    renderChat();
  }
}

// ---------- Modals ----------

async function openGuides() {
  const { data } = await api.get("/api/guides?limit=10");
  $("guides-list").innerHTML = data.guides?.length
    ? data.guides.map((g) => `<div class="guide-card"><div class="q">${esc(g.question)}</div><div class="a">${esc(g.answer)}</div><span class="hits">⚡ 被 ${g.hits} 位同学命中</span></div>`).join("")
    : `<p class="muted">还没有攻略。</p>`;
  $("guides-modal")?.classList.remove("hidden");
}

// ========== BOOT ==========

async function boot() {
  await ensureSession();
  const savedToken = localStorage.getItem("nexus_teacher_token");
  if (savedToken) state.token = savedToken;
  const savedCode = localStorage.getItem("nexus_session_code");
  if (savedCode) {
    const { status } = await api.get(`/api/session/${savedCode}/stats`);
    if (status === 200) { state.sessionCode = savedCode; startHeartbeat(savedCode); }
    else localStorage.removeItem("nexus_session_code");
  }
  // Handle /course/:code from URL hash (bookmark/share links)
  const hash = location.hash || "#/";
  const cm = hash.match(/^#\/course\/(.+)$/);
  if (cm) {
    const code = decodeURIComponent(cm[1]);
    const { status, data } = await api.post("/api/course/load", { code });
    if (status === 200) {
      state.course = data.course;
      document.title = `${data.course.title} — Nexus`;
      localStorage.setItem("nexus_last_course", JSON.stringify({ code }));
      showApp();
      renderHud();
      renderStage();
      console.log("[boot] /course/ loaded OK:", code, data.course.id);
      bootDone = true;   // unblock pageRouter
      return;
    }
    console.warn("[boot] /course/ load failed:", status, data.error);
    // Fall through to landing on error
  }
  // No auto-restore from localStorage — users enter via landing or /course/:code bookmark
  showLanding();
  landingView();
  bootDone = true;   // unblock pageRouter
}

// Events — pageRouter must run AFTER boot() has had a chance to set state
// Use a flag so pageRouter defers to boot on initial load
let bootDone = false;
window.addEventListener("hashchange", () => {
  if (!bootDone) return;   // defer until boot finishes
  pageRouter();
});

// In boot(), set bootDone = true at the very end:
// (add at the end of every return/break in boot)
$("avatar-btn")?.addEventListener("click", () => toggleAvatar(!avatarOpen));
$("avatar-close")?.addEventListener("click", () => toggleAvatar(false));
$("avatar-form")?.addEventListener("submit", (e) => { e.preventDefault(); sendChat(); });
$("btn-guides")?.addEventListener("click", openGuides);
$("guides-close")?.addEventListener("click", () => $("guides-modal")?.classList.add("hidden"));
$("codename")?.addEventListener("click", () => {
  $("recover-input").value = state.session?.hash || "";
  $("recover-msg").textContent = "";
  $("recover-modal")?.classList.remove("hidden");
});
$("recover-cancel")?.addEventListener("click", () => $("recover-modal")?.classList.add("hidden"));
$("recover-go")?.addEventListener("click", async () => {
  const hash = $("recover-input").value.trim();
  if (!hash) return;
  const { status, data } = await api.get(`/api/session/${encodeURIComponent(hash)}`);
  if (status !== 200) { $("recover-msg").textContent = data.error || "Not found."; return; }
  setSession(data.session);
  $("recover-modal")?.classList.add("hidden");
});

// Init landing events
initLandingEvents();
boot();
