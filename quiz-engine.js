// クイズ進行のロジック（状態管理・採点）。DOM描画はapp.js側で行う。
const QuizEngine = (() => {
  function createSession(queue, questionsMap, meta) {
    return {
      queue,
      questionsMap,
      meta,
      index: 0,
      score: 0,
      answers: [], // {questionId, categoryId, isCorrect}
    };
  }

  function currentQuestion(session) {
    const id = session.queue[session.index];
    return session.questionsMap.get(id);
  }

  async function answer(session, choiceIndex) {
    const q = currentQuestion(session);
    const chosen = q.choices[choiceIndex];
    const isCorrect = chosen === q.correctAnswer;
    if (isCorrect) session.score += 1;
    session.answers.push({ questionId: q.id, categoryId: q.categoryId, isCorrect });
    await Storage.recordAnswer(q, isCorrect);
    return { isCorrect, correctAnswer: q.correctAnswer, chosen };
  }

  function isLast(session) {
    return session.index >= session.queue.length - 1;
  }

  function advance(session) {
    session.index += 1;
  }

  function progressText(session) {
    return `${session.index + 1} / ${session.queue.length}`;
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

  async function finish(session) {
    const record = {
      mode: session.meta.mode,
      modeLabel: session.meta.label,
      startedAt: session.meta.startedAt,
      finishedAt: new Date().toISOString(),
      questionCount: session.queue.length,
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
    isLast,
    advance,
    progressText,
    categoryBreakdown,
    finish,
  };
})();
