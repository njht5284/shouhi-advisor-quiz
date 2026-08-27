// クイズ進行のロジック（状態管理・採点）。DOM描画はapp.js側で行う。
//
// 出題単位(unit)には2種類ある:
//   kind:'single' … 正誤判定型の小問1つ（従来通り、選んだ瞬間に採点）
//   kind:'group'  … 穴埋め型の大問1つ（【ア】〜【オ】をまとめて解答・採点）
// 採点・統計・復習キューは、グループの場合も内部的には小問(blank)単位で記録する。
const QuizEngine = (() => {
  function createSession(queue, questionsMap, meta) {
    return {
      queue,
      questionsMap,
      meta,
      index: 0,
      score: 0,
      totalBlanks: queue.reduce((sum, id) => sum + unitBlankCount(questionsMap.get(id)), 0),
      answers: [], // {questionId, categoryId, isCorrect}
    };
  }

  function unitBlankCount(unit) {
    return unit.kind === 'group' ? unit.blanks.length : 1;
  }

  function currentQuestion(session) {
    const id = session.queue[session.index];
    return session.questionsMap.get(id);
  }

  // kind:'single' 用。choiceIndex は選んだ選択肢のインデックス。
  async function answer(session, choiceIndex) {
    const q = currentQuestion(session);
    const chosen = q.choices[choiceIndex];
    const isCorrect = chosen === q.correctAnswer;
    if (isCorrect) session.score += 1;
    session.answers.push({ questionId: q.id, categoryId: q.categoryId, isCorrect });
    await Storage.recordAnswer(q, isCorrect);
    return { isCorrect, correctAnswer: q.correctAnswer, chosen };
  }

  // kind:'group' 用。choiceIndexes は blanks と同じ順番の配列。
  async function answerGroup(session, choiceIndexes) {
    const group = currentQuestion(session);
    const results = [];
    for (let i = 0; i < group.blanks.length; i += 1) {
      const blank = group.blanks[i];
      const chosen = blank.choices[choiceIndexes[i]];
      const isCorrect = chosen === blank.correctAnswer;
      if (isCorrect) session.score += 1;
      session.answers.push({ questionId: blank.id, categoryId: blank.categoryId, isCorrect });
      await Storage.recordAnswer(blank, isCorrect);
      results.push({
        subNumber: blank.subNumber,
        prompt: blank.prompt,
        isCorrect,
        correctAnswer: blank.correctAnswer,
        chosen,
        explanation: blank.explanation,
        needsSupplement: blank.needsSupplement,
      });
    }
    return results;
  }

  function isLast(session) {
    return session.index >= session.queue.length - 1;
  }

  function advance(session) {
    session.index += 1;
  }

  function progressText(session) {
    return `問 ${session.index + 1} / ${session.queue.length}`;
  }

  function categoryBreakdown(session) {
    const map = new Map();
    for (const a of session.answers) {
      if (!map.has(a.categoryId)) map.set(a.categoryId, { total: 0, correct: 0 });
      const e = map.get(a.categoryId);
      e.total += 1;
      if (a.isCorrect) e.correct += 1;
    }
    return map;
  }

  // 進行中セッションの保存用スナップショット（questionsMapは含めない。allDataから復元可能なため）。
  function snapshot(session) {
    return {
      queue: session.queue,
      index: session.index,
      score: session.score,
      totalBlanks: session.totalBlanks,
      answers: session.answers,
      meta: session.meta,
      savedAt: new Date().toISOString(),
    };
  }

  // 保存されたスナップショットからセッションを復元する。
  // queueに含まれるIDが1つでも現在のデータに存在しなければ null を返す
  // （データが更新された等でスナップショットが無効な場合の安全策）。
  function restore(saved, questionsMap) {
    if (!saved || !Array.isArray(saved.queue) || saved.queue.length === 0) return null;
    if (saved.index < 0 || saved.index >= saved.queue.length) return null;
    if (!saved.queue.every((id) => questionsMap.has(id))) return null;
    return {
      queue: saved.queue,
      questionsMap,
      meta: saved.meta,
      index: saved.index,
      score: saved.score,
      totalBlanks: saved.totalBlanks,
      answers: saved.answers,
    };
  }

  async function finish(session) {
    const record = {
      mode: session.meta.mode,
      modeLabel: session.meta.label,
      startedAt: session.meta.startedAt,
      finishedAt: new Date().toISOString(),
      questionCount: session.totalBlanks,
      correctCount: session.score,
      examId: session.meta.examId || null,
      categoryId: session.meta.categoryId || null,
    };
    await Storage.saveSession(record);
    return record;
  }

  return {
    createSession,
    currentQuestion,
    answer,
    answerGroup,
    isLast,
    advance,
    progressText,
    categoryBreakdown,
    snapshot,
    restore,
    finish,
  };
})();
