// IndexedDB永続化層: 回答結果(questionResults)とセッション履歴(sessions)を管理する。
const Storage = (() => {
  const DB_NAME = 'shouhi-advisor-quiz-db';
  const DB_VERSION = 2;
  const IN_PROGRESS_KEY = 'current';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('questionResults')) {
          const store = db.createObjectStore('questionResults', { keyPath: 'questionId' });
          store.createIndex('categoryId', 'categoryId');
          store.createIndex('lastResult', 'lastResult');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'sessionId', autoIncrement: true });
          store.createIndex('startedAt', 'startedAt');
        }
        if (!db.objectStoreNames.contains('inProgressSession')) {
          db.createObjectStore('inProgressSession', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await openDB();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function recordAnswer(question, isCorrect) {
    const store = await tx('questionResults', 'readwrite');
    const existing = await promisify(store.get(question.id));
    const now = new Date().toISOString();
    const record = existing || {
      questionId: question.id,
      categoryId: question.categoryId,
      examId: question.examId,
      attemptCount: 0,
      correctCount: 0,
    };
    record.categoryId = question.categoryId;
    record.examId = question.examId;
    record.attemptCount += 1;
    if (isCorrect) record.correctCount += 1;
    record.lastResult = isCorrect ? 'correct' : 'incorrect';
    record.lastAnsweredAt = now;
    await promisify(store.put(record));
    return record;
  }

  async function getAllResults() {
    const store = await tx('questionResults', 'readonly');
    return promisify(store.getAll());
  }

  // ---- 間隔反復（スペースドリピティション）----
  // 記録として持っているのは attemptCount / correctCount / lastResult / lastAnsweredAt だけなので、
  // Leitnerの考え方を単純化し「正解を重ねた問題ほど次に出すまでの間隔を延ばす」で近似する。
  // 直前に間違えた問題は、何回正解していても間隔を最短に戻す。
  const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];

  function reviewIntervalDays(record) {
    if (record.lastResult === 'incorrect') return REVIEW_INTERVAL_DAYS[0];
    const level = Math.min(record.correctCount, REVIEW_INTERVAL_DAYS.length - 1);
    return REVIEW_INTERVAL_DAYS[level];
  }

  // 「間隔に対してどれだけ放置されたか」。1.0以上なら復習時期が来ている。
  // 解答日時が欠けている古い記録は、最優先で拾えるよう無限大にする。
  function reviewDueRatio(record, now) {
    const last = record.lastAnsweredAt ? Date.parse(record.lastAnsweredAt) : NaN;
    if (!Number.isFinite(last)) return Number.POSITIVE_INFINITY;
    const days = Math.max(0, (now - last) / 86400000);
    return days / reviewIntervalDays(record);
  }

  function weakRecords(all) {
    return all.filter((r) => r.correctCount < r.attemptCount);
  }

  // 一度でも間違えたことがある問題を、復習すべき順に返す。
  // 第1基準は間隔反復の期限超過度、第2基準は正答率の低さ、第3基準は挑戦回数。
  async function getWeakQuestions() {
    const all = await getAllResults();
    const now = Date.now();
    const weak = weakRecords(all);
    weak.sort((a, b) => {
      const dueA = reviewDueRatio(a, now);
      const dueB = reviewDueRatio(b, now);
      if (dueA !== dueB) return dueB - dueA;
      const accA = a.correctCount / a.attemptCount;
      const accB = b.correctCount / b.attemptCount;
      if (accA !== accB) return accA - accB;
      return b.attemptCount - a.attemptCount;
    });
    return weak.map((r) => r.questionId);
  }

  // 復習対象のうち、間隔反復の期限が来ている小問のID。
  async function getDueWeakQuestionIds() {
    const all = await getAllResults();
    const now = Date.now();
    return weakRecords(all)
      .filter((r) => reviewDueRatio(r, now) >= 1)
      .map((r) => r.questionId);
  }

  // 小問ID -> 解答回数 の対応表。未回答の小問はキーごと存在しない。
  // 未着手モードで「手薄な問題」を選ぶために使う。
  async function getAttemptCounts() {
    const all = await getAllResults();
    const map = new Map();
    for (const r of all) map.set(r.questionId, r.attemptCount);
    return map;
  }

  // 本番モードを最後まで解き終えた記録を、試験回ごとに集計する。
  // sessionsには完走したセッションしか入らないため、ここに出てくる試験回は
  // 「一度は150問を通しで解き切った」ことを意味する。
  async function getHonbanSummary() {
    const store = await tx('sessions', 'readonly');
    const all = await promisify(store.getAll());
    const map = new Map();
    for (const r of all) {
      if (r.mode !== 'honban' || !r.examId) continue;
      const e = map.get(r.examId) || {
        runs: 0,
        bestCorrect: 0,
        questionCount: r.questionCount,
        lastFinishedAt: null,
      };
      e.runs += 1;
      if (r.correctCount > e.bestCorrect) e.bestCorrect = r.correctCount;
      if (!e.lastFinishedAt || r.finishedAt > e.lastFinishedAt) {
        e.lastFinishedAt = r.finishedAt;
        e.questionCount = r.questionCount;
      }
      map.set(r.examId, e);
    }
    return map;
  }

  async function saveSession(session) {
    const store = await tx('sessions', 'readwrite');
    await promisify(store.add(session));
  }

  async function getRecentSessions(limit = 10) {
    const store = await tx('sessions', 'readonly');
    const all = await promisify(store.getAll());
    all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return all.slice(0, limit);
  }

  // 進行中のクイズを1件だけ保存する（直近1件のみ、新しいセッション開始で上書き/破棄される）。
  async function saveInProgressSession(snapshot) {
    const store = await tx('inProgressSession', 'readwrite');
    await promisify(store.put({ ...snapshot, id: IN_PROGRESS_KEY }));
  }

  async function getInProgressSession() {
    const store = await tx('inProgressSession', 'readonly');
    return promisify(store.get(IN_PROGRESS_KEY));
  }

  async function clearInProgressSession() {
    const store = await tx('inProgressSession', 'readwrite');
    await promisify(store.delete(IN_PROGRESS_KEY));
  }

  return {
    recordAnswer,
    getAllResults,
    getWeakQuestions,
    getDueWeakQuestionIds,
    getAttemptCounts,
    saveSession,
    getHonbanSummary,
    getRecentSessions,
    saveInProgressSession,
    getInProgressSession,
    clearInProgressSession,
  };
})();
