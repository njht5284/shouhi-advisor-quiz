// クイズ進行のロジック（状態管理・採点）。DOM描画はapp.js側で行う。
//
// 出題単位(unit)には2種類ある:
//   kind:'single' … 正誤判定型の小問1つ（従来通り、選んだ瞬間に採点）
//   kind:'group'  … 穴埋め型の大問1つ（【ア】〜【オ】をまとめて解答・採点）
// 採点・統計・復習キューは、グループの場合も内部的には小問(blank)単位で記録する。
const QuizEngine = (() => {
  // 本番試験の配点: 30大問×10点=300点満点。小問は150問なので1小問2点。
  // 合格は65%=195点、つまり150小問中98問正解（97.5問の切り上げ）。
  const HONBAN_FULL_SCORE = 300;
  const HONBAN_BLANK_COUNT = 150;
  const HONBAN_PASS_RATIO = 0.65;

  // 正解した小問数を、本番の配点に換算する。
  // 本番モード（150小問を通しで解いたセッション）の結果表示にのみ使う。
  function examScore(correctCount) {
    const pointsPerBlank = HONBAN_FULL_SCORE / HONBAN_BLANK_COUNT;
    const passPoints = HONBAN_FULL_SCORE * HONBAN_PASS_RATIO;
    const passBlanks = Math.ceil(passPoints / pointsPerBlank);
    return {
      points: correctCount * pointsPerBlank,
      fullScore: HONBAN_FULL_SCORE,
      passPoints,
      passBlanks,
      blankCount: HONBAN_BLANK_COUNT,
      remainingBlanks: Math.max(0, passBlanks - correctCount),
      passed: correctCount >= passBlanks,
    };
  }

  function createSession(queue, questionsMap, meta) {
    return {
      queue,
      questionsMap,
      meta,
      index: 0,
      score: 0,
      totalBlanks: queue.reduce((sum, id) => sum + unitBlankCount(questionsMap.get(id)), 0),
      answers: [], // {questionId, categoryId, isCorrect}
      timer: createTimer(meta),
    };
  }

  // 本番モード（meta.timeLimitSecondsがある場合）のみタイマーを持つ。他モードはnull。
  function createTimer(meta) {
    if (!meta.timeLimitSeconds) return null;
    return {
      totalSeconds: meta.timeLimitSeconds,
      remainingSeconds: meta.timeLimitSeconds,
      paused: false,
      timeUpNotified: false,
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

  // タイマーを1秒分進める。一時停止中や、タイマーの無いモードでは何もしない。
  // 制限時間に達した最初の1回だけ true を返す（通知を出すタイミングの合図）。
  function tickTimer(session) {
    const timer = session.timer;
    if (!timer || timer.paused) return false;
    if (timer.remainingSeconds <= 0) return false;
    timer.remainingSeconds -= 1;
    if (timer.remainingSeconds <= 0 && !timer.timeUpNotified) {
      timer.timeUpNotified = true;
      return true;
    }
    return false;
  }

  function togglePause(session) {
    if (session.timer) session.timer.paused = !session.timer.paused;
  }

  // 一時停止中でも選択肢は押せてしまうため、解答操作を合図に計測を再開する。
  // 動作中や、タイマーの無いモードでは何もしない。再開したときだけ true を返す。
  function resumeTimer(session) {
    if (!session.timer || !session.timer.paused) return false;
    session.timer.paused = false;
    return true;
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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
      timer: session.timer,
      savedAt: new Date().toISOString(),
    };
  }

  // 保存されたスナップショットからセッションを復元する。
  // queueに含まれるIDが1つでも現在のデータに存在しなければ null を返す
  // （データが更新された等でスナップショットが無効な場合の安全策）。
  // タイマーが動作中のまま保存されていた場合、保存時刻から今までの経過分を差し引く
  // （アプリを閉じていた間も試験時間としてカウントするため）。
  function restore(saved, questionsMap) {
    if (!saved || !Array.isArray(saved.queue) || saved.queue.length === 0) return null;
    if (saved.index < 0 || saved.index >= saved.queue.length) return null;
    if (!saved.queue.every((id) => questionsMap.has(id))) return null;

    let timer = saved.timer || null;
    if (timer && !timer.paused) {
      const elapsed = Math.max(0, (Date.now() - new Date(saved.savedAt).getTime()) / 1000);
      timer = { ...timer, remainingSeconds: Math.max(0, timer.remainingSeconds - elapsed) };
      if (timer.remainingSeconds <= 0) timer.timeUpNotified = true;
    }

    return {
      queue: saved.queue,
      questionsMap,
      meta: saved.meta,
      index: saved.index,
      score: saved.score,
      totalBlanks: saved.totalBlanks,
      answers: saved.answers,
      timer,
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
    tickTimer,
    togglePause,
    resumeTimer,
    formatTime,
    snapshot,
    restore,
    finish,
    examScore,
    HONBAN_BLANK_COUNT,
  };
})();
