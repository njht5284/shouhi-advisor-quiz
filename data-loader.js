// データ読み込み: data/questions.json + data/categories.json を取得し、
// 1,800件のフラット配列 + インデックスに展開する。
const DataLoader = (() => {
  function buildQuestionId(examId, questionNumber, subNumber) {
    return `${examId}-${questionNumber}-${subNumber}`;
  }

  async function load() {
    const [questionsRes, categoriesRes] = await Promise.all([
      fetch('./data/questions.json'),
      fetch('./data/categories.json'),
    ]);
    const examData = await questionsRes.json();
    const categories = await categoriesRes.json();

    const questions = new Map();
    const byExam = new Map();
    const byCategory = new Map();
    const examList = [];

    for (const exam of examData) {
      const ids = [];
      for (const mq of exam.questions) {
        for (const sq of mq.subQuestions) {
          const id = buildQuestionId(exam.examId, mq.questionNumber, sq.subNumber);
          const question = {
            id,
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
          questions.set(id, question);
          ids.push(id);

          if (!byCategory.has(sq.categoryId)) byCategory.set(sq.categoryId, []);
          byCategory.get(sq.categoryId).push(id);
        }
      }
      byExam.set(exam.examId, ids);
      examList.push({ examId: exam.examId, label: examLabel(exam.examId), count: ids.length });
    }

    examList.sort((a, b) => a.examId.localeCompare(b.examId));

    return { questions, byExam, byCategory, categories, examList };
  }

  function examLabel(examId) {
    const [y, m, d] = examId.split('-');
    return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日実施`;
  }

  return { load, buildQuestionId, examLabel };
})();
