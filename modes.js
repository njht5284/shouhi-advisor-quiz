// 各モードの出題キュー構築ロジック。
const Modes = (() => {
  const HONBAN_TIME_LIMIT_SECONDS = 120 * 60; // 実際の試験と同じ120分

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function honban(allData, examId) {
    const ids = (allData.byExam.get(examId) || []).slice();
    return {
      queue: ids,
      meta: {
        mode: 'honban',
        label: `本番モード（${DataLoader.examLabel(examId)}）`,
        examId,
        timeLimitSeconds: HONBAN_TIME_LIMIT_SECONDS,
      },
    };
  }

  function random(allData, count) {
    const all = Array.from(allData.questions.keys());
    const queue = shuffle(all).slice(0, Math.min(count, all.length));
    return { queue, meta: { mode: 'random', label: `ランダムモード（${count}問）`, count } };
  }

  function category(allData, categoryId) {
    const ids = allData.byCategory.get(categoryId) || [];
    const queue = shuffle(ids);
    const catInfo = allData.categories.find((c) => c.categoryId === categoryId);
    const label = catInfo ? catInfo.label : categoryId;
    return { queue, meta: { mode: 'category', label: `分野別モード（${label}）`, categoryId } };
  }

  // 一度でも間違えたことがある小問(blank)を正答率が低い順に、出題単位(unit)の
  // IDへ変換して返す（重複除去、順序は弱点順を維持）。穴埋め型の小問は、
  // その小問を含む大問（グループ）ごと1件として扱う（同じ大問の他の小問が
  // まだ弱点でなくても、文脈のため一緒に出題する）。
  async function weakUnitIds(allData) {
    const weakBlankIds = await Storage.getWeakQuestions();
    const seen = new Set();
    const units = [];
    for (const blankId of weakBlankIds) {
      const unitId = allData.blankToUnit.get(blankId);
      if (!unitId || !allData.questions.has(unitId) || seen.has(unitId)) continue;
      seen.add(unitId);
      units.push(unitId);
    }
    return units;
  }

  // 復習対象を出題単位に直したときの件数と、そのうち復習時期が来ているものの件数。
  // ホーム画面のカードと、復習モードの設定画面の説明文に出す。
  async function weakUnitStats(allData) {
    const units = await weakUnitIds(allData);
    const dueBlankIds = await Storage.getDueWeakQuestionIds();
    const dueUnits = new Set();
    for (const blankId of dueBlankIds) {
      const unitId = allData.blankToUnit.get(blankId);
      if (unitId && allData.questions.has(unitId)) dueUnits.add(unitId);
    }
    return { total: units.length, due: units.filter((id) => dueUnits.has(id)).length };
  }

  async function review(allData, count) {
    const units = await weakUnitIds(allData);
    const queue = units.slice(0, Math.min(count, units.length));
    return { queue, meta: { mode: 'review', label: `復習モード（${count}問）`, count } };
  }

  // 未回答・解答回数が少ない出題単位を「手薄な順」に返す。
  // 穴埋め型は大問ごと出題するため、含まれる小問の平均解答回数で評価する
  // （5問中1問だけ未回答の大問より、5問とも未回答の大問を先に出すため）。
  // 同点のものは毎回違う顔ぶれになるよう、並べ替え前にシャッフルする。
  async function coverageUnits(allData) {
    const counts = await Storage.getAttemptCounts();
    const scored = [];
    for (const [unitId, unit] of allData.questions) {
      const blankIds = unit.kind === 'group' ? unit.blanks.map((b) => b.id) : [unit.id];
      let attempts = 0;
      let unanswered = 0;
      for (const id of blankIds) {
        const n = counts.get(id) || 0;
        attempts += n;
        if (n === 0) unanswered += 1;
      }
      scored.push({
        unitId,
        score: attempts / blankIds.length,
        unansweredBlanks: unanswered,
        totalBlanks: blankIds.length,
      });
    }
    const shuffled = shuffle(scored);
    shuffled.sort((a, b) => a.score - b.score);
    return shuffled;
  }

  async function coverage(allData, count) {
    const units = await coverageUnits(allData);
    const queue = units.slice(0, Math.min(count, units.length)).map((u) => u.unitId);
    return { queue, meta: { mode: 'coverage', label: `未着手モード（${count}問）`, count } };
  }

  async function rebuild(allData, meta) {
    if (meta.mode === 'honban') return honban(allData, meta.examId);
    if (meta.mode === 'random') return random(allData, meta.count);
    if (meta.mode === 'category') return category(allData, meta.categoryId);
    if (meta.mode === 'review') return review(allData, meta.count);
    if (meta.mode === 'coverage') return coverage(allData, meta.count);
    throw new Error(`unknown mode: ${meta.mode}`);
  }

  return { honban, random, category, review, coverage, weakUnitIds, weakUnitStats, coverageUnits, rebuild, shuffle };
})();
