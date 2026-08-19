// 4モードそれぞれの出題キュー構築ロジック。
const Modes = (() => {
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
      meta: { mode: 'honban', label: `本番モード（${DataLoader.examLabel(examId)}）`, examId },
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

  async function review(allData) {
    const missedIds = await Storage.getMissedQuestionIds();
    const valid = missedIds.filter((id) => allData.questions.has(id));
    const queue = shuffle(valid);
    return { queue, meta: { mode: 'review', label: '復習モード' } };
  }

  async function rebuild(allData, meta) {
    if (meta.mode === 'honban') return honban(allData, meta.examId);
    if (meta.mode === 'random') return random(allData, meta.count);
    if (meta.mode === 'category') return category(allData, meta.categoryId);
    if (meta.mode === 'review') return review(allData);
    throw new Error(`unknown mode: ${meta.mode}`);
  }

  return { honban, random, category, review, rebuild, shuffle };
})();
