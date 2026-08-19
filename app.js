// 画面遷移・イベント配線・DOM描画を統括する。
const App = (() => {
  let allData = null;
  let session = null;

  const screens = ['loading', 'home', 'mode-config', 'quiz', 'result', 'stats', 'about'];

  function showScreen(name) {
    for (const s of screens) {
      const el = document.getElementById(`screen-${s}`);
      el.hidden = s !== name;
    }
    window.scrollTo(0, 0);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  async function init() {
    showScreen('loading');
    allData = await DataLoader.load();
    wireHome();
    wireHeader();
    wireQuiz();
    wireResult();
    wireBackButtons();
    await refreshHomeReviewCount();
    showScreen('home');
  }

  // ---------- ホーム ----------
  function wireHome() {
    document.querySelectorAll('.mode-card').forEach((btn) => {
      btn.addEventListener('click', () => onModeSelected(btn.dataset.mode));
    });
    document.getElementById('about-link').addEventListener('click', () => showScreen('about'));
  }

  async function refreshHomeReviewCount() {
    const missed = await Storage.getMissedQuestionIds();
    const valid = missed.filter((id) => allData.questions.has(id));
    const desc = document.getElementById('review-count-desc');
    const reviewCard = document.querySelector('.mode-card[data-mode="review"]');
    if (valid.length === 0) {
      desc.textContent = '不正解の問題はまだありません';
      reviewCard.disabled = true;
    } else {
      desc.textContent = `直近の不正解 ${valid.length}問を再出題`;
      reviewCard.disabled = false;
    }
  }

  function onModeSelected(mode) {
    if (mode === 'honban') renderHonbanConfig();
    else if (mode === 'random') renderRandomConfig();
    else if (mode === 'category') renderCategoryConfig();
    else if (mode === 'review') startReview();
  }

  function showModeConfig(title, bodyEl) {
    document.getElementById('mode-config-title').textContent = title;
    const body = document.getElementById('mode-config-body');
    body.innerHTML = '';
    body.appendChild(bodyEl);
    showScreen('mode-config');
  }

  function renderHonbanConfig() {
    const list = document.createElement('div');
    list.className = 'config-list';
    for (const exam of allData.examList) {
      const item = document.createElement('button');
      item.className = 'config-item';
      item.innerHTML = `<span>${escapeHtml(exam.label)}</span><span class="count-badge">${exam.count}問</span>`;
      item.addEventListener('click', () => beginSession(Modes.honban(allData, exam.examId)));
      list.appendChild(item);
    }
    showModeConfig('本番モード：試験回を選択', list);
  }

  function renderRandomConfig() {
    const list = document.createElement('div');
    list.className = 'config-list';
    for (const count of [10, 30, 50]) {
      const item = document.createElement('button');
      item.className = 'config-item';
      item.innerHTML = `<span>${count}問</span>`;
      item.addEventListener('click', () => beginSession(Modes.random(allData, count)));
      list.appendChild(item);
    }
    showModeConfig('ランダムモード：問題数を選択', list);
  }

  function renderCategoryConfig() {
    const list = document.createElement('div');
    list.className = 'config-list';
    for (const cat of allData.categories) {
      const item = document.createElement('button');
      item.className = 'config-item';
      const badge = cat.needsSupplement ? '<span class="badge">要補完</span>' : '';
      item.innerHTML = `<span>${escapeHtml(cat.label)} ${badge}</span><span class="count-badge">${cat.questionCount}問</span>`;
      item.addEventListener('click', () => beginSession(Modes.category(allData, cat.categoryId)));
      list.appendChild(item);
    }
    showModeConfig('分野別モード：分野を選択', list);
  }

  async function startReview() {
    const result = await Modes.review(allData);
    beginSession(result);
  }

  // ---------- クイズ実行 ----------
  function beginSession(built) {
    if (!built.queue || built.queue.length === 0) {
      showModeConfig('出題できる問題がありません', emptyNote());
      return;
    }
    built.meta.startedAt = new Date().toISOString();
    session = QuizEngine.createSession(built.queue, allData.questions, built.meta);
    renderQuestion();
    showScreen('quiz');
  }

  function emptyNote() {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = '該当する問題がありませんでした。';
    return p;
  }

  function wireQuiz() {
    document.getElementById('quiz-next-btn').addEventListener('click', onNextClicked);
  }

  function renderQuestion() {
    const q = QuizEngine.currentQuestion(session);

    document.getElementById('quiz-progress-text').textContent = QuizEngine.progressText(session);
    document.getElementById('quiz-score-text').textContent = `正解 ${session.score}`;

    const passageEl = document.getElementById('quiz-passage');
    if (q.passage) {
      passageEl.textContent = q.passage;
      passageEl.hidden = false;
    } else {
      passageEl.hidden = true;
    }

    document.getElementById('quiz-prompt').textContent = q.prompt;

    const choicesEl = document.getElementById('quiz-choices');
    choicesEl.innerHTML = '';
    q.choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn' + (q.type === 'true_false' ? ' tf' : '');
      btn.textContent = choice;
      btn.addEventListener('click', () => onChoiceClicked(idx));
      choicesEl.appendChild(btn);
    });

    document.getElementById('quiz-feedback').hidden = true;
  }

  async function onChoiceClicked(idx) {
    const q = QuizEngine.currentQuestion(session);
    const buttons = Array.from(document.querySelectorAll('#quiz-choices .choice-btn'));
    buttons.forEach((b) => { b.disabled = true; });

    const result = await QuizEngine.answer(session, idx);

    buttons.forEach((b) => {
      if (b.textContent === result.correctAnswer) b.classList.add('correct');
      else if (b === buttons[idx]) b.classList.add('incorrect');
    });

    document.getElementById('quiz-score-text').textContent = `正解 ${session.score}`;

    const feedback = document.getElementById('quiz-feedback');
    const resultEl = document.getElementById('quiz-feedback-result');
    resultEl.textContent = result.isCorrect ? '正解' : '不正解';
    resultEl.className = 'feedback-result ' + (result.isCorrect ? 'is-correct' : 'is-incorrect');
    document.getElementById('quiz-feedback-explanation').textContent = q.explanation || '';
    document.getElementById('quiz-feedback-supplement').hidden = !q.needsSupplement;
    document.getElementById('quiz-next-btn').textContent = QuizEngine.isLast(session) ? '結果を見る' : '次へ';
    feedback.hidden = false;
  }

  async function onNextClicked() {
    if (QuizEngine.isLast(session)) {
      await finishSession();
    } else {
      QuizEngine.advance(session);
      renderQuestion();
    }
  }

  async function finishSession() {
    const record = await QuizEngine.finish(session);
    renderResult(record);
    showScreen('result');
    await refreshHomeReviewCount();
  }

  // ---------- 結果画面 ----------
  function wireResult() {
    document.getElementById('result-home-btn').addEventListener('click', () => showScreen('home'));
    document.getElementById('result-retry-btn').addEventListener('click', async () => {
      const built = await Modes.rebuild(allData, session.meta);
      beginSession(built);
    });
  }

  function renderResult(record) {
    document.getElementById('result-score').textContent = `${record.correctCount} / ${record.questionCount}`;

    const breakdown = QuizEngine.categoryBreakdown(session);
    const catMap = new Map(allData.categories.map((c) => [c.categoryId, c.label]));
    const breakdownEl = document.getElementById('result-breakdown');
    breakdownEl.innerHTML = '';
    for (const [categoryId, e] of breakdown.entries()) {
      const row = document.createElement('div');
      row.className = 'result-row';
      const label = catMap.get(categoryId) || categoryId;
      row.innerHTML = `<span>${escapeHtml(label)}</span><span>${e.correct} / ${e.total}</span>`;
      breakdownEl.appendChild(row);
    }
  }

  // ---------- 統計・ヘッダー ----------
  function wireHeader() {
    document.getElementById('nav-home').addEventListener('click', () => showScreen('home'));
    document.getElementById('nav-stats').addEventListener('click', async () => {
      await StatsView.render(allData);
      showScreen('stats');
    });
  }

  function wireBackButtons() {
    document.querySelectorAll('[data-back="home"]').forEach((btn) => {
      btn.addEventListener('click', () => showScreen('home'));
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
});
