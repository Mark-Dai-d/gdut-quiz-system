const BANK = window.QUESTION_BANK || [];
const STORAGE = {
  users: "szzq_static_users_v1",
  session: "szzq_static_session_v1",
  userData: (username) => `szzq_static_data_v1_${username}`,
};

const state = {
  user: null,
  authTab: "login",
  view: "dashboard",
  error: "",
  chapters: [],
  quiz: null,
  practiceMode: "chapter",
  practiceCount: 10,
  selectedChapters: new Set(["0"]),
  insightText: "",
};

const nav = [
  ["dashboard", "首页看板"],
  ["practice", "刷题训练"],
  ["review", "今日复习"],
  ["wrongbook", "错题本"],
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
  return readJson(STORAGE.userData(username), {
    records: [],
    states: {},
    favorites: [],
  });
}

function saveUserData(data, username = state.user?.username) {
  writeJson(STORAGE.userData(username), data);
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
  }
  render();
}

function stats() {
  const data = userData();
  const total = data.records.length;
  const correct = data.records.filter((r) => r.correct).length;
  const wrongIds = Object.entries(data.states).filter(([, s]) => s.wrongCount > 0).map(([id]) => Number(id));
  const due = wrongIds.filter((id) => {
    const s = data.states[id];
    return s.nextReviewAt && !s.masteredAt && new Date(s.nextReviewAt) <= new Date();
  });
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
    dueQuestions: due.map(questionById),
    wrongbook: wrongIds.map((id) => ({ ...questionById(id), ...data.states[id] })).sort((a, b) => b.wrongCount - a.wrongCount),
  };
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
      <main class="main">${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}${renderView()}</main>
    </div>`;
}

function renderView() {
  if (state.view === "practice") return renderPractice();
  if (state.view === "review") return renderReview();
  if (state.view === "wrongbook") return renderWrongbook();
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

function renderPractice() {
  if (state.quiz) return renderQuiz();
  return `
    <div class="topline"><h2>刷题训练</h2><span class="chapter-chip">${BANK.length} 题</span></div>
    <div class="grid two">
      <section class="panel">
        <h3>刷题模式</h3>
        <div class="segmented">${modeButton("chapter", "章节专项")}${modeButton("random", "全真随机")}${modeButton("wrong", "错题专项")}${modeButton("review", "今日复习")}</div>
        <h3>题量</h3>
        <div class="segmented">${[5, 10, 20].map((n) => `<button class="${state.practiceCount === n ? "active" : ""}" onclick="state.practiceCount=${n};render()">${n} 题</button>`).join("")}</div>
        ${state.practiceMode === "chapter" ? `<h3>章节选择</h3>${chapterCheckboxes()}` : ""}
        <div class="actions" style="margin-top:16px"><button class="btn" onclick="startPractice()">开始本轮刷题</button></div>
      </section>
      <section class="panel"><h3>说明</h3><p class="hint">系统自动识别单选题/多选题。答错进入错题本，并按 1 天、6 小时、次日、3 日、7 日、15 日等节奏安排复习。</p></section>
    </div>`;
}

function modeButton(mode, label) {
  return `<button class="${state.practiceMode === mode ? "active" : ""}" onclick="state.practiceMode='${mode}';render()">${label}</button>`;
}

function chapterCheckboxes() {
  return `<div class="chapter-list">${state.chapters.map((c) => `<label class="chapter-item"><input type="checkbox" ${state.selectedChapters.has(String(c.id)) ? "checked" : ""} onchange="toggleChapter('${c.id}',this.checked)"><span>${esc(c.title)}<br><span class="muted">${c.question_count} 题</span></span></label>`).join("")}</div>`;
}

function renderQuiz() {
  const q = state.quiz.questions[state.quiz.index];
  const selected = Array.isArray(state.quiz.selected) ? state.quiz.selected : [state.quiz.selected].filter(Boolean);
  const correct = state.quiz.feedback?.answerLetters || [];
  return `
    <div class="topline"><h2>${modeName(state.quiz.mode)}</h2><div class="actions"><span class="chapter-chip">${state.quiz.index + 1} / ${state.quiz.questions.length}</span><button class="btn secondary" onclick="state.quiz=null;render()">结束本轮</button></div></div>
    <section class="panel quiz-card">
      <div><span class="chapter-chip">${esc(q.chapter)}</span> <span class="chapter-chip">${q.type === "multiple" ? "多选题" : "单选题"}</span></div>
      <div class="question-text">${esc(q.stem)}</div>
      <div class="options">${Object.entries(q.options).map(([l, t]) => {
        let cls = "option";
        if (state.quiz.feedback) {
          if (correct.includes(l)) cls += " correct";
          if (!state.quiz.feedback.correct && selected.includes(l) && !correct.includes(l)) cls += " wrong";
        }
        return `<label class="${cls}"><input type="${q.type === "multiple" ? "checkbox" : "radio"}" name="answer" ${selected.includes(l) ? "checked" : ""} ${state.quiz.feedback ? "disabled" : ""} onchange="selectAnswer('${l}',this.checked)"><span><strong>${l}.</strong> ${esc(t)}</span></label>`;
      }).join("")}</div>
      ${state.quiz.feedback ? feedbackHtml(state.quiz.feedback) : `<button class="btn" onclick="submitAnswer()">提交答案</button>`}
      ${state.quiz.feedback ? `<div class="actions"><button class="btn" onclick="nextQuestion()">下一题</button><button class="btn ghost" onclick="singleInsight(${q.id})">提炼本题考点</button></div>` : ""}
    </section>
    ${state.insightText ? `<section class="panel" style="margin-top:14px"><h3>考点提炼</h3><div class="note-box">${esc(state.insightText)}</div></section>` : ""}`;
}

function modeName(mode) {
  return { chapter: "章节专项刷题", random: "全真随机刷题", wrong: "错题专项刷题", review: "今日复习刷题" }[mode] || "刷题";
}

function feedbackHtml(fb) {
  return `<div class="feedback ${fb.correct ? "good" : "bad"}">${fb.correct ? "回答正确" : `回答错误，正确答案：${esc(fb.answerLetters.join(","))} ${esc(fb.answerText)}`}${fb.nextReviewAt ? `<br>下次复习：${dateText(fb.nextReviewAt)}` : ""}</div>`;
}

function renderReview() {
  const due = stats().dueQuestions;
  return `<div class="topline"><h2>今日复习</h2><button class="btn" onclick="startDueQuiz()">开始复习</button></div><section class="panel">${due.length ? questionTable(due) : `<div class="empty">今天暂无到期复习题。</div>`}</section>`;
}

function renderWrongbook() {
  const items = stats().wrongbook;
  return `<div class="topline"><h2>错题本</h2><button class="btn" onclick="exportWrongbook()">导出错题 HTML</button></div><section class="panel">${items.length ? wrongTable(items) : `<div class="empty">当前账号还没有错题。</div>`}</section>`;
}

function wrongTable(items) {
  return `<table><thead><tr><th>题目</th><th>答案</th><th>错误次数</th><th>复习计划</th><th>操作</th></tr></thead><tbody>${items.map((q) => `<tr><td><span class="chapter-chip">${esc(q.chapter)}</span><br>${esc(q.stem)}</td><td>${esc(q.answerLetters.join(","))} ${esc(q.answerText)}</td><td>${q.wrongCount}</td><td>上次：${dateText(q.lastAnswerAt)}<br>下次：${dateText(q.nextReviewAt)}<br>连续答对：${q.consecutiveCorrect}</td><td><button class="btn ghost" onclick="singleInsight(${q.id})">考点</button></td></tr>`).join("")}</tbody></table>`;
}

function questionTable(items) {
  return `<table><thead><tr><th>章节</th><th>题干</th></tr></thead><tbody>${items.map((q) => `<tr><td>${esc(q.chapter)}</td><td>${esc(q.stem)}</td></tr>`).join("")}</tbody></table>`;
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
    saveUserData({ records: [], states: {}, favorites: [] }, username);
  }
  const found = list.find((u) => u.username === username);
  if (!found) return showError("账号不存在。");
  const check = await makePassword(password, found.salt);
  if (check.hash !== found.hash) return showError("密码错误。");
  state.user = { username, isAdmin: username === "admin" };
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
  render();
}

function go(view) {
  state.view = view;
  state.error = "";
  state.quiz = null;
  render();
}

function toggleChapter(id, checked) {
  if (checked) state.selectedChapters.add(String(id));
  else state.selectedChapters.delete(String(id));
}

function startPractice() {
  let pool = [];
  const s = stats();
  if (state.practiceMode === "chapter") pool = BANK.filter((q) => state.selectedChapters.has(String(q.chapterId)));
  else if (state.practiceMode === "wrong") pool = s.wrongbook;
  else if (state.practiceMode === "review") pool = s.dueQuestions;
  else pool = BANK;
  pool = shuffle(pool).slice(0, state.practiceCount);
  if (!pool.length) return showError("当前模式下暂无可抽取题目。");
  state.quiz = { mode: state.practiceMode, questions: pool, index: 0, selected: pool[0].type === "multiple" ? [] : "", feedback: null };
  state.insightText = "";
  render();
}

function startDueQuiz() {
  state.practiceMode = "review";
  state.view = "practice";
  startPractice();
}

function selectAnswer(letter, checked) {
  if (state.quiz.feedback) return;
  const q = state.quiz.questions[state.quiz.index];
  if (q.type === "multiple") {
    const selected = new Set(state.quiz.selected || []);
    checked ? selected.add(letter) : selected.delete(letter);
    state.quiz.selected = [...selected].sort();
  } else {
    state.quiz.selected = letter;
  }
}

function submitAnswer() {
  const q = state.quiz.questions[state.quiz.index];
  const selected = Array.isArray(state.quiz.selected) ? state.quiz.selected : [state.quiz.selected].filter(Boolean);
  if (!selected.length) return showError("请先选择答案。");
  const correct = selected.join(",") === q.answerLetters.join(",");
  const data = userData();
  data.records.push({ questionId: q.id, selected, correct, mode: state.quiz.mode, answeredAt: new Date().toISOString() });
  const current = data.states[q.id] || { totalAttempts: 0, correctCount: 0, wrongCount: 0, consecutiveCorrect: 0, reviewIntervalHours: 0 };
  current.totalAttempts += 1;
  current.correctCount += correct ? 1 : 0;
  current.wrongCount += correct ? 0 : 1;
  current.lastAnswerAt = new Date().toISOString();
  if (correct) {
    current.consecutiveCorrect += 1;
    if (current.wrongCount > 0) {
      if (current.consecutiveCorrect >= 3) {
        current.masteredAt = new Date().toISOString();
        current.nextReviewAt = null;
      } else if (current.consecutiveCorrect >= 2) {
        current.reviewIntervalHours = 15 * 24;
        current.nextReviewAt = addHours(current.reviewIntervalHours);
      } else {
        current.reviewIntervalHours = 7 * 24;
        current.nextReviewAt = addHours(current.reviewIntervalHours);
      }
    }
  } else {
    current.consecutiveCorrect = 0;
    current.masteredAt = null;
    if (!current.wrongCount || current.wrongCount === 1) current.reviewIntervalHours = 24;
    else if (!current.reviewIntervalHours || current.reviewIntervalHours > 72) current.reviewIntervalHours = 6;
    else if (current.reviewIntervalHours <= 6) current.reviewIntervalHours = 24;
    else current.reviewIntervalHours = 72;
    current.nextReviewAt = addHours(current.reviewIntervalHours);
  }
  data.states[q.id] = current;
  saveUserData(data);
  state.quiz.feedback = { correct, answerLetters: q.answerLetters, answerText: q.answerText, nextReviewAt: current.nextReviewAt };
  state.error = "";
  render();
}

function addHours(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function nextQuestion() {
  if (state.quiz.index >= state.quiz.questions.length - 1) {
    state.quiz = null;
    state.view = "stats";
    render();
    return;
  }
  state.quiz.index += 1;
  const q = state.quiz.questions[state.quiz.index];
  state.quiz.selected = q.type === "multiple" ? [] : "";
  state.quiz.feedback = null;
  state.insightText = "";
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
  saveUserData({ records: [], states: {}, favorites: [] });
  render();
}

window.state = state;
window.submitAuth = submitAuth;
window.logout = logout;
window.go = go;
window.toggleChapter = toggleChapter;
window.startPractice = startPractice;
window.startDueQuiz = startDueQuiz;
window.selectAnswer = selectAnswer;
window.submitAnswer = submitAnswer;
window.nextQuestion = nextQuestion;
window.singleInsight = singleInsight;
window.batchInsight = batchInsight;
window.exportWrongbook = exportWrongbook;
window.resetMine = resetMine;

init();
