// データ読み込み: data/questions.json + data/categories.json を取得し、
// 出題単位（unit）のインデックスに展開する。
//
// 正誤判定型(true_false)の小問はそれぞれ独立した出題単位（kind:'single'）。
// 穴埋め型(fill_blank)は、同じ大問の【ア】〜【オ】をまとめて1つの出題単位
// （kind:'group'）にする（1項目だけでは文脈が読めず答えにくいため）。
// 大問内の小問タイプは常に統一されている（抽出パイプラインで大問単位で判定済み）。
const DataLoader = (() => {
  function buildBlankId(examId, questionNumber, subNumber) {
    return `${examId}-${questionNumber}-${subNumber}`;
  }

  function buildGroupId(examId, questionNumber) {
    return `${examId}-${questionNumber}`;
  }

  async function load() {
    const [questionsRes, categoriesRes] = await Promise.all([
      fetch('./data/questions.json'),
      fetch('./data/categories.json'),
    ]);
    const examData = await questionsRes.json();
    const categories = await categoriesRes.json();

    const questions = new Map(); // unitId -> unit
    const byExam = new Map(); // examId -> [unitId...]（出題キュー用）
    const byCategory = new Map(); // categoryId -> [unitId...]（出題キュー用、重複なし）
    const examBlankIds = new Map(); // examId -> [blankId...]（進捗バッジ用）
    const categoryBlankIds = new Map(); // categoryId -> [blankId...]（進捗バッジ用）
    const blankToUnit = new Map(); // blankId -> unitId（復習モードの弱点問題→出題単位の変換用）
    const examList = [];

    for (const exam of examData) {
      const unitIds = [];
      const blankIds = [];

      for (const mq of exam.questions) {
        const isGroup = mq.subQuestions.every((sq) => sq.type === 'fill_blank');

        if (isGroup) {
          const groupId = buildGroupId(exam.examId, mq.questionNumber);
          const blanks = mq.subQuestions.map((sq) => {
            const blankId = buildBlankId(exam.examId, mq.questionNumber, sq.subNumber);
            blankIds.push(blankId);
            blankToUnit.set(blankId, groupId);
            registerCategory(categoryBlankIds, sq.categoryId, blankId);
            return {
              id: blankId,
              subNumber: sq.subNumber,
              prompt: sq.prompt,
              choices: sq.choices,
              correctAnswer: sq.correctAnswer,
              explanation: sq.explanation,
              categoryId: sq.categoryId,
              categoryLabel: sq.categoryLabel,
              needsSupplement: sq.needsSupplement,
            };
          });
          const group = {
            kind: 'group',
            id: groupId,
            examId: exam.examId,
            questionNumber: mq.questionNumber,
            passage: mq.passage,
            type: 'fill_blank',
            blanks,
          };
          questions.set(groupId, group);
          unitIds.push(groupId);
          for (const b of blanks) registerCategory(byCategory, b.categoryId, groupId, true);
        } else {
          for (const sq of mq.subQuestions) {
            const blankId = buildBlankId(exam.examId, mq.questionNumber, sq.subNumber);
            blankIds.push(blankId);
            blankToUnit.set(blankId, blankId);
            const single = {
              kind: 'single',
              id: blankId,
              examId: exam.examId,
              questionNumber: mq.questionNumber,
              subNumber: sq.subNumber,
              passage: mq.passage,
              type: sq.type,
              prompt: sq.prompt,
              choices: sq.choices,
              correctAnswer: sq.correctAnswer,
              explanation: sq.explanation,
              categoryId: sq.categoryId,
              categoryLabel: sq.categoryLabel,
              needsSupplement: sq.needsSupplement,
            };
            questions.set(blankId, single);
            unitIds.push(blankId);
            registerCategory(byCategory, sq.categoryId, blankId, true);
            registerCategory(categoryBlankIds, sq.categoryId, blankId);
          }
        }
      }

      byExam.set(exam.examId, unitIds);
      examBlankIds.set(exam.examId, blankIds);
      examList.push({ examId: exam.examId, label: examLabel(exam.examId), count: blankIds.length });
    }

    examList.sort((a, b) => a.examId.localeCompare(b.examId));

    return {
      questions,
      byExam,
      byCategory,
      examBlankIds,
      categoryBlankIds,
      blankToUnit,
      categories,
      examList,
    };
  }

  // dedupe=true の場合、同じ id を重複して積まない（1グループが複数分野の
  // 小問を含む場合に、出題キュー用リストへ複数回追加されるのを防ぐ）。
  function registerCategory(map, categoryId, id, dedupe) {
    if (!map.has(categoryId)) map.set(categoryId, []);
    const list = map.get(categoryId);
    if (dedupe && list.includes(id)) return;
    list.push(id);
  }

  function examLabel(examId) {
    const [y, m, d] = examId.split('-');
    return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日実施`;
  }

  return { load, buildBlankId, buildGroupId, examLabel };
})();
