const BANK = window.QUESTION_BANK || [];
const STORAGE = {
  users: "szzq_static_users_v1",
  session: "szzq_static_session_v1",
  userData: (username) => `szzq_static_data_v1_${username}`,
  practice: (username) => `szzq_static_practice_v2_${username}`,
};

const state = {
  user: null,
  authTab: "login",
  view: "dashboard",
  error: "",
  chapters: [],
  quiz: null,
  practiceMode: "chapter",
  randomSource: "all",
  practiceCount: 10,
  customPracticeCount: null,
  favoriteOnly: false,
  selectedChapters: new Set(["0"]),
  insightText: "",
  noteEditorId: null,
  toast: "",
};

let toastTimer = null;

const nav = [
  ["dashboard", "首页看板"],
  ["practice", "刷题训练"],
  ["review", "今日复习"],
  ["wrongbook", "错题本"],
  ["favorites", "我的收藏"],
  ["stats", "学习统计"],
  ["insights", "考点提炼"],
  ["admin", "本地管理"],
];

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function makePassword(password, salt = crypto.randomUUID()) {
  return { salt, hash: await sha256(`${salt}:${password}`) };
}

function users() {
  return readJson(STORAGE.users, []);
}

function saveUsers(items) {
  writeJson(STORAGE.users, items);
}

function userData(username = state.user?.username) {
  const data = readJson(STORAGE.userData(username), {
    records: [],
    states: {},
    favorites: [],
    notes: {},
  });
  return migrateUserData(data, username);
}

function saveUserData(data, username = state.user?.username) {
  writeJson(STORAGE.userData(username), data);
}

function normalizeFavorites(items) {
  const seen = new Set();
  return (items || [])
    .map((item) => {
      const questionId = String(typeof item === "object" ? item.questionId : item);
      const createdAt = typeof item === "object" && item.createdAt ? item.createdAt : new Date().toISOString();
      return { questionId, createdAt };
    })
    .filter((item) => {
      const id = Number(item.questionId);
      if (!id || seen.has(id) || !questionById(id)) return false;
      seen.add(id);
      return true;
    });
}

function favoriteSet(data = userData()) {
  return new Set(normalizeFavorites(data.favorites).map((item) => Number(item.questionId)));
}

function favoriteEntry(questionId) {
  return normalizeFavorites(userData().favorites).find((item) => Number(item.questionId) === Number(questionId)) || null;
}

function isFavorited(questionId) {
  return favoriteSet().has(Number(questionId));
}

function favoriteQuestions() {
  const data = userData();
  return normalizeFavorites(data.favorites)
    .map((item) => ({ ...questionById(item.questionId), favoriteCreatedAt: item.createdAt }))
    .filter((q) => q.id)
    .sort((a, b) => a.chapterId - b.chapterId || a.id - b.id);
}

function toggleFavorite(questionId) {
  const data = userData();
  const items = normalizeFavorites(data.favorites);
  const index = items.findIndex((item) => Number(item.questionId) === Number(questionId));
  let message = "已收藏";
  if (index >= 0) {
    items.splice(index, 1);
    message = "取消收藏";
  } else {
    items.push({ questionId: String(questionId), createdAt: new Date().toISOString() });
  }
  data.favorites = items;
  saveUserData(data);
  showToast(message);
}

function clearAllFavorites() {
  if (!confirm("确认批量取消全部收藏题目？")) return;
  const data = userData();
  data.favorites = [];
  saveUserData(data);
  showToast("已取消全部收藏");
}

function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 1600);
}

function questionNote(questionId) {
  return userData().notes?.[String(questionId)] || null;
}

function noteText(questionId) {
  return questionNote(questionId)?.note || "";
}

function openNoteEditor(questionId) {
  state.noteEditorId = Number(questionId);
  render();
}

function cancelNoteEditor() {
  state.noteEditorId = null;
  render();
}

function saveQuestionNote(questionId) {
  const input = document.getElementById(`note-editor-${questionId}`);
  const note = (input?.value || "").trim();
  if (note.length > 500) return showError("备注最多 500 字。");
  const data = userData();
  data.notes ||= {};
  if (note) {
    data.notes[String(questionId)] = {
      questionId: String(questionId),
      note,
      updateTime: new Date().toISOString(),
    };
  } else {
    delete data.notes[String(questionId)];
  }
  saveUserData(data);
  state.noteEditorId = null;
  state.error = "";
  render();
}

function deleteQuestionNote(questionId) {
  const data = userData();
  data.notes ||= {};
  delete data.notes[String(questionId)];
  saveUserData(data);
  state.noteEditorId = null;
  state.error = "";
  render();
}

function migrateUserData(data, username = state.user?.username) {
  data.records ||= [];
  data.states ||= {};
  data.favorites ||= [];
  data.notes ||= {};
  let changed = false;
  const normalizedFavorites = normalizeFavorites(data.favorites);
  if (JSON.stringify(data.favorites) !== JSON.stringify(normalizedFavorites)) {
    data.favorites = normalizedFavorites;
    changed = true;
  }
  const corrected = questionById(380);
  if (corrected) {
    data.records.forEach((record) => {
      if (Number(record.questionId) !== 380) return;
      const correct = selectedArray(record.selected).join(",") === corrected.answerLetters.join(",");
      if (record.correct !== correct) {
        record.correct = correct;
        changed = true;
      }
    });
    if (changed) recomputeQuestionState(data, 380);
  }
  if (changed && username) saveUserData(data, username);
  return data;
}

function savePracticeState() {
  if (!state.user) return;
  writeJson(STORAGE.practice(state.user.username), {
    practiceMode: state.practiceMode,
    randomSource: state.randomSource,
    practiceCount: state.practiceCount,
    customPracticeCount: state.customPracticeCount,
    favoriteOnly: state.favoriteOnly,
    selectedChapters: [...state.selectedChapters],
    quiz: state.quiz,
    insightText: state.insightText,
  });
}

function loadPracticeState(username = state.user?.username) {
  if (!username) return;
  const saved = readJson(STORAGE.practice(username), null);
  if (!saved) return;
  if (saved.practiceMode) state.practiceMode = saved.practiceMode;
  if (saved.randomSource === "unanswered") state.randomSource = "unanswered";
  if (saved.practiceCount) state.practiceCount = saved.practiceCount;
  state.customPracticeCount = Number.isInteger(saved.customPracticeCount) && saved.customPracticeCount > 0 ? saved.customPracticeCount : null;
  state.favoriteOnly = Boolean(saved.favoriteOnly);
  if (Array.isArray(saved.selectedChapters)) {
    state.selectedChapters = new Set(saved.selectedChapters.map(String));
  }
  state.quiz = saved.quiz || null;
  state.insightText = saved.insightText || "";
  restoreQuizStep();
}

function selectedArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String).sort();
  if (typeof value === "string" && value.includes(",")) return value.split(",").map((x) => x.trim()).filter(Boolean).sort();
  return [value].filter(Boolean).map(String).sort();
}

function emptySelection(q) {
  return q?.type === "multiple" ? [] : "";
}

function selectionForQuestion(q, value) {
  const values = selectedArray(value);
  return q?.type === "multiple" ? values : values[0] || "";
}

function ensureQuizState() {
  if (!state.quiz) return null;
  if (!state.quiz.answerStates || Array.isArray(state.quiz.answerStates)) state.quiz.answerStates = {};
  if (!Number.isInteger(state.quiz.index)) state.quiz.index = 0;
  const q = state.quiz.questions?.[state.quiz.index];
  if (!q) return null;
  const key = String(state.quiz.index);
  if (state.quiz.answerStates[key]?.questionId != null && Number(state.quiz.answerStates[key].questionId) !== Number(q.id)) {
    delete state.quiz.answerStates[key];
  }
  if (!state.quiz.answerStates[key]) {
    const hasSavedStep = Object.keys(state.quiz.answerStates).length > 0;
    state.quiz.answerStates[key] = {
      questionId: q.id,
      selected: hasSavedStep ? emptySelection(q) : selectionForQuestion(q, state.quiz.selected ?? emptySelection(q)),
      feedback: hasSavedStep ? null : state.quiz.feedback || null,
      insightText: hasSavedStep ? "" : state.insightText || "",
    };
  }
  return state.quiz.answerStates[key];
}

function restoreQuizStep() {
  const current = ensureQuizState();
  if (!current) return;
  const q = state.quiz.questions[state.quiz.index];
  state.quiz.selected = selectionForQuestion(q, current.selected ?? emptySelection(q));
  state.quiz.feedback = current.feedback || null;
  state.insightText = current.insightText || "";
}

function saveCurrentQuizStep(patch = {}) {
  const current = ensureQuizState();
  if (!current) return;
  const q = state.quiz.questions[state.quiz.index];
  const next = { ...current, ...patch };
  next.questionId = q.id;
  next.selected = selectionForQuestion(q, next.selected ?? state.quiz.selected ?? emptySelection(q));
  state.quiz.answerStates[String(state.quiz.index)] = next;
}

function init() {
  state.chapters = [...new Map(BANK.map((q) => [q.chapterId, q.chapter])).entries()].map(([id, title]) => ({
    id,
    title,
    question_count: BANK.filter((q) => q.chapterId === id).length,
  }));
  const session = readJson(STORAGE.session, null);
  if (session && users().some((u) => u.username === session.username)) {
    state.user = { username: session.username, isAdmin: session.username === "admin" };
    loadPracticeState(session.username);
  }
  render();
}

function stats() {
  const data = userData();
  const total = data.records.length;
  const correct = data.records.filter((r) => r.correct).length;
  const wrongIds = Object.entries(data.states).filter(([, s]) => s.wrongCount > 0).map(([id]) => Number(id));
  const now = Date.now();
  const due = wrongIds
    .filter((id) => !data.states[id]?.masteredAt)
    .sort((a, b) => reviewSortKey(data, a, now) - reviewSortKey(data, b, now));
  const byChapter = state.chapters.map((c) => {
    const ids = new Set(BANK.filter((q) => q.chapterId === c.id).map((q) => q.id));
    const records = data.records.filter((r) => ids.has(r.questionId));
    return {
      ...c,
      attempts: records.length,
      accuracy: records.length ? records.filter((r) => r.correct).length / records.length : 0,
    };
  });
  const topWrong = wrongIds
    .map((id) => ({ ...questionById(id), wrong_count: data.states[id].wrongCount }))
    .sort((a, b) => b.wrong_count - a.wrong_count)
    .slice(0, 20);
  return {
    global: {
      total_answers: total,
      accuracy: total ? correct / total : 0,
      wrong_question_count: wrongIds.length,
      average_error_rate: total ? 1 - correct / total : 0,
      due_count: due.length,
    },
    chapters: byChapter,
    top_wrong: topWrong,
    dueQuestions: due.map(questionById).filter(Boolean),
    wrongbook: wrongIds.map((id) => ({ ...questionById(id), ...data.states[id] })).sort((a, b) => b.wrongCount - a.wrongCount),
  };
}

function lastRecordFor(data, questionId) {
  return data.records
    .filter((r) => Number(r.questionId) === Number(questionId))
    .sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt))
    .at(-1);
}

function reviewSortKey(data, questionId, now = Date.now()) {
  const s = data.states[questionId] || {};
  const last = lastRecordFor(data, questionId);
  const nextTime = s.nextReviewAt ? new Date(s.nextReviewAt).getTime() : Number.POSITIVE_INFINITY;
  const lastTime = last?.answeredAt ? new Date(last.answeredAt).getTime() : 0;
  if (last && !last.correct) return -2_000_000_000_000 - lastTime;
  if (nextTime <= now) return -1_000_000_000_000 + nextTime;
  return nextTime;
}

function questionById(id) {
  return BANK.find((q) => q.id === Number(id));
}

function pct(v) {
  return `${Math.round((Number(v) || 0) * 100)}%`;
}

function dateText(value) {
  if (!value) return "无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function render() {
  document.getElementById("app").innerHTML = state.user ? renderApp() : renderAuth();
}

function renderAuth() {
  return `
    <div class="auth-shell">
      <div class="auth-box">
        <section class="auth-copy">
          <h1>思政个性化刷题系统</h1>
          <p>GitHub Pages 公开版已内置导论至第十七章 384 道题。账号和学习数据保存在当前浏览器本地，不上传服务器。</p>
          <ul><li>章节专项、随机、错题、今日复习</li><li>艾宾浩斯排期与错题统计</li><li>错题考点背诵话术</li></ul>
        </section>
        <section class="auth-form">
          <div class="tabs">
            <button class="tab ${state.authTab === "login" ? "active" : ""}" onclick="state.authTab='login';state.error='';render()">登录</button>
            <button class="tab ${state.authTab === "register" ? "active" : ""}" onclick="state.authTab='register';state.error='';render()">注册</button>
          </div>
          ${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}
          <div class="field"><label>用户名</label><input id="username" autocomplete="username"></div>
          <div class="field"><label>密码</label><input id="password" type="password" autocomplete="current-password"></div>
          <button class="btn" style="width:100%" onclick="submitAuth()">${state.authTab === "login" ? "登录" : "注册并登录"}</button>
          <p class="hint">公开静态版没有后端数据库，适合个人浏览器使用；清空浏览器数据会删除本机学习记录。</p>
        </section>
      </div>
    </div>`;
}

function renderApp() {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><h1>思政刷题系统</h1><p>GitHub Pages 静态公开版</p></div>
        <div class="nav">${nav.map(([k, label]) => `<button class="${state.view === k ? "active" : ""}" onclick="go('${k}')">${label}</button>`).join("")}</div>
        <div class="userbar">
          <strong>${esc(state.user.username)}</strong>${state.user.isAdmin ? " · 本地管理员" : ""}
          <div class="hint">学习数据仅保存在此浏览器。</div>
          <button class="btn secondary" style="margin-top:10px;width:100%" onclick="logout()">退出登录</button>
        </div>
      </aside>
      <main class="main">${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}${renderView()}${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}</main>
    </div>`;
}

function renderView() {
  if (state.view === "practice") return renderPractice();
  if (state.view === "review") return renderReview();
  if (state.view === "wrongbook") return renderWrongbook();
  if (state.view === "favorites") return renderFavorites();
  if (state.view === "stats") return renderStats();
  if (state.view === "insights") return renderInsights();
  if (state.view === "admin") return renderAdmin();
  return renderDashboard();
}

function metric(label, value, suffix = "") {
  return `<div class="card metric"><div class="label">${label}</div><div class="value">${value}${suffix ? `<small> ${suffix}</small>` : ""}</div></div>`;
}

function renderDashboard() {
  const s = stats();
  return `
    <div class="topline"><h2>首页看板</h2><div class="actions"><button class="btn" onclick="startDueQuiz()">进入今日复习</button><button class="btn secondary" onclick="go('practice')">开始刷题</button></div></div>
    <section class="grid cards">
      ${metric("今日待复习", s.global.due_count, "题")}
      ${metric("累计做题", s.global.total_answers, "次")}
      ${metric("总正确率", pct(s.global.accuracy))}
      ${metric("错题数量", s.global.wrong_question_count, "题")}
    </section>
    <section class="grid two" style="margin-top:14px">
      <div class="panel"><h3>章节掌握概览</h3>${chapterBars(s.chapters)}</div>
      <div class="panel"><h3>高频错题</h3>${topWrongList(s.top_wrong)}</div>
    </section>`;
}

function chapterBars(chapters) {
  return chapters.map((c) => `<div style="margin-bottom:12px"><strong>${esc(c.title)}</strong> <span class="muted">答题 ${c.attempts} 次 · 正确率 ${pct(c.accuracy)}</span><div class="bar"><span style="width:${pct(c.accuracy)}"></span></div></div>`).join("");
}

function topWrongList(items) {
  if (!items.length) return `<div class="empty">暂无错题。</div>`;
  return `<table><thead><tr><th>题目</th><th>错次</th></tr></thead><tbody>${items.map((q) => `<tr><td><span class="chapter-chip">${esc(q.chapter)}</span><br>${esc(q.stem)}</td><td>${q.wrong_count}</td></tr>`).join("")}</tbody></table>`;
}

function answeredQuestionIds() {
  return new Set(userData().records.map((record) => Number(record.questionId)).filter(Boolean));
}

function randomPoolForSource(source = state.randomSource) {
  let pool = BANK;
  if (source === "unanswered") {
    const answered = answeredQuestionIds();
    pool = pool.filter((q) => !answered.has(Number(q.id)));
  }
  if (state.favoriteOnly) pool = pool.filter((q) => isFavorited(q.id));
  return pool;
}

function randomSourceCount(source) {
  return randomPoolForSource(source).length;
}

function practicePool() {
  const s = stats();
  let pool = BANK;
  if (state.practiceMode === "chapter") pool = BANK.filter((q) => state.selectedChapters.has(String(q.chapterId)));
  else if (state.practiceMode === "wrong") pool = s.wrongbook;
  else if (state.practiceMode === "review") pool = s.dueQuestions;
  else if (state.practiceMode === "random") return randomPoolForSource();
  if (state.favoriteOnly) pool = pool.filter((q) => isFavorited(q.id));
  return pool;
}

function selectedPracticeTotal() {
  return practicePool().length;
}

function effectivePracticeCount() {
  return state.customPracticeCount || state.practiceCount;
}

function countControls() {
  const total = selectedPracticeTotal();
  const customText = state.customPracticeCount ? ` · 本轮自定义 ${state.customPracticeCount} 题` : "";
  return `
        <div class="segmented count-controls">
          ${[5, 10, 20].map((n) => `<button class="${state.customPracticeCount === null && state.practiceCount === n ? "active" : ""}" onclick="setPracticeCount(${n})">${n} 题</button>`).join("")}
          <input id="custom-count" class="custom-count" inputmode="numeric" pattern="[0-9]*" min="1" placeholder="自定义" value="${state.customPracticeCount || ""}" oninput="sanitizeCustomCountInput(this)" onkeydown="if(event.key==='Enter')applyCustomPracticeCount()">
          <button onclick="applyCustomPracticeCount()">确定</button>
          <button onclick="fillAllPracticeCount()">全部题目</button>
        </div>
        <p class="hint">当前模式可用题量：${total} 题${customText}</p>`;
}

function favoriteOnlyControl() {
  return `<label class="switch-row"><input type="checkbox" ${state.favoriteOnly ? "checked" : ""} onchange="setFavoriteOnly(this.checked)"><span>只看收藏题目</span></label>`;
}

function randomSourceControl() {
  if (state.practiceMode !== "random") return "";
  const allCount = randomSourceCount("all");
  const unansweredCount = randomSourceCount("unanswered");
  const noUnanswered = unansweredCount === 0;
  return `<div class="random-source">
    <h3>随机来源</h3>
    <div class="segmented">
      <button class="${state.randomSource === "all" ? "active" : ""}" onclick="setRandomSource('all')">全部题目随机 <span class="muted">${allCount} 题</span></button>
      <button class="${state.randomSource === "unanswered" ? "active" : ""}" ${noUnanswered ? "disabled" : ""} onclick="setRandomSource('unanswered')">未作答题目随机 <span class="muted">${unansweredCount} 题</span></button>
    </div>
    ${noUnanswered ? `<p class="hint">暂无未作答习题，可切换全库随机模式</p>` : ""}
  </div>`;
}

function renderPractice() {
  if (state.quiz) return renderQuiz();
  return `
    <div class="topline"><h2>刷题训练</h2><span class="chapter-chip">${BANK.length} 题</span></div>
    <div class="grid two">
      <section class="panel">
        <h3>刷题模式</h3>
        <div class="segmented">${modeButton("chapter", "章节专项")}${modeButton("random", "全真随机")}${modeButton("wrong", "错题专项")}${modeButton("review", "今日复习")}</div>
        ${favoriteOnlyControl()}
        ${randomSourceControl()}
        <h3>题量</h3>
        ${countControls()}
        ${state.practiceMode === "chapter" ? `<h3>章节选择</h3>${chapterCheckboxes()}` : ""}
        <div class="actions" style="margin-top:16px"><button class="btn" onclick="startPractice()">开始本轮刷题</button></div>
      </section>
      <section class="panel"><h3>说明</h3><p class="hint">系统自动识别单选题/多选题。答错进入错题本，并按 1 天、6 小时、次日、3 日、7 日、15 日等节奏安排复习。</p></section>
    </div>`;
}

function modeButton(mode, label) {
  return `<button class="${state.practiceMode === mode ? "active" : ""}" onclick="setPracticeMode('${mode}')">${label}</button>`;
}

function chapterCheckboxes() {
  return `<div class="chapter-list">${state.chapters.map((c) => `<label class="chapter-item"><input type="checkbox" ${state.selectedChapters.has(String(c.id)) ? "checked" : ""} onchange="toggleChapter('${c.id}',this.checked)"><span>${esc(c.title)}<br><span class="muted">${c.question_count} 题</span></span></label>`).join("")}</div>`;
}

function renderQuiz() {
  restoreQuizStep();
  const q = state.quiz.questions[state.quiz.index];
  const selected = Array.isArray(state.quiz.selected) ? state.quiz.selected : [state.quiz.selected].filter(Boolean);
  const correct = state.quiz.feedback?.answerLetters || [];
  const previousDisabled = state.quiz.index === 0 ? "disabled" : "";
  return `
    <div class="topline"><h2>${modeName(state.quiz.mode)}</h2><div class="actions"><span class="chapter-chip">${state.quiz.index + 1} / ${state.quiz.questions.length}</span><button class="btn secondary" onclick="endQuiz()">结束本轮</button></div></div>
    <section class="panel quiz-card">
      <div><span class="chapter-chip">${esc(q.chapter)}</span> <span class="chapter-chip">${q.type === "multiple" ? "多选题" : "单选题"}</span></div>
      <div class="question-text">${esc(q.stem)}</div>
      <div class="options">${Object.entries(q.options).map(([l, t]) => {
        let cls = "option";
        if (state.quiz.feedback) {
          if (correct.includes(l)) cls += " correct";
          if (!state.quiz.feedback.correct && selected.includes(l) && !correct.includes(l)) cls += " wrong";
        }
        return `<label class="${cls}"><input type="${q.type === "multiple" ? "checkbox" : "radio"}" name="answer" ${selected.includes(l) ? "checked" : ""} onchange="selectAnswer('${l}',this.checked)"><span><strong>${l}.</strong> ${esc(t)}</span></label>`;
      }).join("")}</div>
      ${state.quiz.feedback ? feedbackHtml(state.quiz.feedback) : ""}
      <div class="actions">
        <button class="btn secondary" onclick="previousQuestion()" ${previousDisabled}>上一题</button>
        ${state.quiz.feedback ? `<button class="btn" onclick="nextQuestion()">下一题</button><button class="btn ghost" onclick="singleInsight(${q.id})">提炼本题考点</button>${favoriteButton(q.id)}${noteActionButton(q.id)}` : `<button class="btn" onclick="submitAnswer()">提交答案</button>`}
      </div>
    </section>
    ${state.insightText ? `<section class="panel" style="margin-top:14px"><h3>考点提炼</h3><div class="note-box">${esc(state.insightText)}</div></section>` : ""}
    ${state.quiz.feedback ? favoriteStatusHtml(q.id) : ""}
    ${state.quiz.feedback || state.noteEditorId === Number(q.id) ? personalNoteHtml(q) : ""}`;
}

function modeName(mode) {
  return { chapter: "章节专项刷题", random: "全真随机刷题", wrong: "错题专项刷题", review: "今日复习刷题", favorite: "我的收藏刷题" }[mode] || "刷题";
}

function feedbackHtml(fb) {
  return `<div class="feedback ${fb.correct ? "good" : "bad"}">${fb.correct ? "回答正确" : `回答错误，正确答案：${esc(fb.answerLetters.join(","))} ${esc(fb.answerText)}`}${fb.nextReviewAt ? `<br>下次复习：${dateText(fb.nextReviewAt)}` : ""}</div>`;
}

function noteActionButton(questionId) {
  return `<button class="btn ghost" onclick="openNoteEditor(${questionId})">${noteText(questionId) ? "编辑备注" : "添加备注"}</button>`;
}

function favoriteButton(questionId) {
  const active = isFavorited(questionId);
  return `<button class="btn ghost favorite-btn ${active ? "active" : ""}" onclick="toggleFavorite(${questionId})" title="${active ? "取消收藏" : "收藏本题"}"><span class="star">${active ? "★" : "☆"}</span> ${active ? "已收藏" : "收藏本题"}</button>`;
}

function favoriteStatusHtml(questionId) {
  if (!isFavorited(questionId)) return "";
  return `<section class="favorite-status" style="margin-top:14px"><span class="star">★</span> 已收藏</section>`;
}

function personalNoteHtml(q) {
  const saved = questionNote(q.id);
  const editing = state.noteEditorId === Number(q.id);
  if (!editing && !saved?.note) return "";
  return `<section class="panel personal-note-section" style="margin-top:14px">
    <h3>我的备注</h3>
    ${editing ? noteEditorHtml(q.id, saved?.note || "") : `<div class="personal-note">${esc(saved.note)}</div><div class="note-meta">更新于 ${dateText(saved.updateTime)}</div>`}
  </section>`;
}

function noteEditorHtml(questionId, value) {
  return `<div class="note-editor">
    <textarea id="note-editor-${questionId}" maxlength="500" rows="5" placeholder="写下你的知识点总结、易错提醒或解题技巧，最多 500 字。">${esc(value)}</textarea>
    <div class="note-tools">
      <span class="muted">最多 500 字</span>
      <div class="actions">
        <button class="btn" onclick="saveQuestionNote(${questionId})">保存</button>
        <button class="btn secondary" onclick="cancelNoteEditor()">取消</button>
        ${value ? `<button class="btn danger" onclick="deleteQuestionNote(${questionId})">删除</button>` : ""}
      </div>
    </div>
  </div>`;
}

function noteCellHtml(q) {
  const saved = questionNote(q.id);
  const editing = state.noteEditorId === Number(q.id);
  if (editing) return noteEditorHtml(q.id, saved?.note || "");
  return `<div class="note-cell">${saved?.note ? `<div class="personal-note compact">${esc(saved.note)}</div><div class="note-meta">${dateText(saved.updateTime)}</div>` : `<span class="muted">暂无备注</span>`}<div style="margin-top:8px">${noteActionButton(q.id)}</div></div>`;
}

function renderReview() {
  const due = state.favoriteOnly ? stats().dueQuestions.filter((q) => isFavorited(q.id)) : stats().dueQuestions;
  return `<div class="topline"><h2>今日复习</h2><div class="actions"><button class="btn" onclick="startDueQuiz()">开始复习</button></div></div><section class="panel">${favoriteOnlyControl()}${due.length ? questionTable(due) : `<div class="empty">当前暂无可复习错题。</div>`}</section>`;
}

function renderWrongbook() {
  const items = stats().wrongbook;
  return `<div class="topline"><h2>错题本</h2><button class="btn" onclick="exportWrongbook()">导出错题 HTML</button></div><section class="panel">${items.length ? wrongTable(items) : `<div class="empty">当前账号还没有错题。</div>`}</section>`;
}

function renderFavorites() {
  const items = favoriteQuestions();
  if (!items.length) {
    return `<div class="topline"><h2>我的收藏</h2></div><section class="panel"><div class="empty">还没有收藏题目。答题后点击星标即可收藏。</div></section>`;
  }
  const grouped = {};
  items.forEach((q) => (grouped[q.chapter] ||= []).push(q));
  return `<div class="topline"><h2>我的收藏</h2><button class="btn danger" onclick="clearAllFavorites()">批量取消收藏</button></div>
    ${Object.entries(grouped)
      .map(([chapter, qs]) => `<section class="panel" style="margin-top:14px"><h3>${esc(chapter)} <span class="muted">${qs.length} 题</span></h3>${favoriteTable(qs)}</section>`)
      .join("")}`;
}

function favoriteTable(items) {
  return `<table><thead><tr><th>题目</th><th>答案</th><th>备注</th><th>收藏时间</th><th>操作</th></tr></thead><tbody>${items
    .map((q) => `<tr><td>${esc(q.stem)}</td><td>${esc(q.answerLetters.join(","))} ${esc(q.answerText)}</td><td>${noteCellHtml(q)}</td><td>${dateText(q.favoriteCreatedAt)}</td><td><div class="actions"><button class="btn ghost" onclick="openQuestionById(${q.id})">跳转原题</button><button class="btn ghost" onclick="openNoteEditor(${q.id})">编辑备注</button><button class="btn danger" onclick="toggleFavorite(${q.id})">取消收藏</button></div></td></tr>`)
    .join("")}</tbody></table>`;
}

function wrongTable(items) {
  return `<table><thead><tr><th>题目</th><th>答案</th><th>错误次数</th><th>复习计划</th><th>备注</th><th>操作</th></tr></thead><tbody>${items.map((q) => `<tr><td><span class="chapter-chip">${esc(q.chapter)}</span><br>${esc(q.stem)}</td><td>${esc(q.answerLetters.join(","))} ${esc(q.answerText)}</td><td>${q.wrongCount}</td><td>上次：${dateText(q.lastAnswerAt)}<br>下次：${dateText(q.nextReviewAt)}<br>连续答对：${q.consecutiveCorrect}</td><td>${noteCellHtml(q)}</td><td><button class="btn ghost" onclick="singleInsight(${q.id})">考点</button></td></tr>`).join("")}</tbody></table>`;
}

function questionTable(items) {
  return `<table><thead><tr><th>章节</th><th>题干</th><th>备注</th></tr></thead><tbody>${items.map((q) => `<tr><td>${esc(q.chapter)}</td><td>${esc(q.stem)}</td><td>${noteCellHtml(q)}</td></tr>`).join("")}</tbody></table>`;
}

function renderStats() {
  const s = stats();
  return `<div class="topline"><h2>学习统计</h2></div><section class="grid cards">${metric("累计做题", s.global.total_answers, "次")}${metric("总正确率", pct(s.global.accuracy))}${metric("总错题数量", s.global.wrong_question_count, "题")}${metric("平均错误率", pct(s.global.average_error_rate))}</section><section class="grid two" style="margin-top:14px"><div class="panel"><h3>分章节统计</h3>${chapterBars(s.chapters)}</div><div class="panel"><h3>错题排行</h3>${topWrongList(s.top_wrong)}</div></section>`;
}

function renderInsights() {
  return `<div class="topline"><h2>错题考点提炼</h2><button class="btn" onclick="batchInsight()">生成错题背诵提纲</button></div><section class="panel"><div class="note-box">${esc(state.insightText || "点击生成后显示。")}</div></section>`;
}

function renderAdmin() {
  const data = userData();
  return `<div class="topline"><h2>本地管理</h2></div><section class="grid two"><div class="panel"><h3>本地账号</h3><p>当前浏览器共有 ${users().length} 个账号。</p><p class="hint">静态公开版无法提供真正服务端管理员权限，公共题库固定在 questions.js 中。</p></div><div class="panel"><h3>数据维护</h3><p>当前账号答题 ${data.records.length} 次，错题 ${Object.values(data.states).filter((s) => s.wrongCount > 0).length} 题。</p><button class="btn danger" onclick="resetMine()">清空当前账号学习数据</button></div></section>`;
}

async function submitAuth() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (username.length < 2 || password.length < 6) return showError("用户名至少 2 位，密码至少 6 位。");
  const list = users();
  if (state.authTab === "register") {
    if (list.some((u) => u.username === username)) return showError("用户名已存在。");
    const pw = await makePassword(password);
    list.push({ username, ...pw });
    saveUsers(list);
    saveUserData({ records: [], states: {}, favorites: [], notes: {} }, username);
  }
  const found = list.find((u) => u.username === username);
  if (!found) return showError("账号不存在。");
  const check = await makePassword(password, found.salt);
  if (check.hash !== found.hash) return showError("密码错误。");
  state.user = { username, isAdmin: username === "admin" };
  loadPracticeState(username);
  writeJson(STORAGE.session, { username, at: new Date().toISOString() });
  state.error = "";
  render();
}

function showError(message) {
  state.error = message;
  render();
}

function logout() {
  localStorage.removeItem(STORAGE.session);
  state.user = null;
  state.quiz = null;
  state.noteEditorId = null;
  render();
}

function go(view) {
  state.view = view;
  state.error = "";
  render();
}

function setPracticeMode(mode) {
  state.practiceMode = mode;
  savePracticeState();
  render();
}

function setRandomSource(source) {
  if (source === "unanswered" && randomSourceCount("unanswered") === 0) {
    return showError("暂无未作答习题，可切换全库随机模式");
  }
  state.randomSource = source === "unanswered" ? "unanswered" : "all";
  state.error = "";
  savePracticeState();
  render();
}

function setPracticeCount(count) {
  state.practiceCount = count;
  state.customPracticeCount = null;
  savePracticeState();
  render();
}

function setFavoriteOnly(checked) {
  state.favoriteOnly = Boolean(checked);
  savePracticeState();
  render();
}

function sanitizeCustomCountInput(input) {
  input.value = input.value.replace(/[^\d]/g, "");
}

function applyCustomPracticeCount() {
  const input = document.getElementById("custom-count");
  const count = Number(input?.value || "");
  if (!Number.isInteger(count) || count < 1) return showError("请输入大于等于 1 的正整数题量。");
  const total = selectedPracticeTotal();
  if (count > total) return showError(`所选章节总题量为 ${total}，不可超出`);
  state.practiceCount = count;
  state.customPracticeCount = count;
  state.error = "";
  savePracticeState();
  render();
}

function fillAllPracticeCount() {
  const total = selectedPracticeTotal();
  if (!total) return showError("当前模式下暂无可用题目。");
  state.practiceCount = total;
  state.customPracticeCount = total;
  state.error = "";
  savePracticeState();
  render();
}

function toggleChapter(id, checked) {
  if (checked) state.selectedChapters.add(String(id));
  else state.selectedChapters.delete(String(id));
  savePracticeState();
}

function startPractice() {
  const total = selectedPracticeTotal();
  const count = effectivePracticeCount();
  if (state.practiceMode === "random" && state.randomSource === "unanswered" && total === 0) {
    return showError("暂无未作答习题，可切换全库随机模式");
  }
  if (count > total) return showError(`所选章节总题量为 ${total}，不可超出`);
  let pool = shuffle(practicePool()).slice(0, count);
  if (!pool.length) return showError("当前模式下暂无可抽取题目。");
  state.quiz = { mode: state.practiceMode, questions: pool, index: 0, selected: pool[0].type === "multiple" ? [] : "", feedback: null, answerStates: {} };
  saveCurrentQuizStep({ selected: state.quiz.selected, feedback: null, insightText: "" });
  state.insightText = "";
  savePracticeState();
  render();
}

function startDueQuiz() {
  state.practiceMode = "review";
  state.view = "practice";
  savePracticeState();
  startPractice();
}

function openQuestionById(questionId) {
  const q = questionById(questionId);
  if (!q) return showError("未找到该题目。");
  state.quiz = { mode: "favorite", questions: [q], index: 0, selected: emptySelection(q), feedback: null, answerStates: {} };
  state.view = "practice";
  state.insightText = "";
  saveCurrentQuizStep({ selected: state.quiz.selected, feedback: null, insightText: "" });
  savePracticeState();
  render();
}

function selectAnswer(letter, checked) {
  const previousFeedback = state.quiz.feedback;
  const q = state.quiz.questions[state.quiz.index];
  if (q.type === "multiple") {
    const selected = new Set(state.quiz.selected || []);
    checked ? selected.add(letter) : selected.delete(letter);
    state.quiz.selected = [...selected].sort();
  } else {
    state.quiz.selected = letter;
  }
  if (previousFeedback) {
    state.quiz.feedback = null;
    state.insightText = "";
  }
  saveCurrentQuizStep({ selected: state.quiz.selected, feedback: state.quiz.feedback, insightText: state.insightText });
  savePracticeState();
  if (previousFeedback) render();
}

function submitAnswer() {
  const q = state.quiz.questions[state.quiz.index];
  const selected = Array.isArray(state.quiz.selected) ? state.quiz.selected : [state.quiz.selected].filter(Boolean);
  if (!selected.length) return showError("请先选择答案。");
  const correct = selected.join(",") === q.answerLetters.join(",");
  const data = userData();
  const step = ensureQuizState() || {};
  const answeredAt = new Date().toISOString();
  const record = {
    id: step.recordId || makeRecordId(),
    questionId: q.id,
    selected,
    correct,
    mode: state.quiz.mode,
    answeredAt,
  };
  const idx = data.records.findIndex((r) => r.id && r.id === record.id);
  if (idx >= 0) data.records[idx] = record;
  else data.records.push(record);
  const current = recomputeQuestionState(data, q.id);
  saveUserData(data);
  state.quiz.feedback = { correct, answerLetters: q.answerLetters, answerText: q.answerText, nextReviewAt: current.nextReviewAt };
  saveCurrentQuizStep({ selected: state.quiz.selected, feedback: state.quiz.feedback, recordId: record.id, insightText: state.insightText });
  state.error = "";
  savePracticeState();
  render();
}

function makeRecordId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function recomputeQuestionState(data, questionId) {
  const records = data.records
    .filter((r) => Number(r.questionId) === Number(questionId))
    .sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
  if (!records.length) {
    delete data.states[questionId];
    return { nextReviewAt: null };
  }
  const totalAttempts = records.length;
  const correctCount = records.filter((r) => r.correct).length;
  const wrongCount = records.filter((r) => !r.correct).length;
  const last = records.at(-1);
  let consecutiveCorrect = 0;
  for (let i = records.length - 1; i >= 0 && records[i].correct; i--) consecutiveCorrect += 1;

  let reviewIntervalHours = 0;
  let nextReviewAt = null;
  let masteredAt = null;
  if (wrongCount > 0) {
    if (last.correct) {
      if (consecutiveCorrect >= 3) masteredAt = last.answeredAt;
      else {
        reviewIntervalHours = consecutiveCorrect >= 2 ? 15 * 24 : 7 * 24;
        nextReviewAt = addHoursFrom(last.answeredAt, reviewIntervalHours);
      }
    } else {
      nextReviewAt = last.answeredAt;
    }
  }
  const current = {
    totalAttempts,
    correctCount,
    wrongCount,
    consecutiveCorrect,
    lastAnswerAt: last.answeredAt,
    nextReviewAt,
    reviewIntervalHours,
    masteredAt,
  };
  data.states[questionId] = current;
  return current;
}

function addHoursFrom(value, hours) {
  return new Date(new Date(value).getTime() + hours * 3600 * 1000).toISOString();
}

function nextQuestion() {
  saveCurrentQuizStep({ selected: state.quiz.selected, feedback: state.quiz.feedback, insightText: state.insightText });
  if (state.quiz.index >= state.quiz.questions.length - 1) {
    state.quiz = null;
    state.view = "stats";
    savePracticeState();
    render();
    return;
  }
  state.quiz.index += 1;
  restoreQuizStep();
  savePracticeState();
  render();
}

function previousQuestion() {
  if (!state.quiz || state.quiz.index <= 0) return;
  saveCurrentQuizStep({ selected: state.quiz.selected, feedback: state.quiz.feedback, insightText: state.insightText });
  state.quiz.index -= 1;
  restoreQuizStep();
  savePracticeState();
  render();
}

function endQuiz() {
  state.quiz = null;
  state.insightText = "";
  savePracticeState();
  render();
}

function note(q, wrongCount = 0) {
  const stem = q.stem.replace("(单选题)", "").replace("（单选题）", "").replace("(多选题)", "").replace("（多选题）", "").replace("(   )", "____").replace("()", "____");
  const phrase = stem.includes("____") ? stem.replace("____", `【${q.answerText}】`) : `${stem}：${q.answerText}`;
  return `${wrongCount ? `高频错题（错 ${wrongCount} 次）：` : ""}考点来自《${q.chapter}》。背诵话术：${phrase}。关键词：${q.answerText}。`;
}

function singleInsight(id) {
  const s = userData().states[id];
  state.insightText = note(questionById(id), s?.wrongCount || 0);
  if (state.quiz) saveCurrentQuizStep({ insightText: state.insightText });
  savePracticeState();
  render();
}

function batchInsight() {
  const items = stats().wrongbook;
  if (!items.length) {
    state.insightText = "当前账号暂无错题。";
  } else {
    const grouped = {};
    items.forEach((q) => (grouped[q.chapter] ||= []).push(q));
    state.insightText = Object.entries(grouped).map(([chapter, qs]) => `## ${chapter}\n${qs.map((q) => `- ${note(q, q.wrongCount)}`).join("\n")}`).join("\n\n");
  }
  savePracticeState();
  render();
}

function exportWrongbook() {
  const items = stats().wrongbook;
  const body = items.map((q, i) => `<h2>${i + 1}. ${esc(q.chapter)}</h2><p>${esc(q.stem)}</p><ul>${Object.entries(q.options).map(([l, t]) => `<li>${l}. ${esc(t)}</li>`).join("")}</ul><p><strong>正确答案：${esc(q.answerLetters.join(","))} ${esc(q.answerText)}</strong></p><p>${esc(note(q, q.wrongCount))}</p>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>个人错题本</title><body><h1>个人错题本</h1>${body || "<p>暂无错题</p>"}</body>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "个人错题本.html";
  a.click();
  URL.revokeObjectURL(url);
}

function resetMine() {
  if (!confirm("确认清空当前账号学习数据？")) return;
  saveUserData({ records: [], states: {}, favorites: [], notes: {} });
  render();
}

window.state = state;
window.submitAuth = submitAuth;
window.logout = logout;
window.go = go;
window.toggleChapter = toggleChapter;
window.setPracticeMode = setPracticeMode;
window.setRandomSource = setRandomSource;
window.setPracticeCount = setPracticeCount;
window.setFavoriteOnly = setFavoriteOnly;
window.sanitizeCustomCountInput = sanitizeCustomCountInput;
window.applyCustomPracticeCount = applyCustomPracticeCount;
window.fillAllPracticeCount = fillAllPracticeCount;
window.toggleFavorite = toggleFavorite;
window.clearAllFavorites = clearAllFavorites;
window.openQuestionById = openQuestionById;
window.openNoteEditor = openNoteEditor;
window.cancelNoteEditor = cancelNoteEditor;
window.saveQuestionNote = saveQuestionNote;
window.deleteQuestionNote = deleteQuestionNote;
window.startPractice = startPractice;
window.startDueQuiz = startDueQuiz;
window.selectAnswer = selectAnswer;
window.submitAnswer = submitAnswer;
window.nextQuestion = nextQuestion;
window.previousQuestion = previousQuestion;
window.endQuiz = endQuiz;
window.singleInsight = singleInsight;
window.batchInsight = batchInsight;
window.exportWrongbook = exportWrongbook;
window.resetMine = resetMine;

init();
