/**
 * Core pure RAG and evaluation logic for EduGenAI.
 * Decoupled from UI components for deterministic unit testing.
 */

export interface TextChunk {
  index: number;
  page: number;
  text: string;
  topicTag: string;
}

export interface QuizQuestion {
  id: number;
  question: string;
  type: 'MCQ' | 'Short Answer' | 'Long Answer' | 'Viva';
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topicTag?: string;
  topic_tag?: string;
  options: string[] | null;
  correctAnswer?: string;
  correct_answer?: string;
  explanation: string;
}

export interface EvaluationResult {
  questionId?: number;
  question_id?: number;
  questionText?: string;
  question_text?: string;
  topicTag?: string;
  topic_tag?: string;
  studentAnswer?: string;
  student_answer?: string;
  correctAnswer?: string;
  correct_answer?: string;
  explanation: string;
  isCorrect?: boolean;
  is_correct?: boolean;
  scoreAwarded?: number; // 0.0 to 1.0
  score_awarded?: number;
  feedback: string;
}

/**
 * Clean raw text from PDF extraction.
 */
export function cleanExtractedText(text: string): string {
  if (!text) return '';
  return text
    .replace(/(\w+)-\n(\w+)/g, '$1$2') // un-hyphenate words broken by line endings
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split text into overlapping chunks of given size and overlap.
 */
export function chunkTextWithOverlap(
  text: string,
  pageNumber: number = 1,
  chunkSize: number = 500,
  chunkOverlap: number = 100
): TextChunk[] {
  const cleaned = cleanExtractedText(text);
  if (!cleaned) return [];

  const chunks: TextChunk[] = [];
  const step = Math.max(chunkSize - chunkOverlap, 50);
  let chunkIdx = 0;

  for (let start = 0; start < cleaned.length; start += step) {
    const slice = cleaned.slice(start, start + chunkSize).trim();
    if (slice.length < 30) continue;

    const topicTag = inferTopicHeading(slice);
    chunks.push({
      index: chunkIdx++,
      page: pageNumber,
      text: slice,
      topicTag,
    });
  }

  return chunks;
}

/**
 * Infer subtopic heading from chunk content.
 */
export function inferTopicHeading(chunkText: string): string {
  const lines = chunkText.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 3)) {
    const cleanLine = line.replace(/^[#*\-\d.\s]+/, '').trim();
    if (cleanLine.length >= 3 && cleanLine.length <= 45 && !cleanLine.endsWith('.')) {
      return cleanLine;
    }
  }

  // Fallback to prominent keywords
  const titleMatch = chunkText.match(/\b([A-Z][a-z]{3,}(?:\s+[A-Z][a-z]{3,})?)\b/);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1];
  }

  return 'Core Principles';
}

/**
 * Evaluate MCQ answer (exact or option-prefix matching).
 */
export function evaluateMcqAnswer(studentAnswer: string, correctAnswer: string): { isCorrect: boolean; score: number; feedback: string } {
  const s = (studentAnswer || '').trim().toLowerCase();
  const c = (correctAnswer || '').trim().toLowerCase();

  if (!s) {
    return {
      isCorrect: false,
      score: 0.0,
      feedback: `No answer selected. Correct answer: ${correctAnswer}`,
    };
  }

  const isExact = s === c;
  const isPrefix = (s.length === 1 && c.startsWith(s)) || (c.length === 1 && s.startsWith(c));
  const isOptionMatched = s.slice(0, 2) === c.slice(0, 2);

  const matched = isExact || isPrefix || isOptionMatched;

  return {
    isCorrect: matched,
    score: matched ? 1.0 : 0.0,
    feedback: matched ? 'Correct answer!' : `Incorrect. The correct choice is: ${correctAnswer}`,
  };
}

/**
 * Calculate keyword and concept coverage for free-form responses (Short, Long, Viva).
 */
export function evaluateFreeTextAnswer(
  studentAnswer: string,
  correctAnswer: string,
  explanation: string
): { isCorrect: boolean; score: number; feedback: string } {
  const s = (studentAnswer || '').trim().toLowerCase();
  const ref = `${correctAnswer} ${explanation}`.toLowerCase();

  if (!s || s.length < 5) {
    return {
      isCorrect: false,
      score: 0.0,
      feedback: `Answer is empty or insufficient. Expected key points: ${correctAnswer}`,
    };
  }

  // Tokenize key technical words (length >= 4)
  const extractWords = (t: string) => {
    const words = t.match(/\b[a-z]{4,}\b/g) || [];
    return new Set(words.filter((w) => !['that', 'with', 'this', 'from', 'have', 'were', 'which'].includes(w)));
  };

  const studentWords = extractWords(s);
  const refWords = extractWords(ref);

  if (refWords.size === 0) {
    return { isCorrect: true, score: 1.0, feedback: 'Answer accepted.' };
  }

  let matchCount = 0;
  for (const word of studentWords) {
    if (refWords.has(word)) matchCount++;
  }

  // Semantic keyword density score
  const density = matchCount / Math.min(refWords.size, 12);
  let score = Math.min(1.0, Math.max(0.0, density * 1.25));
  score = Math.round(score * 100) / 100;

  const isCorrect = score >= 0.6;

  let feedback = '';
  if (score >= 0.8) {
    feedback = 'Outstanding answer! Key terminology and core mechanisms correctly described.';
  } else if (score >= 0.6) {
    feedback = 'Good response! Core ideas identified; consider including full rubric definitions.';
  } else if (score >= 0.35) {
    feedback = `Partially correct. Missing essential points from rubric: ${correctAnswer}`;
  } else {
    feedback = `Needs improvement. Expected answer: ${correctAnswer}`;
  }

  return { isCorrect, score, feedback };
}

/**
 * Aggregate topic analytics and generate weak-topic recommendations.
 */
export function calculateTopicAnalytics(evaluations: EvaluationResult[]): {
  overallAccuracy: number;
  topicAnalytics: Array<{ topic: string; total: number; correct: number; accuracy: number; isWeak: boolean }>;
  weakTopics: string[];
  recommendations: string[];
} {
  if (evaluations.length === 0) {
    return {
      overallAccuracy: 0,
      topicAnalytics: [],
      weakTopics: [],
      recommendations: ['Upload study material and complete a quiz to receive targeted feedback!'],
    };
  }

  const topicMap: Record<string, { total: number; correct: number }> = {};
  let totalScore = 0;

  for (const item of evaluations) {
    const topic = item.topicTag || 'General';
    if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0 };
    const score = item.scoreAwarded ?? item.score_awarded ?? 0;
    const isCorrect = item.isCorrect ?? item.is_correct ?? false;
    if (isCorrect || score >= 0.6) {
      topicMap[topic].correct += 1;
    }
    totalScore += score;
  }

  const overallAccuracy = Math.round((totalScore / evaluations.length) * 100);

  const topicAnalytics = Object.entries(topicMap).map(([topic, stats]) => {
    const accuracy = Math.round((stats.correct / stats.total) * 100);
    return {
      topic,
      total: stats.total,
      correct: stats.correct,
      accuracy,
      isWeak: accuracy < 60,
    };
  });

  const weakTopics = topicAnalytics.filter((t) => t.isWeak).map((t) => t.topic);

  const recommendations: string[] = [];
  if (weakTopics.length > 0) {
    for (const wt of weakTopics) {
      recommendations.push(`Priority: Review '${wt}'. Practice a targeted 5-question quiz on this topic.`);
    }
    recommendations.push('Tip: For Short & Viva questions, explain fundamental principles and technical mechanisms.');
  } else {
    recommendations.push('Superb performance! All assessed topics show >= 60% accuracy. Test with Hard difficulty or Viva questions.');
  }

  return {
    overallAccuracy,
    topicAnalytics,
    weakTopics,
    recommendations,
  };
}
