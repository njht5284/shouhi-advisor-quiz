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

  // 一度でも間違えたことがある問題を、正答率が低い順（同率なら挑戦回数が多い順）に返す。
  // 復習モードの出題プールとして使う。
  async function getWeakQuestions() {
    const all = await getAllResults();
    const weak = all.filter((r) => r.correctCount < r.attemptCount);
    weak.sort((a, b) => {
      const accA = a.correctCount / a.attemptCount;
      const accB = b.correctCount / b.attemptCount;
      if (accA !== accB) return accA - accB;
      return b.attemptCount - a.attemptCount;
    });
    return weak.map((r) => r.questionId);
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
    saveSession,
    getRecentSessions,
    saveInProgressSession,
    getInProgressSession,
    clearInProgressSession,
  };
})();
