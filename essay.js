// 第2次試験（論文・面接）対策：構成練習・想起カード・面接カード・要確認リスト。
// データは data/essays.json（第1次の questions.json とは別ファイル）。
// 学習記録は IndexedDB の第2次専用の保存領域に保存し、第1次の記録には触れない。
const Essay = (() => {
  let ctx = null;          // { allData, showScreen, escapeHtml }
  let data = null;         // essays.json の中身
  let loadError = false;

  const SLOT_SHORT = { intro: '序論', body1: '本論①', body2: '本論②', concl: '結論' };
  const OPTIONAL = 'optional';
  const RECALL_DECK_LIMIT = 20;
  const IV_PREFIX = 'iv:';  // 面接カードの間隔反復記録のキー接頭辞

  // 構成練習の状態
  let build = null;        // { topic, order: [cardId], assign: Map(cardId -> slotId) }
  let lastResult = null;   // 直前の採点結果（コピー・再挑戦用）
  // 想起カード・面接カードの状態
  let recall = null;       // { kind: 'card'|'iv', items: [id], idx, revealed, requeued: Set, tally }
  let refBackScreen = 'home';
  let listRenderer = null; // 一覧画面を描き直す関数（関連問題から戻ったとき用）

  const esc = (s) => ctx.escapeHtml(s);

  // ---------- 初期化 ----------
  async function init(context) {
    ctx = context;
    try {
      const res = await fetch('./data/essays.json');
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch (e) {
      loadError = true;
    }
    wire();
    await refreshHome();
  }

  function wire() {
    document.querySelectorAll('[data-essay]').forEach((btn) => {
      btn.addEventListener('click', () => onHomeCard(btn.dataset.essay));
    });
    document.getElementById('essay-build-back').addEventListener('click', showTopicList);
    document.getElementById('essay-grade-btn').addEventListener('click', grade);
    document.getElementById('essay-copy-btn').addEventListener('click', (ev) => copyText(buildCopyText(), ev.currentTarget));
    document.getElementById('essay-retry-btn').addEventListener('click', () => startBuild(lastResult.topic.topicId));
    document.getElementById('essay-list-btn').addEventListener('click', showTopicList);
    document.getElementById('recall-quit').addEventListener('click', finishRecall);
    document.getElementById('interview-edit-back').addEventListener('click', showInterviewList);
    document.getElementById('essay-ref-back').addEventListener('click', () => {
      if (refBackScreen === 'essay-list' && listRenderer) listRenderer();
      ctx.showScreen(refBackScreen);
    });
  }

  function onHomeCard(kind) {
    if (loadError || !data) return;
    if (kind === 'build') showTopicList();
    else if (kind === 'recall') showRecallDecks();
    else if (kind === 'interview') showInterviewList();
    else if (kind === 'flags') showFlags();
  }

  // ---------- データの参照 ----------
  function card(id) { return data.cards[id]; }

  function slotsOf(entry) { return entry.slots.filter((s) => s !== OPTIONAL); }
  function isDummyEntry(entry) { return entry.slots.length === 0; }
  function isOptionalEntry(entry) { return entry.slots.includes(OPTIONAL); }

  // 想起カードの対象：どこかの論題で「書くべき論点」として使われているカード（ダミーは除く）
  function recallCardIds() {
    const ids = new Set();
    for (const t of data.topics) {
      for (const e of t.cards) if (!isDummyEntry(e) && !card(e.id).dummy) ids.add(e.id);
    }
    return [...ids];
  }

  function topicById(id) { return data.topics.find((t) => t.topicId === id); }

  function bestByTopic(results) {
    const map = new Map();
    for (const r of results) {
      const e = map.get(r.topicId) || { best: 0, last: null, runs: 0 };
      e.runs += 1;
      if (r.score > e.best) e.best = r.score;
      if (!e.last || r.at > e.last.at) e.last = r;
      map.set(r.topicId, e);
    }
    return map;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- ホーム（第2次タブ） ----------
  async function refreshHome() {
    const block = document.getElementById('essay-priority');
    const list = document.getElementById('essay-priority-list');
    if (!block) return;
    list.innerHTML = '';
    if (loadError || !data) {
      block.hidden = false;
      list.innerHTML = '<p class="config-note">第2次試験のデータを読み込めませんでした。通信できる状態で一度開き直してください。</p>';
      return;
    }

    const states = await Storage.getRecallStates();
    const ids = recallCardIds();
    const due = ids.filter((id) => Storage.isRecallDue(states.get(id))).length;
    document.getElementById('recall-count-desc').textContent = due > 0
      ? `復習時期 ${due}枚 / 全${ids.length}枚`
      : `全${ids.length}枚・今日の復習は完了`;

    const flags = await Storage.getFlags();
    document.getElementById('flag-count-desc').textContent = flags.length > 0
      ? `要確認 ${flags.length}件`
      : '気になったカードを書き出す';

    // 今日の優先：①復習時期の想起カード ②まだ解いていない中核論題、または最高点が最も低い論題
    const items = [];
    if (due > 0) {
      items.push({ label: `想起カード：復習時期 ${due}枚`, sub: '開始', action: () => startRecallDeck('due') });
    }
    const best = bestByTopic(await Storage.getEssayResults());
    const untouched = data.topics.find((t) => t.tier === 'core' && !best.has(t.topicId));
    if (untouched) {
      items.push({ label: `構成練習：${untouched.label}`, sub: '未着手', action: () => startBuild(untouched.topicId) });
    } else {
      const weakest = data.topics
        .filter((t) => best.has(t.topicId))
        .sort((a, b) => best.get(a.topicId).best - best.get(b.topicId).best)[0];
      if (weakest && best.get(weakest.topicId).best < 100) {
        items.push({ label: `構成練習：${weakest.label}`, sub: `最高 ${best.get(weakest.topicId).best}点`, action: () => startBuild(weakest.topicId) });
      }
    }
    for (const it of items) {
      const btn = document.createElement('button');
      btn.className = 'priority-item is-essay';
      btn.innerHTML = `<span>${esc(it.label)}</span><span class="priority-item-accuracy">${esc(it.sub)}</span>`;
      btn.addEventListener('click', it.action);
      list.appendChild(btn);
    }
    block.hidden = items.length === 0;
  }

  // 一覧画面（タイトル＋任意の中身）を表示する共通処理
  function showList(title, bodyEl, renderer) {
    document.getElementById('essay-list-title').textContent = title;
    const body = document.getElementById('essay-list-body');
    body.innerHTML = '';
    body.appendChild(bodyEl);
    listRenderer = renderer || null;
    ctx.showScreen('essay-list');
  }

  function el(tag, className, html) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---------- 構成練習：論題一覧 ----------
  async function showTopicList() {
    const best = bestByTopic(await Storage.getEssayResults());
    const wrap = el('div', 'config-list');
    const groups = [
      { tier: 'core', title: '中核：日本産業協会の過去問（本番と同じ形式）' },
      { tier: 'applied', title: '応用：国民生活センターの過去問（指定語句つき）' },
    ];
    for (const g of groups) {
      wrap.appendChild(el('div', 'essay-group-title', esc(g.title)));
      for (const t of data.topics.filter((x) => x.tier === g.tier)) {
        const b = best.get(t.topicId);
        const badge = b
          ? `<span class="count-badge${b.best === 100 ? ' is-done' : ''}">${b.runs}回・最高 ${b.best}点</span>`
          : '<span class="count-badge">未着手</span>';
        const item = el('button', 'config-item topic-item',
          `<span class="topic-item-main"><span class="topic-item-label">${esc(t.label)}</span>`
          + `<span class="config-item-sub">${esc(t.summary.slice(0, 42))}…</span></span>${badge}`);
        item.addEventListener('click', () => startBuild(t.topicId));
        wrap.appendChild(item);
      }
    }
    wrap.appendChild(el('p', 'config-note',
      '論題は出題の要旨を独自にまとめたものです。原文は手元の問題用紙で確認してください。'));
    showList('構成練習：論題を選ぶ', wrap);
  }

  // ---------- 構成練習：振り分け ----------
  function startBuild(topicId) {
    const topic = topicById(topicId);
    build = { topic, order: shuffle(topic.cards.map((c) => c.id)), assign: new Map() };
    renderBuild();
    ctx.showScreen('essay-build');
  }

  function renderBuild() {
    const t = build.topic;
    const head = document.getElementById('essay-build-head');
    const asks = t.asks.map((a) => `<li>${esc(a)}</li>`).join('');
    const kw = t.keywords.length
      ? `<div class="essay-keywords"><span class="essay-kw-label">指定語句</span>${t.keywords.map((k) => `<span class="essay-kw">${esc(k)}</span>`).join('')}</div>`
      : '';
    head.innerHTML = `<div class="essay-topic-label">${esc(t.label)}</div>`
      + `<div class="essay-summary">${esc(t.summary)}</div>`
      + `<div class="essay-asks-title">問われていること</div><ul class="essay-asks">${asks}</ul>${kw}`;

    document.getElementById('essay-slot-legend').innerHTML =
      '書くべき論点だけを選び、置く段落をタップしてください。もう一度タップすると外れます。';

    const wrap = document.getElementById('essay-build-cards');
    wrap.innerHTML = '';
    for (const id of build.order) {
      const c = card(id);
      const row = el('div', 'build-card');
      row.dataset.cardId = id;
      row.appendChild(el('div', 'build-card-title', esc(c.title)));
      const slots = el('div', 'build-slots');
      for (const s of data.slots) {
        const b = el('button', 'slot-btn', esc(SLOT_SHORT[s.id]));
        b.dataset.slot = s.id;
        b.addEventListener('click', () => toggleAssign(id, s.id));
        slots.appendChild(b);
      }
      row.appendChild(slots);
      wrap.appendChild(row);
    }
    syncBuildUi();
  }

  function toggleAssign(cardId, slotId) {
    if (build.assign.get(cardId) === slotId) build.assign.delete(cardId);
    else build.assign.set(cardId, slotId);
    syncBuildUi();
  }

  function syncBuildUi() {
    document.querySelectorAll('#essay-build-cards .build-card').forEach((row) => {
      const chosen = build.assign.get(row.dataset.cardId);
      row.classList.toggle('is-selected', Boolean(chosen));
      row.querySelectorAll('.slot-btn').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.slot === chosen);
        b.setAttribute('aria-pressed', String(b.dataset.slot === chosen));
      });
    });
    const n = build.assign.size;
    const btn = document.getElementById('essay-grade-btn');
    btn.textContent = n > 0 ? `採点する（${n}枚を配置）` : '採点する';
    btn.disabled = n === 0;
  }

  // ---------- 構成練習：採点 ----------
  // 必須カード：正しい段落に置けば得点。置かなければ「選び漏れ」、別の段落なら「段落違い」。
  // 任意カード：置かなくても減点なし。置いた場合は段落だけを確認する。
  // ダミー（この論題では書くべきでない論点）：置くと「不要な論点」として1枚につき1点減点。
  // 点数 = (正しく置けた必須カード − 不要な論点) ÷ 必須カード数 × 100（0〜100）。
  async function grade() {
    const t = build.topic;
    const missed = []; const dummies = []; const wrongSlot = []; const ok = [];
    let required = 0; let requiredOk = 0;
    for (const entry of t.cards) {
      const chosen = build.assign.get(entry.id);
      const allowed = slotsOf(entry);
      if (isDummyEntry(entry)) {
        if (chosen) dummies.push({ entry, chosen });
        continue;
      }
      const optional = isOptionalEntry(entry);
      if (!optional) required += 1;
      if (!chosen) {
        if (!optional) missed.push({ entry });
        continue;
      }
      if (allowed.includes(chosen)) {
        ok.push({ entry, chosen });
        if (!optional) requiredOk += 1;
      } else {
        wrongSlot.push({ entry, chosen });
      }
    }
    const score = Math.max(0, Math.round(((requiredOk - dummies.length) / required) * 100));
    lastResult = { topic: t, score, missed, dummies, wrongSlot, ok, required, requiredOk };
    await Storage.saveEssayResult({
      topicId: t.topicId,
      at: new Date().toISOString(),
      score,
      missed: missed.map((x) => x.entry.id),
      dummies: dummies.map((x) => x.entry.id),
      wrongSlot: wrongSlot.map((x) => x.entry.id),
    });
    await renderResult();
    ctx.showScreen('essay-result');
  }

  function slotNames(ids) { return ids.map((s) => SLOT_SHORT[s]).join('・'); }

  async function renderResult() {
    const r = lastResult;
    const body = document.getElementById('essay-result-body');
    const flags = new Set((await Storage.getFlags()).map((f) => f.cardId));
    body.innerHTML = '';

    const scoreEl = el('div', 'essay-score',
      `<span class="essay-score-num">${r.score}</span><span class="essay-score-unit">点</span>`
      + `<div class="essay-score-sub">${esc(r.topic.label)}　必須論点 ${r.requiredOk} / ${r.required}</div>`);
    body.appendChild(scoreEl);

    const section = (title, cls, rows) => {
      if (rows.length === 0) return;
      const s = el('div', `essay-result-section ${cls}`);
      s.appendChild(el('h3', 'essay-result-title', `${esc(title)}（${rows.length}）`));
      rows.forEach((row) => s.appendChild(row));
      body.appendChild(s);
    };

    section('選び漏れ', 'is-missed', r.missed.map(({ entry }) =>
      resultCard(entry.id, `置くべき段落：${slotNames(slotsOf(entry))}`, flags)));
    section('不要な論点（減点）', 'is-dummy', r.dummies.map(({ entry }) => {
      const c = card(entry.id);
      const reason = c.dummy && c.dummyReason ? c.dummyReason : 'この論題の問いには直接答えない論点です。限られた字数は問われていることに使います。';
      return resultCard(entry.id, reason, flags, true);
    }));
    section('段落違い', 'is-wrong', r.wrongSlot.map(({ entry, chosen }) =>
      resultCard(entry.id, `あなた：${SLOT_SHORT[chosen]} → 模範：${slotNames(slotsOf(entry))}`, flags)));

    if (r.ok.length > 0) {
      const det = el('details', 'essay-result-section is-ok');
      det.appendChild(el('summary', 'essay-result-title', `正しく置けた論点（${r.ok.length}）`));
      r.ok.forEach(({ entry, chosen }) => det.appendChild(resultCard(entry.id, `${SLOT_SHORT[chosen]}`, flags)));
      body.appendChild(det);
    }

    const model = el('div', 'essay-model');
    model.appendChild(el('h3', 'essay-result-title', '模範構成（800字以内の目安）'));
    let total = 0;
    for (const m of r.topic.model) {
      total += m.chars;
      model.appendChild(el('div', 'essay-model-row',
        `<div class="essay-model-head"><span>${esc(SLOT_SHORT[m.slot])}</span><span>${m.chars}字</span></div>`
        + `<div class="essay-model-gist">${esc(m.gist)}</div>`));
    }
    model.appendChild(el('div', 'config-note', `合計 約${total}字。手書きの演習では、この配分で序論から順に書き出してください。`));
    body.appendChild(model);
  }

  // 結果画面・想起カードで使う、カード1枚分の表示（要旨・根拠・要確認・関連問題）
  function resultCard(cardId, note, flags, hideGist) {
    const c = card(cardId);
    const box = el('div', 'essay-card');
    box.appendChild(el('div', 'essay-card-title', esc(c.title)));
    if (note) box.appendChild(el('div', 'essay-card-note', esc(note)));
    if (!hideGist) box.appendChild(el('div', 'essay-card-gist', esc(c.gist)));
    box.appendChild(cardFooter(cardId, flags, 'essay-result'));
    return box;
  }

  function cardFooter(cardId, flags, backScreen) {
    const c = card(cardId);
    const foot = el('div', 'essay-card-foot');
    const basis = c.effective ? `${c.basis}（${c.effective}）` : c.basis;
    const src = el('a', 'essay-card-basis', esc(basis));
    src.href = c.sourceUrl;
    src.target = '_blank';
    src.rel = 'noopener';
    foot.appendChild(src);
    const actions = el('div', 'essay-card-actions');
    (c.related1st || []).forEach((uid, i) => {
      if (!ctx.allData.questions.has(uid)) return;
      const b = el('button', 'chip-btn', `第1次の関連問題${c.related1st.length > 1 ? i + 1 : ''}`);
      b.addEventListener('click', () => showRef(uid, backScreen));
      actions.appendChild(b);
    });
    const flagBtn = el('button', 'chip-btn flag-btn', flags.has(cardId) ? '要確認 ✓' : '要確認');
    flagBtn.classList.toggle('is-on', flags.has(cardId));
    flagBtn.addEventListener('click', async () => {
      const on = await Storage.toggleFlag(cardId, c.title);
      if (on) flags.add(cardId); else flags.delete(cardId);
      flagBtn.textContent = on ? '要確認 ✓' : '要確認';
      flagBtn.classList.toggle('is-on', on);
    });
    actions.appendChild(flagBtn);
    foot.appendChild(actions);
    return foot;
  }

  // 添削依頼用のテキスト。Claude等のチャットに、手書き答案の写真と一緒に貼り付ける想定。
  function buildCopyText() {
    const t = lastResult.topic;
    const lines = [];
    lines.push(`【論題】${t.label}`);
    lines.push(t.summary);
    if (t.keywords.length) lines.push(`指定語句：${t.keywords.join('、')}`);
    lines.push('');
    lines.push('【形式条件】日本産業協会の消費生活アドバイザー第2次試験（論文）に準じ、60分・800字以内（600字以上が望ましい）。');
    lines.push('');
    lines.push('【採点の観点：問われていること】');
    t.asks.forEach((a) => lines.push(`・${a}`));
    lines.push('');
    lines.push('【採点の観点：必須論点】');
    for (const e of t.cards) {
      if (isDummyEntry(e) || isOptionalEntry(e)) continue;
      const c = card(e.id);
      lines.push(`・${c.title}（${slotNames(slotsOf(e))}）：${c.gist}`);
    }
    const opt = t.cards.filter((e) => isOptionalEntry(e)).map((e) => card(e.id).title);
    if (opt.length) lines.push(`（加点要素：${opt.join('／')}）`);
    lines.push('');
    lines.push('【依頼】添付した手書き答案を読み取り、上の観点に沿って100点満点で採点してください。'
      + '必須論点の有無、構成（序論・本論・結論）、論理の一貫性、字数を確認し、改善点を3つ挙げてください。');
    return lines.join('\n');
  }

  async function copyText(text, button) {
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { done = document.execCommand('copy'); } catch (e2) { done = false; }
      ta.remove();
    }
    if (button) {
      const orig = button.dataset.label || button.textContent;
      button.dataset.label = orig;
      button.textContent = done ? 'コピーしました' : 'コピーできませんでした';
      setTimeout(() => { button.textContent = orig; }, 1800);
    }
    return done;
  }

  // ---------- 想起カード ----------
  async function showRecallDecks() {
    const states = await Storage.getRecallStates();
    const ids = recallCardIds();
    const due = ids.filter((id) => Storage.isRecallDue(states.get(id)));
    const learned = ids.filter((id) => (states.get(id)?.level || 0) >= 3).length;
    const wrap = el('div', 'config-list');
    wrap.appendChild(el('p', 'config-note',
      `見出しを見て要旨を頭の中で言ってから、答えを確認してください。定着（4段階目以上）${learned} / ${ids.length}枚。`));

    const addDeck = (label, sub, fn, disabled) => {
      const item = el('button', 'config-item', `<span>${esc(label)}</span><span class="count-badge">${esc(sub)}</span>`);
      item.disabled = Boolean(disabled);
      item.addEventListener('click', fn);
      wrap.appendChild(item);
    };
    addDeck('復習時期のカード', `${Math.min(due.length, RECALL_DECK_LIMIT)}枚`, () => startRecallDeck('due'), due.length === 0);
    addDeck('すべてのカード（ランダム）', `${ids.length}枚`, () => startRecallDeck('all'));
    wrap.appendChild(el('div', 'essay-group-title', '論題別'));
    for (const t of data.topics) {
      const n = t.cards.filter((e) => !isDummyEntry(e) && !card(e.id).dummy).length;
      addDeck(t.label, `${n}枚`, () => startRecallDeck('topic', t.topicId));
    }
    showList('想起カード：範囲を選ぶ', wrap);
  }

  async function startRecallDeck(mode, topicId) {
    const states = await Storage.getRecallStates();
    let items;
    if (mode === 'due') {
      // 学習済みで期限が来たものを先に、未学習のものを後に並べる
      const ids = recallCardIds().filter((id) => Storage.isRecallDue(states.get(id)));
      const seen = shuffle(ids.filter((id) => states.has(id)));
      const unseen = shuffle(ids.filter((id) => !states.has(id)));
      items = seen.concat(unseen).slice(0, RECALL_DECK_LIMIT);
    } else if (mode === 'topic') {
      items = shuffle(topicById(topicId).cards
        .filter((e) => !isDummyEntry(e) && !card(e.id).dummy).map((e) => e.id));
    } else {
      items = shuffle(recallCardIds());
    }
    if (items.length === 0) return;
    startRecall('card', items);
  }

  function startRecall(kind, items) {
    recall = { kind, items, idx: 0, revealed: false, requeued: new Set(), tally: { good: 0, vague: 0, bad: 0 } };
    renderRecall();
    ctx.showScreen('recall');
  }

  async function renderRecall() {
    const r = recall;
    const id = r.items[r.idx];
    document.getElementById('recall-progress').textContent = `${r.idx + 1} / ${r.items.length}`;
    const cardEl = document.getElementById('recall-card');
    const actions = document.getElementById('recall-actions');
    cardEl.innerHTML = '';
    actions.innerHTML = '';

    if (r.kind === 'card') {
      const c = card(id);
      cardEl.appendChild(el('div', 'recall-label', '論点'));
      cardEl.appendChild(el('div', 'recall-front', esc(c.title)));
      if (r.revealed) {
        cardEl.appendChild(el('div', 'recall-back', esc(c.gist)));
        const flags = new Set((await Storage.getFlags()).map((f) => f.cardId));
        cardEl.appendChild(cardFooter(id, flags, 'recall'));
      }
    } else {
      const q = data.interview.questions.find((x) => x.id === id);
      const answers = await Storage.getInterviewAnswers();
      cardEl.appendChild(el('div', 'recall-label', '面接の質問'));
      cardEl.appendChild(el('div', 'recall-front', esc(q.q)));
      if (r.revealed) {
        const a = answers.get(id);
        if (a && a.lines && a.lines.some((x) => x && x.trim())) {
          const list = el('div', 'iv-answer');
          data.interview.frame.forEach((f, i) => {
            list.appendChild(el('div', 'iv-answer-row',
              `<span class="iv-answer-label">${esc(f)}</span><span>${esc(a.lines[i] || '（未入力）')}</span>`));
          });
          cardEl.appendChild(list);
        } else {
          cardEl.appendChild(el('div', 'recall-back', 'まだ回答の要点が入力されていません。質問一覧から入力してください。'));
        }
      }
    }

    if (!r.revealed) {
      const b = el('button', 'primary-btn', '答えを見る');
      b.addEventListener('click', () => { r.revealed = true; renderRecall(); });
      actions.appendChild(b);
      return;
    }
    const row = el('div', 'rate-row');
    [['good', '言えた'], ['vague', 'あやふや'], ['bad', '言えなかった']].forEach(([key, label]) => {
      const b = el('button', `rate-btn rate-${key}`, label);
      b.addEventListener('click', () => rateCurrent(key));
      row.appendChild(b);
    });
    actions.appendChild(row);
  }

  async function rateCurrent(rating) {
    const r = recall;
    const id = r.items[r.idx];
    await Storage.rateRecall(r.kind === 'iv' ? IV_PREFIX + id : id, rating);
    r.tally[rating] += 1;
    // 言えなかったカードは、このセッションの最後にもう一度だけ出す
    if (rating === 'bad' && !r.requeued.has(id)) {
      r.requeued.add(id);
      r.items.push(id);
    }
    if (r.idx + 1 >= r.items.length) {
      finishRecall();
      return;
    }
    r.idx += 1;
    r.revealed = false;
    renderRecall();
  }

  async function finishRecall() {
    const r = recall;
    const t = r ? r.tally : { good: 0, vague: 0, bad: 0 };
    const wrap = el('div', 'config-list');
    wrap.appendChild(el('div', 'stats-summary',
      `<div class="stat-tile"><div class="stat-value">${t.good}</div><div class="stat-label">言えた</div></div>`
      + `<div class="stat-tile"><div class="stat-value">${t.vague}</div><div class="stat-label">あやふや</div></div>`
      + `<div class="stat-tile"><div class="stat-value">${t.bad}</div><div class="stat-label">言えなかった</div></div>`));
    wrap.appendChild(el('p', 'config-note', '「言えた」カードは次に出るまでの間隔が延び、「言えなかった」カードは翌日にもう一度出ます。'));
    const back = el('button', 'secondary-btn', r && r.kind === 'iv' ? '質問一覧へ' : '想起カードの範囲選択へ');
    back.addEventListener('click', () => (r && r.kind === 'iv' ? showInterviewList() : showRecallDecks()));
    wrap.appendChild(back);
    recall = null;
    await refreshHome();
    showList('おつかれさまでした', wrap);
  }

  // ---------- 面接カード ----------
  async function showInterviewList() {
    const answers = await Storage.getInterviewAnswers();
    const qs = data.interview.questions;
    const filled = qs.filter((q) => answers.get(q.id)?.lines?.some((x) => x && x.trim())).length;
    const wrap = el('div', 'config-list');
    wrap.appendChild(el('p', 'config-note',
      `回答の要点は「${data.interview.frame.join(' → ')}」の3行で入力します。長い文章を覚えると本番で棒読みになるため、要点だけにとどめてください。入力済み ${filled} / ${qs.length}問。入力内容はこの端末の中にだけ保存されます。`));

    const practice = el('button', 'primary-btn', filled > 0 ? `面接の練習を始める（入力済み${filled}問）` : '面接の練習を始める（全問）');
    // 回答を入力済みの質問だけで練習する（未入力の質問では答え合わせができないため）。
    // まだ1問も入力していなければ、問いに慣れる目的で全問を出す。
    practice.addEventListener('click', () => {
      const ready = qs.filter((q) => answers.get(q.id)?.lines?.some((x) => x && x.trim())).map((q) => q.id);
      startRecall('iv', shuffle(ready.length > 0 ? ready : qs.map((q) => q.id)));
    });
    wrap.appendChild(practice);

    for (const q of qs) {
      const done = answers.get(q.id)?.lines?.some((x) => x && x.trim());
      const item = el('button', `config-item${done ? ' is-done' : ''}`,
        `<span>${done ? '<span class="config-done-mark">✓</span>' : ''}${esc(q.q)}</span>`
        + `<span class="count-badge${done ? ' is-done' : ''}">${done ? '入力済み' : '未入力'}</span>`);
      item.addEventListener('click', () => editInterview(q.id));
      wrap.appendChild(item);
    }

    const exp = el('button', 'secondary-btn', '回答をテキストでコピー（バックアップ用）');
    exp.addEventListener('click', async (ev) => {
      const ans = await Storage.getInterviewAnswers();
      const text = qs.map((q) => {
        const a = ans.get(q.id);
        const lines = data.interview.frame.map((f, i) => `  ${f}：${(a && a.lines && a.lines[i]) || ''}`);
        return `■${q.q}\n${lines.join('\n')}`;
      }).join('\n\n');
      copyText(text, ev.currentTarget);
    });
    wrap.appendChild(exp);
    showList('面接カード', wrap);
  }

  async function editInterview(id) {
    const q = data.interview.questions.find((x) => x.id === id);
    const answers = await Storage.getInterviewAnswers();
    const a = answers.get(id);
    const body = document.getElementById('interview-edit-body');
    body.innerHTML = '';
    body.appendChild(el('div', 'recall-front', esc(q.q)));
    body.appendChild(el('p', 'config-note', `ヒント：${esc(q.hint)}`));
    const inputs = data.interview.frame.map((f, i) => {
      const label = el('label', 'iv-field-label', esc(f));
      const ta = document.createElement('textarea');
      ta.className = 'iv-field';
      ta.rows = 2;
      ta.value = (a && a.lines && a.lines[i]) || '';
      ta.placeholder = '要点を1行で';
      body.appendChild(label);
      body.appendChild(ta);
      return ta;
    });
    const save = el('button', 'primary-btn', '保存する');
    save.addEventListener('click', async () => {
      await Storage.saveInterviewAnswer({ id, lines: inputs.map((t) => t.value.trim()) });
      showInterviewList();
    });
    body.appendChild(save);
    ctx.showScreen('interview-edit');
  }

  // ---------- 要確認リスト ----------
  async function showFlags() {
    const flags = await Storage.getFlags();
    flags.sort((a, b) => (a.flaggedAt < b.flaggedAt ? 1 : -1));
    const wrap = el('div', 'config-list');
    if (flags.length === 0) {
      wrap.appendChild(el('p', 'empty-note', '要確認のカードはありません。結果画面や想起カードの「要確認」を押すと、ここに集まります。'));
      showList('要確認リスト', wrap);
      return;
    }
    wrap.appendChild(el('p', 'config-note', '内容に違和感があったカードです。一覧をコピーして、事実確認を依頼してください。'));
    const copy = el('button', 'primary-btn', '一覧をコピー');
    copy.addEventListener('click', (ev) => {
      const text = ['【要確認の論点カード】'].concat(flags.map((f) => {
        const c = card(f.cardId);
        return `・${f.cardId}「${c ? c.title : f.title}」（${f.flaggedAt.slice(0, 10)}）`;
      })).join('\n');
      copyText(text, ev.currentTarget);
    });
    wrap.appendChild(copy);
    for (const f of flags) {
      const c = card(f.cardId);
      const row = el('div', 'config-item flag-row',
        `<span>${esc(c ? c.title : f.title)}<span class="config-item-sub flag-date">${esc(f.flaggedAt.slice(0, 10))}</span></span>`);
      const off = el('button', 'chip-btn', '解除');
      off.addEventListener('click', async () => {
        await Storage.toggleFlag(f.cardId, f.title);
        await refreshHome();
        showFlags();
      });
      row.appendChild(off);
      wrap.appendChild(row);
    }
    showList('要確認リスト', wrap);
  }

  // ---------- 第1次の関連問題（閲覧のみ） ----------
  function showRef(unitId, backScreen) {
    const u = ctx.allData.questions.get(unitId);
    refBackScreen = backScreen;
    const body = document.getElementById('essay-ref-body');
    body.innerHTML = '';
    body.appendChild(el('div', 'essay-ref-meta',
      `${esc(DataLoader.examLabel(u.examId))}　問${u.questionNumber}${u.kind === 'single' ? `-${u.subNumber}` : ''}（閲覧のみ・回答記録には残りません）`));
    if (u.passage && (u.kind === 'group' || u.passage.length < 400)) {
      body.appendChild(el('div', 'quiz-passage', esc(u.passage)));
    }
    const blanks = u.kind === 'group' ? u.blanks : [u];
    for (const b of blanks) {
      const box = el('div', 'essay-card');
      box.appendChild(el('div', 'essay-card-title', esc(b.prompt)));
      box.appendChild(el('div', 'essay-card-note', `正答：${esc(b.correctAnswer)}`));
      if (b.explanation) box.appendChild(el('div', 'essay-card-gist', esc(b.explanation)));
      body.appendChild(box);
    }
    ctx.showScreen('essay-ref');
  }

  // ---------- 第2次の統計 ----------
  async function showStats() {
    if (loadError || !data) return;
    const results = await Storage.getEssayResults();
    const best = bestByTopic(results);
    const states = await Storage.getRecallStates();
    const ids = recallCardIds();
    const learned = ids.filter((id) => (states.get(id)?.level || 0) >= 3).length;
    const touched = ids.filter((id) => states.has(id)).length;

    const wrap = el('div', '');
    wrap.appendChild(el('div', 'stats-summary',
      `<div class="stat-tile"><div class="stat-value">${results.length}</div><div class="stat-label">構成練習の回数</div></div>`
      + `<div class="stat-tile"><div class="stat-value">${touched}/${ids.length}</div><div class="stat-label">想起カード学習済み</div></div>`
      + `<div class="stat-tile"><div class="stat-value">${learned}</div><div class="stat-label">定着したカード</div></div>`));
    wrap.appendChild(el('h3', '', '論題別の最高点'));
    const rows = el('div', 'stats-categories');
    for (const t of data.topics) {
      const b = best.get(t.topicId);
      const pct = b ? b.best : 0;
      rows.appendChild(el('div', 'category-bar-row',
        `<div class="category-bar-label"><span>${esc(t.label)}</span><span>${b ? `${b.best}点（${b.runs}回）` : '未着手'}</span></div>`
        + `<div class="category-bar-track"><div class="category-bar-fill${pct < 70 ? ' weak' : ''}" style="width:${pct}%"></div></div>`));
    }
    wrap.appendChild(rows);
    wrap.appendChild(el('h3', '', '直近の構成練習'));
    const recent = results.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
    const list = el('div', 'stats-sessions');
    if (recent.length === 0) list.appendChild(el('p', 'empty-note', 'まだ記録がありません。'));
    for (const r of recent) {
      const t = topicById(r.topicId);
      list.appendChild(el('div', 'session-row',
        `<span>${esc(r.at.slice(5, 10).replace('-', '/'))}　${esc(t ? t.label : r.topicId)}</span><span>${r.score}点</span>`));
    }
    wrap.appendChild(list);
    showList('第2次試験の統計', wrap);
  }

  return { init, refreshHome, showStats };
})();
