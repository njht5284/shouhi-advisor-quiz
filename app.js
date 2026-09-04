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

  // 問題文(text)中の誤り箇所(phrases)を <span class="wrong-phrase"> で囲んだHTMLを返す。
  // 各フレーズの最初の出現箇所のみ対象。重なる範囲は先に見つかった方を優先する。
  function highlightWrongPhrases(text, phrases) {
    const spans = [];
    for (const phrase of phrases) {
      const start = text.indexOf(phrase);
      if (start === -1) continue;
      spans.push({ start, end: start + phrase.length });
    }
    spans.sort((a, b) => a.start - b.start);

    const merged = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span.start < last.end) continue; // 重複範囲はスキップ
      merged.push(span);
    }

    let html = '';
    let cursor = 0;
    for (const span of merged) {
      html += escapeHtml(text.slice(cursor, span.start));
      html += `<span class="wrong-phrase">${escapeHtml(text.slice(span.start, span.end))}</span>`;
      cursor = span.end;
    }
    html += escapeHtml(text.slice(cursor));
    return html;
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
    await refreshResumeBanner();
    await refreshPriorityCategories();
    showScreen('home');
  }

  // 3回以上挑戦した分野に限定した「優先して学習すべき分野」トップ3をホーム画面に表示する。
  // タップすると設定画面を経由せず、直接その分野の分野別モードを開始する。
  async function refreshPriorityCategories() {
    const rows = await StatsView.getPriorityCategories(allData, { minAttempts: 3, limit: 3 });
    const block = document.getElementById('priority-block');
    const list = document.getElementById('priority-list');
    list.innerHTML = '';

    if (rows.length === 0) {
      block.hidden = true;
      return;
    }

    for (const row of rows) {
      const item = document.createElement('button');
      item.className = 'priority-item';
      item.innerHTML = `<span>${escapeHtml(row.label)}</span><span class="priority-item-accuracy">正答率 ${row.accuracy}%</span>`;
      item.addEventListener('click', () => beginSession(Modes.category(allData, row.categoryId)));
      list.appendChild(item);
    }
    block.hidden = false;
  }

  // ---------- ホーム ----------
  function wireHome() {
    document.querySelectorAll('.mode-card').forEach((btn) => {
      btn.addEventListener('click', () => onModeSelected(btn.dataset.mode));
    });
    document.getElementById('about-link').addEventListener('click', () => showScreen('about'));
    document.getElementById('resume-btn').addEventListener('click', resumeSession);
    document.getElementById('resume-dismiss-btn').addEventListener('click', async () => {
      await Storage.clearInProgressSession();
      await refreshResumeBanner();
    });
  }

  // 進行中セッション（直近1件のみ）の保存内容から、ホーム画面の再開バナーを更新する。
  async function refreshResumeBanner() {
    const saved = await Storage.getInProgressSession();
    const banner = document.getElementById('resume-banner');
    const valid = saved && saved.queue.every((id) => allData.questions.has(id))
      && saved.index >= 0 && saved.index < saved.queue.length;

    if (!valid) {
      if (saved) await Storage.clearInProgressSession(); // 無効なデータは片付けておく
      banner.hidden = true;
      return;
    }

    document.getElementById('resume-label').textContent = saved.meta.label;
    document.getElementById('resume-progress').textContent = `問 ${saved.index + 1} / ${saved.queue.length}`;
    banner.hidden = false;
  }

  async function resumeSession() {
    const saved = await Storage.getInProgressSession();
    const restored = saved && QuizEngine.restore(saved, allData.questions);
    if (!restored) {
      await refreshResumeBanner();
      return;
    }
    session = restored;
    renderQuestion();
    showScreen('quiz');
    startTimerTick();
  }

  // 現在のセッションの進行状況をIndexedDBへ保存する（回答・次へ、のたびに呼ぶ）。
  // ページを閉じる/リロードする等で中断しても、直前の状態から再開できるようにするため。
  async function persistProgress() {
    await Storage.saveInProgressSession(QuizEngine.snapshot(session));
  }

  async function refreshHomeReviewCount() {
    const units = await Modes.weakUnitIds(allData);
    const desc = document.getElementById('review-count-desc');
    const reviewCard = document.querySelector('.mode-card[data-mode="review"]');
    if (units.length === 0) {
      desc.textContent = '不正解の問題はまだありません';
      reviewCard.disabled = true;
    } else {
      desc.textContent = `苦手問題 ${units.length}問を復習`;
      reviewCard.disabled = false;
    }
  }

  function onModeSelected(mode) {
    if (mode === 'honban') renderHonbanConfig();
    else if (mode === 'random') renderRandomConfig();
    else if (mode === 'category') renderCategoryConfig();
    else if (mode === 'review') renderReviewConfig();
  }

  function showModeConfig(title, bodyEl) {
    document.getElementById('mode-config-title').textContent = title;
    const body = document.getElementById('mode-config-body');
    body.innerHTML = '';
    body.appendChild(bodyEl);
    showScreen('mode-config');
  }

  // 回答済み件数の内訳: questionId -> 回答済みかどうか の判定に使う一覧を取得する。
  async function getAnsweredIdSet() {
    const results = await Storage.getAllResults();
    return new Set(results.map((r) => r.questionId));
  }

  async function renderHonbanConfig() {
    const answered = await getAnsweredIdSet();
    const list = document.createElement('div');
    list.className = 'config-list';
    for (const exam of allData.examList) {
      const ids = allData.examBlankIds.get(exam.examId) || [];
      const answeredCount = ids.filter((id) => answered.has(id)).length;
      const item = document.createElement('button');
      item.className = 'config-item';
      item.innerHTML = `<span>${escapeHtml(exam.label)}</span><span class="count-badge">${answeredCount}/${exam.count} 回答済み</span>`;
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

  async function renderCategoryConfig() {
    const answered = await getAnsweredIdSet();
    const list = document.createElement('div');
    list.className = 'config-list';
    for (const cat of allData.categories) {
      const ids = allData.categoryBlankIds.get(cat.categoryId) || [];
      const answeredCount = ids.filter((id) => answered.has(id)).length;
      const item = document.createElement('button');
      item.className = 'config-item';
      const badge = cat.needsSupplement ? '<span class="badge">要補完</span>' : '';
      item.innerHTML = `<span>${escapeHtml(cat.label)} ${badge}</span><span class="count-badge">${answeredCount}/${cat.questionCount} 回答済み</span>`;
      item.addEventListener('click', () => beginSession(Modes.category(allData, cat.categoryId)));
      list.appendChild(item);
    }
    showModeConfig('分野別モード：分野を選択', list);
  }

  async function renderReviewConfig() {
    const poolSize = (await Modes.weakUnitIds(allData)).length;

    const list = document.createElement('div');
    list.className = 'config-list';

    const note = document.createElement('p');
    note.className = 'config-note';
    note.textContent = `対象（一度でも間違えた問題）: ${poolSize}問`;
    list.appendChild(note);

    for (const count of [10, 30, 50]) {
      const item = document.createElement('button');
      item.className = 'config-item';
      item.innerHTML = `<span>${count}問</span><span class="count-badge">正答率が低い順</span>`;
      item.addEventListener('click', async () => beginSession(await Modes.review(allData, count)));
      list.appendChild(item);
    }
    showModeConfig('復習モード：問題数を選択', list);
  }

  // ---------- クイズ実行 ----------
  async function beginSession(built) {
    if (!built.queue || built.queue.length === 0) {
      showModeConfig('出題できる問題がありません', emptyNote());
      return;
    }
    built.meta.startedAt = new Date().toISOString();
    session = QuizEngine.createSession(built.queue, allData.questions, built.meta);
    // 新しいセッションを開始するので、直近1件だけ保持する「続きから」データは上書きする。
    await persistProgress();
    renderQuestion();
    showScreen('quiz');
    startTimerTick();
  }

  function emptyNote() {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = '該当する問題がありませんでした。';
    return p;
  }

  const BLANK_LABELS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク'];
  let groupSelections = null; // 穴埋めグループ回答中: blanks と同じ順の選択インデックス配列（未選択はnull）

  function wireQuiz() {
    document.getElementById('quiz-next-btn').addEventListener('click', onNextClicked);
    document.getElementById('group-submit-btn').addEventListener('click', onGroupSubmit);
    document.getElementById('quiz-pause-btn').addEventListener('click', onPauseClicked);
  }

  // ---------- 本番モードの制限時間タイマー ----------
  let timerIntervalId = null;
  let timerTickCount = 0;

  function startTimerTick() {
    if (timerIntervalId) clearInterval(timerIntervalId);
    if (!session || !session.timer) return;
    timerTickCount = 0;
    timerIntervalId = setInterval(async () => {
      // クイズ画面から離れた/セッションが終わったら自動的に停止する。
      if (!session || !session.timer || document.getElementById('screen-quiz').hidden) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
        return;
      }
      QuizEngine.tickTimer(session);
      updateTimerDisplay();
      timerTickCount += 1;
      if (timerTickCount % 10 === 0) await persistProgress(); // 10秒ごとに保存
    }, 1000);
  }

  function updateTimerDisplay() {
    const row = document.getElementById('quiz-timer-row');
    if (!session || !session.timer) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    const textEl = document.getElementById('quiz-timer-text');
    const timeUp = session.timer.remainingSeconds <= 0;
    textEl.textContent = timeUp
      ? `${QuizEngine.formatTime(0)}（制限時間になりました）`
      : QuizEngine.formatTime(session.timer.remainingSeconds);
    textEl.classList.toggle('time-up', timeUp);

    const pauseBtn = document.getElementById('quiz-pause-btn');
    pauseBtn.textContent = session.timer.paused ? '再開' : '一時停止';
    pauseBtn.classList.toggle('is-paused', session.timer.paused);
  }

  async function onPauseClicked() {
    QuizEngine.togglePause(session);
    updateTimerDisplay();
    await persistProgress();
  }

  function renderQuestion() {
    const q = QuizEngine.currentQuestion(session);

    document.getElementById('quiz-progress-text').textContent = QuizEngine.progressText(session);
    document.getElementById('quiz-score-text').textContent = `正解 ${session.score}`;
    updateTimerDisplay();

    const passageEl = document.getElementById('quiz-passage');
    if (q.passage) {
      passageEl.textContent = q.passage;
      passageEl.hidden = false;
    } else {
      passageEl.hidden = true;
    }

    document.getElementById('quiz-next-btn').hidden = true;

    if (q.kind === 'group') {
      document.getElementById('quiz-single').hidden = true;
      document.getElementById('quiz-group').hidden = false;
      renderGroupQuestion(q);
    } else {
      document.getElementById('quiz-group').hidden = true;
      document.getElementById('quiz-single').hidden = false;
      renderSingleQuestion(q);
    }
  }

  // ---------- 正誤判定型（小問1つ） ----------
  function renderSingleQuestion(q) {
    document.getElementById('quiz-prompt').textContent = q.prompt;

    const choicesEl = document.getElementById('quiz-choices');
    choicesEl.innerHTML = '';
    q.choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn tf';
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

    // 正答が「× 誤り」の設問は、問題文中の誤り箇所を赤字でハイライトする。
    if (q.correctAnswer.startsWith('×') && q.wrongPhrases && q.wrongPhrases.length > 0) {
      document.getElementById('quiz-prompt').innerHTML = highlightWrongPhrases(q.prompt, q.wrongPhrases);
    }

    const feedback = document.getElementById('quiz-feedback');
    const resultEl = document.getElementById('quiz-feedback-result');
    resultEl.textContent = result.isCorrect ? '正解' : '不正解';
    resultEl.className = 'feedback-result ' + (result.isCorrect ? 'is-correct' : 'is-incorrect');
    document.getElementById('quiz-feedback-explanation').textContent = q.explanation || '';
    document.getElementById('quiz-feedback-supplement').hidden = !q.needsSupplement;
    feedback.hidden = false;

    await persistProgress();
    showNextButton();
  }

  // ---------- 穴埋め型（大問1つ、【ア】〜【オ】をまとめて解答） ----------
  function renderGroupQuestion(group) {
    groupSelections = new Array(group.blanks.length).fill(null);

    const listEl = document.getElementById('quiz-blank-list');
    listEl.innerHTML = '';

    group.blanks.forEach((blank, blankIdx) => {
      const item = document.createElement('div');
      item.className = 'blank-item';

      const label = document.createElement('div');
      label.className = 'blank-label';
      label.textContent = `【${BLANK_LABELS[blankIdx] || blankIdx + 1}】`;
      item.appendChild(label);

      if (blank.prompt) {
        const promptEl = document.createElement('div');
        const isNegative = blank.prompt.includes('適当でない');
        promptEl.className = 'blank-prompt' + (isNegative ? ' is-negative' : '');
        promptEl.textContent = blank.prompt;
        item.appendChild(promptEl);
      }

      const choicesEl = document.createElement('div');
      choicesEl.className = 'blank-choices';
      blank.choices.forEach((choice, choiceIdx) => {
        const btn = document.createElement('button');
        btn.className = 'blank-choice-btn';
        btn.textContent = choice;
        btn.addEventListener('click', () => onBlankChoiceClicked(blankIdx, choiceIdx));
        choicesEl.appendChild(btn);
      });
      item.appendChild(choicesEl);
      listEl.appendChild(item);
    });

    const submitBtn = document.getElementById('group-submit-btn');
    submitBtn.disabled = true;
    submitBtn.hidden = false;

    const feedbackEl = document.getElementById('quiz-group-feedback');
    feedbackEl.hidden = true;
    feedbackEl.innerHTML = '';
  }

  function onBlankChoiceClicked(blankIdx, choiceIdx) {
    groupSelections[blankIdx] = choiceIdx;
    const item = document.querySelectorAll('#quiz-blank-list .blank-item')[blankIdx];
    item.querySelectorAll('.blank-choice-btn').forEach((b, i) => {
      b.classList.toggle('selected', i === choiceIdx);
    });
    document.getElementById('group-submit-btn').disabled = groupSelections.some((v) => v === null);
  }

  async function onGroupSubmit() {
    document.querySelectorAll('#quiz-blank-list .blank-choice-btn').forEach((b) => { b.disabled = true; });
    document.getElementById('group-submit-btn').hidden = true;

    const results = await QuizEngine.answerGroup(session, groupSelections);

    const items = document.querySelectorAll('#quiz-blank-list .blank-item');
    results.forEach((r, blankIdx) => {
      items[blankIdx].querySelectorAll('.blank-choice-btn').forEach((b) => {
        if (b.textContent === r.correctAnswer) b.classList.add('correct');
        else if (b.classList.contains('selected') && !r.isCorrect) b.classList.add('incorrect');
      });
    });

    document.getElementById('quiz-score-text').textContent = `正解 ${session.score}`;

    const feedbackEl = document.getElementById('quiz-group-feedback');
    feedbackEl.innerHTML = '';
    results.forEach((r, i) => {
      const item = document.createElement('div');
      item.className = 'blank-feedback-item ' + (r.isCorrect ? 'is-correct' : 'is-incorrect');
      const answerLine = r.isCorrect
        ? `正答: ${escapeHtml(r.correctAnswer)}`
        : `あなたの回答: ${escapeHtml(r.chosen)}　正答: ${escapeHtml(r.correctAnswer)}`;
      const supplementHtml = r.needsSupplement
        ? '<div class="blank-feedback-supplement">※この分野は提供講義資料に該当箇所が見当たらず、解説は一般知識に基づく参考情報です。</div>'
        : '';
      item.innerHTML = `
        <div class="blank-feedback-head">【${BLANK_LABELS[i] || i + 1}】 ${r.isCorrect ? '正解' : '不正解'}</div>
        <div class="blank-feedback-answer">${answerLine}</div>
        <div class="blank-feedback-explanation">${escapeHtml(r.explanation || '')}</div>
        ${supplementHtml}
      `;
      feedbackEl.appendChild(item);
    });
    feedbackEl.hidden = false;

    await persistProgress();
    showNextButton();
  }

  function showNextButton() {
    const btn = document.getElementById('quiz-next-btn');
    btn.textContent = QuizEngine.isLast(session) ? '結果を見る' : '次へ';
    btn.hidden = false;
  }

  async function onNextClicked() {
    if (QuizEngine.isLast(session)) {
      await finishSession();
    } else {
      QuizEngine.advance(session);
      await persistProgress();
      renderQuestion();
    }
  }

  async function finishSession() {
    const record = await QuizEngine.finish(session);
    await Storage.clearInProgressSession(); // 完了したので「続きから」の対象ではなくなる
    renderResult(record);
    showScreen('result');
    await refreshHomeReviewCount();
    await refreshResumeBanner();
    await refreshPriorityCategories();
  }

  // ---------- 結果画面 ----------
  function wireResult() {
    document.getElementById('result-home-btn').addEventListener('click', () => showScreen('home'));
    document.getElementById('result-retry-btn').addEventListener('click', async () => {
      const built = await Modes.rebuild(allData, session.meta);
      beginSession(built);
    });
    document.getElementById('result-mistakes-btn').addEventListener('click', () => {
      const mistakeUnitIds = getMistakeUnitIds(session);
      if (mistakeUnitIds.length === 0) return;
      beginSession({
        queue: mistakeUnitIds,
        meta: {
          mode: 'mistakes',
          label: `今回の間違い（${session.meta.label}）`,
          startedAt: new Date().toISOString(),
        },
      });
    });
  }

  // 直前に終えたセッションの回答のうち、間違えた小問(blank)を出題単位(unit)へ
  // 変換して返す（重複除去、出題順を維持）。穴埋め型の小問は、それを含む
  // 大問（グループ）ごと1件として扱う（復習モードと同じ考え方）。
  function getMistakeUnitIds(finishedSession) {
    const seen = new Set();
    const units = [];
    for (const a of finishedSession.answers) {
      if (a.isCorrect) continue;
      const unitId = allData.blankToUnit.get(a.questionId);
      if (!unitId || !allData.questions.has(unitId) || seen.has(unitId)) continue;
      seen.add(unitId);
      units.push(unitId);
    }
    return units;
  }

  function renderResult(record) {
    document.getElementById('result-score').textContent = `${record.correctCount} / ${record.questionCount}`;

    // 「間違い抽出」セッション自体には、それを同一条件で再現する意味のある
    // 「もう一度（同じ条件で）」の対象がないため、そのボタンは隠す。
    document.getElementById('result-retry-btn').hidden = session.meta.mode === 'mistakes';

    const mistakeCount = getMistakeUnitIds(session).length;
    const mistakesBtn = document.getElementById('result-mistakes-btn');
    if (mistakeCount > 0) {
      mistakesBtn.textContent = `今回間違えた${mistakeCount}問だけもう一度`;
      mistakesBtn.hidden = false;
    } else {
      mistakesBtn.hidden = true;
    }

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
    document.getElementById('nav-home').addEventListener('click', async () => {
      await refreshResumeBanner();
      await refreshPriorityCategories();
      showScreen('home');
    });
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
