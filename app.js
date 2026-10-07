(() => {
  "use strict";

  const data = window.STUDY_DATA;
  if (!data?.days?.length) {
    document.body.innerHTML = "<p style='padding:2rem'>学习数据加载失败，请刷新页面。</p>";
    return;
  }

  const STORAGE_KEY = "swufe-fintech-study-v2";
  const subjectMeta = {
    math: { color: "#24517e", icon: "∫" },
    english: { color: "#d55237", icon: "A" },
    econ: { color: "#138a67", icon: "经" },
    politics: { color: "#8c55a2", icon: "政" },
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);

  function defaultDay() {
    const today = new Date().toISOString().slice(0, 10);
    const match = data.days.find((day) => day.date === today);
    return match?.day || 1;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        selectedDay: Number(saved?.selectedDay) || defaultDay(),
        activeView: saved?.activeView || "plan",
        progress: saved?.progress || {},
        mode: saved?.mode || "learn",
      };
    } catch {
      return { selectedDay: defaultDay(), activeView: "plan", progress: {}, mode: "learn" };
    }
  }

  const state = loadState();
  let wordIndex = 0;
  let wordOrder = [];
  let answerShown = false;
  let mistakeReviewQueue = null;
  let sentenceIndex = 0;
  let sentenceAnswerShown = false;
  let toastTimer = null;

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      selectedDay: state.selectedDay,
      activeView: state.activeView,
      progress: state.progress,
      mode: state.mode,
    }));
  }

  function currentDay() {
    return data.days[state.selectedDay - 1];
  }

  function dayProgress(dayNumber) {
    const day = data.days[dayNumber - 1];
    const progress = state.progress[dayNumber] || {};
    const subjectDone = Object.values(progress.subjects || {}).filter(Boolean).length;
    const attempted = Object.keys(progress.words || {}).length;
    const englishChecks = progress.english?.checks || {};
    const englishDone = ["sentences", "paper", "writing"].filter((key) => englishChecks[key]).length;
    const ratio = (subjectDone + Math.min(1, attempted / day.words.length) + Math.min(1, englishDone / 3)) / 6;
    return Math.round(ratio * 100);
  }

  function isDayComplete(dayNumber) {
    return dayProgress(dayNumber) === 100;
  }

  function allMistakes() {
    const result = [];
    data.days.forEach((day) => {
      const statuses = state.progress[day.day]?.words || {};
      day.words.forEach((item, index) => {
        if (statuses[item.word] === "unknown") result.push({ ...item, day: day.day, index });
      });
    });
    return result;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }

  function renderDayList(query = "") {
    const list = $("#day-list");
    const normalized = query.trim().toLowerCase().replace(/\s/g, "");
    let previousPhase = "";
    const parts = [];
    data.days.forEach((day) => {
      const haystack = `${day.day}${day.date}${day.dateDisplay}${day.weekday}${day.phase}`.toLowerCase().replace(/\s/g, "");
      if (normalized && !haystack.includes(normalized)) return;
      if (day.phase !== previousPhase) {
        parts.push(`<div class="day-group-label">${escapeHtml(day.phase)}</div>`);
        previousPhase = day.phase;
      }
      parts.push(`
        <button class="day-item ${day.day === state.selectedDay ? "is-active" : ""} ${isDayComplete(day.day) ? "is-complete" : ""}" type="button" data-day="${day.day}">
          <span class="day-number">D${String(day.day).padStart(2, "0")}</span>
          <span class="day-copy"><strong>${escapeHtml(day.dateDisplay)}</strong><small>${escapeHtml(day.weekday)}</small></span>
          <span class="day-check" aria-hidden="true"></span>
        </button>`);
    });
    list.innerHTML = parts.join("") || `<div class="day-group-label">没有匹配的日期</div>`;
    list.querySelectorAll("[data-day]").forEach((button) => button.addEventListener("click", () => selectDay(Number(button.dataset.day))));
  }

  function renderHeader() {
    const day = currentDay();
    $("#phase-label").textContent = day.phase;
    $("#day-title").textContent = `第${String(day.day).padStart(2, "0")}天`;
    $("#day-meta").textContent = `${day.dateDisplay} · ${day.weekday} · 计划${day.hours}小时`;
    $("#day-percent").textContent = `${dayProgress(day.day)}%`;
    $("#prev-day").disabled = day.day === 1;
    $("#next-day").disabled = day.day === data.days.length;

    const completed = data.days.filter((item) => isDayComplete(item.day)).length;
    const overall = Math.round(data.days.reduce((sum, item) => sum + dayProgress(item.day), 0) / data.days.length);
    $("#overall-percent").textContent = `${overall}%`;
    $("#overall-bar").style.width = `${overall}%`;
    $("#overall-detail").textContent = `${completed} / ${data.days.length} 天完成`;
    $("#mistake-badge").textContent = String(allMistakes().length);
  }

  function renderPlan() {
    const day = currentDay();
    const progress = state.progress[day.day] || {};
    $("#subject-grid").innerHTML = day.subjects.map((subject) => {
      const meta = subjectMeta[subject.id];
      const done = Boolean(progress.subjects?.[subject.id]);
      return `
        <article class="subject-card" style="--subject-color:${meta.color}">
          <div class="subject-head">
            <div class="subject-title"><span class="subject-icon">${meta.icon}</span><div><h3>${escapeHtml(subject.name)}</h3><span>建议 ${subject.hours} 小时</span></div></div>
            <button class="subject-check ${done ? "is-done" : ""}" type="button" data-subject="${subject.id}" aria-label="${done ? "取消完成" : "标记完成"}">✓</button>
          </div>
          <p class="subject-task">${escapeHtml(subject.task)}</p>
          <p class="acceptance"><strong>验收：</strong>${escapeHtml(subject.check)}</p>
        </article>`;
    }).join("");
    $$("[data-subject]").forEach((button) => button.addEventListener("click", () => toggleSubject(button.dataset.subject)));

    $("#sentence-focus").textContent = day.sentence.focus || "";
    $("#sentence-en").textContent = day.sentence.en || "";
    $("#sentence-zh").textContent = day.sentence.zh || "";
    $("#sentence-questions").innerHTML = (day.sentence.questions || []).map((question) => `<li>${escapeHtml(question)}</li>`).join("");
    $("#sentence-zh").classList.add("is-hidden");
    $("#sentence-questions").classList.add("is-hidden");
    $("#sentence-reveal").textContent = "显示译文与练习";
    $("#review-loss").value = progress.review?.loss || "";
    $("#review-next").value = progress.review?.next || "";
  }

  function toggleSubject(subjectId) {
    const dayNumber = state.selectedDay;
    const progress = state.progress[dayNumber] ||= {};
    progress.subjects ||= {};
    progress.subjects[subjectId] = !progress.subjects[subjectId];
    saveState();
    renderAll();
  }

  function setReviewField(field, value) {
    const progress = state.progress[state.selectedDay] ||= {};
    progress.review ||= {};
    progress.review[field] = value;
    saveState();
  }

  function resetWordSession() {
    wordIndex = 0;
    wordOrder = currentDay().words.map((_, index) => index);
    answerShown = false;
    mistakeReviewQueue = null;
  }

  function activeWordEntry() {
    if (mistakeReviewQueue) return mistakeReviewQueue[wordIndex] || mistakeReviewQueue[0];
    const day = currentDay();
    const actualIndex = wordOrder[wordIndex] ?? 0;
    return { ...day.words[actualIndex], day: day.day, index: actualIndex };
  }

  function renderDictation() {
    const day = currentDay();
    if (!wordOrder.length && !mistakeReviewQueue) resetWordSession();
    const entry = activeWordEntry();
    if (!entry) {
      $("#card-prompt").textContent = "错词已经复习完成";
      $("#answer-label").classList.add("is-hidden");
      $("#check-answer").classList.add("is-hidden");
      $("#reveal-answer").classList.add("is-hidden");
      $("#rating-actions").classList.add("is-hidden");
      return;
    }
    const sessionLength = mistakeReviewQueue?.length || wordOrder.length;
    $("#vocab-note").textContent = mistakeReviewQueue ? `全局错词复习 · 当前来自第${entry.day}天` : day.vocabNote;
    $("#word-index").textContent = String(wordIndex + 1);
    $("#word-total").textContent = String(sessionLength);
    $("#word-progress-bar").style.width = `${((wordIndex + 1) / sessionLength) * 100}%`;

    const entryProgress = state.progress[entry.day] || {};
    const dayStatuses = entryProgress.words || {};
    const learnedWords = entryProgress.learnedWords || {};
    const isLearning = state.mode === "learn";
    $("#known-label").textContent = isLearning ? "已学" : "会";
    $("#unknown-label").textContent = isLearning ? "重点" : "不会";
    $("#known-count").textContent = String(isLearning ? Object.keys(learnedWords).length : Object.values(dayStatuses).filter((status) => status === "known").length);
    $("#unknown-count").textContent = String(Object.values(dayStatuses).filter((status) => status === "unknown").length);

    const isZhEn = state.mode === "zh-en";
    $("#card-kicker").textContent = isLearning ? "看英文，直接记住中文" : (isZhEn ? "根据中文写英文" : "看到英文回忆中文");
    $("#card-prompt").textContent = isZhEn ? entry.meaning : entry.word;
    $("#answer-label").classList.toggle("is-hidden", !isZhEn || isLearning);
    $("#check-answer").classList.toggle("is-hidden", !isZhEn || isLearning);
    $("#reveal-answer").classList.toggle("is-hidden", isLearning);
    $("#word-answer").value = "";
    $("#answer-result").textContent = isLearning ? entry.meaning : "";
    $("#answer-result").className = isLearning ? "answer-result learning-meaning" : "answer-result is-hidden";
    $("#rating-actions").classList.toggle("is-hidden", !isLearning);
    $("#mark-unknown").textContent = isLearning ? "不认识，加入错词" : "还不会";
    $("#mark-known").textContent = isLearning ? "认识，下一词" : "会了，下一词";
    $("#keyboard-tip").textContent = isLearning ? "键盘：Enter 认识并下一词" : "键盘：Enter 检查/下一词，空格显示答案";
    $("#reveal-answer").textContent = isZhEn ? "不会，显示答案" : "显示释义";
    answerShown = isLearning;
    if (isZhEn && state.activeView === "dictation") setTimeout(() => $("#word-answer").focus(), 30);
  }

  function normalizeAnswer(value) {
    return value.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
  }

  function revealCurrent(message, wrong = false) {
    const entry = activeWordEntry();
    if (!entry) return;
    answerShown = true;
    const result = $("#answer-result");
    result.textContent = message || `${entry.word} · ${entry.meaning}`;
    result.className = `answer-result ${wrong ? "is-wrong" : ""}`;
    $("#rating-actions").classList.remove("is-hidden");
  }

  function checkAnswer() {
    const entry = activeWordEntry();
    if (!entry) return;
    const value = normalizeAnswer($("#word-answer").value);
    if (!value) {
      showToast("先输入你默写的单词");
      return;
    }
    const correct = value === normalizeAnswer(entry.word);
    revealCurrent(correct ? `正确：${entry.word}` : `正确答案：${entry.word} · ${entry.meaning}`, !correct);
  }

  function rateWord(status) {
    const entry = activeWordEntry();
    if (!entry) return;
    const progress = state.progress[entry.day] ||= {};
    progress.words ||= {};
    progress.words[entry.word] = status;
    saveState();
    advanceWord(1);
    renderHeader();
    renderDayList($("#day-search").value);
  }

  function finishLearningWord(needsReview) {
    const entry = activeWordEntry();
    if (!entry) return;
    const progress = state.progress[entry.day] ||= {};
    progress.learnedWords ||= {};
    progress.learnedWords[entry.word] = true;
    if (needsReview) {
      progress.words ||= {};
      progress.words[entry.word] = "unknown";
    }
    saveState();
    advanceWord(1);
    renderHeader();
    renderDayList($("#day-search").value);
  }

  function advanceWord(delta) {
    const length = mistakeReviewQueue?.length || wordOrder.length;
    if (!length) return;
    wordIndex += delta;
    if (wordIndex < 0) wordIndex = 0;
    if (wordIndex >= length) {
      if (mistakeReviewQueue) {
        mistakeReviewQueue = allMistakes();
        wordIndex = 0;
        if (!mistakeReviewQueue.length) showToast("很好，错词已经全部清空");
      } else {
        wordIndex = 0;
        showToast(state.mode === "learn" ? "本日75词已学习一轮，可以开始默写" : "本日75词已完成一轮");
      }
    }
    renderDictation();
  }

  function shuffleWords() {
    if (mistakeReviewQueue) {
      mistakeReviewQueue.sort(() => Math.random() - .5);
    } else {
      wordOrder.sort(() => Math.random() - .5);
    }
    wordIndex = 0;
    renderDictation();
    showToast("单词顺序已打乱");
  }

  function activeSentenceEntry() {
    const sentences = currentDay().sentenceDrill || [];
    if (sentenceIndex >= sentences.length) sentenceIndex = 0;
    return sentences[sentenceIndex];
  }

  function normalizeSentence(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function showSentenceAnswer(message, wrong = false) {
    const entry = activeSentenceEntry();
    if (!entry) return;
    sentenceAnswerShown = true;
    const result = $("#sentence-drill-result");
    result.textContent = message || entry.en;
    result.className = `sentence-result ${wrong ? "is-wrong" : ""}`;
    $("#sentence-next").classList.remove("is-hidden");
  }

  function checkSentenceAnswer() {
    const entry = activeSentenceEntry();
    const value = $("#sentence-drill-answer").value;
    if (!value.trim()) return showToast("先凭记忆写出英文句子");
    const correct = normalizeSentence(value) === normalizeSentence(entry.en);
    showSentenceAnswer(correct ? `正确：${entry.en}` : `对照订正：${entry.en}`, !correct);
  }

  function nextSentenceDrill() {
    const entry = activeSentenceEntry();
    if (!entry) return;
    const progress = state.progress[state.selectedDay] ||= {};
    progress.english ||= {};
    progress.english.sentences ||= {};
    progress.english.sentences[entry.en] = "known";
    sentenceIndex += 1;
    if (sentenceIndex >= currentDay().sentenceDrill.length) {
      sentenceIndex = 0;
      progress.english.checks ||= {};
      progress.english.checks.sentences = true;
      showToast("今日5句已完成，晚上再默写一遍");
    }
    saveState();
    renderEnglishTraining();
    renderHeader();
    renderDayList($("#day-search").value);
  }

  function renderEnglishTraining() {
    const day = currentDay();
    const progress = state.progress[day.day] ||= {};
    progress.english ||= {};
    progress.english.checks ||= {};

    const sentence = activeSentenceEntry();
    $("#sentence-drill-index").textContent = String(sentenceIndex + 1);
    $("#sentence-drill-prompt").textContent = sentence?.zh || "";
    $("#sentence-drill-answer").value = "";
    $("#sentence-drill-result").className = "sentence-result is-hidden";
    $("#sentence-next").classList.add("is-hidden");
    sentenceAnswerShown = false;

    $("#training-reading-title").textContent = `${day.sentence.focus || "精读"} · 先读后译`;
    $("#training-reading-en").textContent = day.sentence.en || "";
    $("#training-reading-zh").textContent = day.sentence.zh || "";
    $("#training-reading-questions").innerHTML = (day.sentence.questions || []).map((question) => `<li>${escapeHtml(question)}</li>`).join("");
    $("#training-reading-answer").classList.add("is-hidden");
    $("#training-reading-reveal").textContent = "显示译文与问题";

    $("#paper-label").textContent = day.pastPaper.label;
    $("#paper-duration").textContent = day.pastPaper.duration;
    $("#paper-task").textContent = day.pastPaper.task;
    $("#paper-review").textContent = day.pastPaper.review;
    $("#paper-link").href = day.pastPaper.url;

    $("#writing-type").textContent = day.writing.type;
    $("#writing-target").textContent = day.writing.target;
    $("#writing-prompt").textContent = day.writing.prompt;
    $("#writing-outline").textContent = day.writing.outline;
    $("#writing-sample").textContent = day.writing.sample;
    $("#writing-sample").classList.add("is-hidden");
    $("#writing-reveal").textContent = "完成后查看参考范文";
    $("#writing-draft").value = progress.english.draft || "";

    const completed = ["sentences", "paper", "writing"].filter((key) => progress.english.checks[key]).length;
    $("#english-completion").textContent = `${completed} / 3 完成`;
    $$('[data-english-check]').forEach((button) => {
      const done = Boolean(progress.english.checks[button.dataset.englishCheck]);
      button.classList.toggle("is-done", done);
      button.setAttribute("aria-label", done ? "取消完成" : "标记完成");
    });
  }

  function toggleEnglishCheck(part) {
    const progress = state.progress[state.selectedDay] ||= {};
    progress.english ||= {};
    progress.english.checks ||= {};
    progress.english.checks[part] = !progress.english.checks[part];
    saveState();
    renderEnglishTraining();
    renderHeader();
    renderDayList($("#day-search").value);
  }

  function saveWritingDraft(value) {
    const progress = state.progress[state.selectedDay] ||= {};
    progress.english ||= {};
    progress.english.draft = value;
    saveState();
  }

  function renderMistakes() {
    const mistakes = allMistakes();
    const list = $("#mistake-list");
    $("#mistake-empty").classList.toggle("is-hidden", mistakes.length > 0);
    $("#review-mistakes").disabled = mistakes.length === 0;
    list.innerHTML = mistakes.map((item) => `
      <div class="mistake-row">
        <strong>${escapeHtml(item.word)}</strong>
        <span>${escapeHtml(item.meaning)} · D${String(item.day).padStart(2, "0")}</span>
        <button type="button" data-clear-word="${escapeHtml(item.word)}" data-clear-day="${item.day}">已掌握</button>
      </div>`).join("");
    list.querySelectorAll("[data-clear-word]").forEach((button) => button.addEventListener("click", () => {
      const day = Number(button.dataset.clearDay);
      state.progress[day].words[button.dataset.clearWord] = "known";
      saveState();
      renderAll();
    }));
  }

  function startMistakeReview() {
    mistakeReviewQueue = allMistakes();
    if (!mistakeReviewQueue.length) return showToast("暂时没有错词");
    wordIndex = 0;
    state.activeView = "dictation";
    setActiveView("dictation");
  }

  function setActiveView(view) {
    state.activeView = view;
    $$(".tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $$(`[data-view-panel]`).forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
    if (view === "dictation") renderDictation();
    if (view === "english") renderEnglishTraining();
    if (view === "mistakes") renderMistakes();
    saveState();
  }

  function selectDay(dayNumber) {
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > data.days.length) return;
    state.selectedDay = dayNumber;
    sentenceIndex = 0;
    resetWordSession();
    saveState();
    renderAll();
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetCurrentDay() {
    if (!window.confirm(`确定清空第${state.selectedDay}天的勾选、默写记录和复盘吗？`)) return;
    delete state.progress[state.selectedDay];
    resetWordSession();
    saveState();
    renderAll();
    showToast("本日记录已重置");
  }

  function openSidebar() {
    $("#sidebar").classList.add("is-open");
    $("#sidebar-backdrop").classList.add("is-visible");
    $("#menu-button").setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    $("#sidebar").classList.remove("is-open");
    $("#sidebar-backdrop").classList.remove("is-visible");
    $("#menu-button").setAttribute("aria-expanded", "false");
  }

  function renderAll() {
    renderHeader();
    renderDayList($("#day-search")?.value || "");
    renderPlan();
    renderEnglishTraining();
    renderMistakes();
    setActiveView(state.activeView);
  }

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const register = (tool) => Promise.resolve(context.registerTool(tool)).catch(() => {});
    register({
      name: "navigate_to_study_day",
      title: "切换学习日期",
      description: "切换到73天考研计划中的指定天数，并更新页面内容。",
      inputSchema: { type: "object", properties: { day: { type: "integer", minimum: 1, maximum: 73 } }, required: ["day"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        if (!Number.isInteger(input?.day) || input.day < 1 || input.day > 73) throw new Error("day必须是1到73的整数");
        selectDay(input.day);
        return { day: input.day, date: currentDay().date, phase: currentDay().phase };
      }
    });
    register({
      name: "mark_study_subject",
      title: "标记科目完成状态",
      description: "将指定天数的一门科目标记为完成或未完成，并更新学习进度。",
      inputSchema: {
        type: "object",
        properties: { day: { type: "integer", minimum: 1, maximum: 73 }, subject: { type: "string", enum: ["math", "english", "econ", "politics"] }, completed: { type: "boolean" } },
        required: ["day", "subject", "completed"], additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!Number.isInteger(input?.day) || input.day < 1 || input.day > 73) throw new Error("day必须是1到73的整数");
        if (!["math", "english", "econ", "politics"].includes(input.subject) || typeof input.completed !== "boolean") throw new Error("科目或状态无效");
        const progress = state.progress[input.day] ||= {};
        progress.subjects ||= {};
        progress.subjects[input.subject] = input.completed;
        saveState();
        renderAll();
        return { day: input.day, subject: input.subject, completed: input.completed, dayProgress: dayProgress(input.day) };
      }
    });
    register({
      name: "read_study_progress",
      title: "读取学习进度",
      description: "读取73天计划的总进度、完成天数和当前错词数量。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        const completedDays = data.days.filter((day) => isDayComplete(day.day)).length;
        const overallPercent = Math.round(data.days.reduce((sum, day) => sum + dayProgress(day.day), 0) / data.days.length);
        return { completedDays, totalDays: 73, overallPercent, mistakeCount: allMistakes().length, selectedDay: state.selectedDay };
      }
    });
  }

  $$(".tab").forEach((tab) => tab.addEventListener("click", () => setActiveView(tab.dataset.view)));
  $$("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    $$("[data-mode]").forEach((item) => item.classList.toggle("is-active", item === button));
    saveState();
    renderDictation();
  }));
  $("#prev-day").addEventListener("click", () => selectDay(state.selectedDay - 1));
  $("#next-day").addEventListener("click", () => selectDay(state.selectedDay + 1));
  $("#today-button").addEventListener("click", () => selectDay(defaultDay()));
  $("#reset-button").addEventListener("click", resetCurrentDay);
  $("#day-search").addEventListener("input", (event) => renderDayList(event.target.value));
  $("#sentence-reveal").addEventListener("click", () => {
    const target = $("#sentence-zh");
    target.classList.toggle("is-hidden");
    $("#sentence-questions").classList.toggle("is-hidden", target.classList.contains("is-hidden"));
    $("#sentence-reveal").textContent = target.classList.contains("is-hidden") ? "显示译文与练习" : "隐藏译文与练习";
  });
  $("#review-loss").addEventListener("input", (event) => setReviewField("loss", event.target.value));
  $("#review-next").addEventListener("input", (event) => setReviewField("next", event.target.value));
  $("#check-answer").addEventListener("click", checkAnswer);
  $("#reveal-answer").addEventListener("click", () => revealCurrent());
  $("#mark-known").addEventListener("click", () => state.mode === "learn" ? finishLearningWord(false) : rateWord("known"));
  $("#mark-unknown").addEventListener("click", () => state.mode === "learn" ? finishLearningWord(true) : rateWord("unknown"));
  $("#previous-word").addEventListener("click", () => advanceWord(-1));
  $("#next-word").addEventListener("click", () => advanceWord(1));
  $("#shuffle-words").addEventListener("click", shuffleWords);
  $("#review-mistakes").addEventListener("click", startMistakeReview);
  $$('[data-english-check]').forEach((button) => button.addEventListener("click", () => toggleEnglishCheck(button.dataset.englishCheck)));
  $("#sentence-check").addEventListener("click", checkSentenceAnswer);
  $("#sentence-show").addEventListener("click", () => showSentenceAnswer());
  $("#sentence-next").addEventListener("click", nextSentenceDrill);
  $("#sentence-drill-answer").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    if (sentenceAnswerShown) nextSentenceDrill();
    else checkSentenceAnswer();
  });
  $("#training-reading-reveal").addEventListener("click", () => {
    const panel = $("#training-reading-answer");
    panel.classList.toggle("is-hidden");
    $("#training-reading-reveal").textContent = panel.classList.contains("is-hidden") ? "显示译文与问题" : "隐藏译文与问题";
  });
  $("#writing-reveal").addEventListener("click", () => {
    const sample = $("#writing-sample");
    sample.classList.toggle("is-hidden");
    $("#writing-reveal").textContent = sample.classList.contains("is-hidden") ? "完成后查看参考范文" : "隐藏参考范文";
  });
  $("#writing-draft").addEventListener("input", (event) => saveWritingDraft(event.target.value));
  $("#menu-button").addEventListener("click", openSidebar);
  $("#sidebar-backdrop").addEventListener("click", closeSidebar);
  $("#word-answer").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (state.mode === "learn") finishLearningWord(false);
    else if (!answerShown) checkAnswer();
    else rateWord("known");
  });
  document.addEventListener("keydown", (event) => {
    if (state.activeView !== "dictation" || event.target.matches("input, textarea")) return;
    if (event.code === "Space" && state.mode !== "learn") { event.preventDefault(); revealCurrent(); }
  });

  wordOrder = currentDay().words.map((_, index) => index);
  $$("[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  renderAll();
  registerWebMCP();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
