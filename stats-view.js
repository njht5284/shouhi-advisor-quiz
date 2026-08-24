// 統計画面のレンダリング。
const StatsView = (() => {
  function pct(numerator, denominator) {
    if (!denominator) return 0;
    return Math.round((numerator / denominator) * 100);
  }

  async function render(allData) {
    const results = await Storage.getAllResults();
    const allSessions = await Storage.getRecentSessions(500);

    const totalAttempted = results.length;
    // 学習済み問題数の分母は小問(blank)単位の総数(1,800件)。
    // allData.questions は穴埋め型をグループ化した出題単位のため件数が少ない。
    let totalQuestions = 0;
    for (const ids of allData.examBlankIds.values()) totalQuestions += ids.length;
    const cumulativeAttempts = results.reduce((s, r) => s + r.attemptCount, 0);
    const cumulativeCorrect = results.reduce((s, r) => s + r.correctCount, 0);
    const currentCorrect = results.filter((r) => r.lastResult === 'correct').length;

    const summaryEl = document.getElementById('stats-summary');
    summaryEl.innerHTML = '';
    summaryEl.appendChild(statTile(`${totalAttempted} / ${totalQuestions}`, '学習済み問題数'));
    summaryEl.appendChild(statTile(`${pct(currentCorrect, totalAttempted)}%`, '直近正答率'));
    summaryEl.appendChild(statTile(`${pct(cumulativeCorrect, cumulativeAttempts)}%`, '累計正答率'));

    // 分野別正答率（弱い分野を上位に）
    const byCategory = new Map();
    for (const r of results) {
      if (!byCategory.has(r.categoryId)) byCategory.set(r.categoryId, { attempts: 0, correct: 0 });
      const e = byCategory.get(r.categoryId);
      e.attempts += r.attemptCount;
      e.correct += r.correctCount;
    }
    const catRows = [];
    for (const cat of allData.categories) {
      const e = byCategory.get(cat.categoryId);
      if (!e || e.attempts === 0) continue;
      catRows.push({ label: cat.label, accuracy: pct(e.correct, e.attempts), attempts: e.attempts });
    }
    catRows.sort((a, b) => a.accuracy - b.accuracy);

    const catEl = document.getElementById('stats-categories');
    catEl.innerHTML = '';
    if (catRows.length === 0) {
      catEl.innerHTML = '<p class="empty-note">まだ学習データがありません</p>';
    } else {
      for (const row of catRows) {
        catEl.appendChild(categoryBarRow(row));
      }
    }

    // 直近セッション履歴
    const sessEl = document.getElementById('stats-sessions');
    sessEl.innerHTML = '';
    const recent = allSessions.slice(0, 10);
    if (recent.length === 0) {
      sessEl.innerHTML = '<p class="empty-note">まだ学習履歴がありません</p>';
    } else {
      for (const s of recent) {
        sessEl.appendChild(sessionRow(s));
      }
    }
  }

  function statTile(value, label) {
    const div = document.createElement('div');
    div.className = 'stat-tile';
    div.innerHTML = `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`;
    return div;
  }

  function categoryBarRow(row) {
    const div = document.createElement('div');
    div.className = 'category-bar-row';
    const weakClass = row.accuracy < 60 ? ' weak' : '';
    div.innerHTML = `
      <div class="category-bar-label"><span>${escapeHtml(row.label)}</span><span>${row.accuracy}%（${row.attempts}回）</span></div>
      <div class="category-bar-track"><div class="category-bar-fill${weakClass}" style="width:${row.accuracy}%"></div></div>
    `;
    return div;
  }

  function sessionRow(s) {
    const div = document.createElement('div');
    div.className = 'session-row';
    const date = new Date(s.startedAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    div.innerHTML = `<span>${dateStr} ${escapeHtml(s.modeLabel || s.mode)}</span><span>${s.correctCount} / ${s.questionCount}</span>`;
    return div;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { render };
})();
