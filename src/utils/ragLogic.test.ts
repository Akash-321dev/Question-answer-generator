import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanExtractedText,
  chunkTextWithOverlap,
  inferTopicHeading,
  evaluateMcqAnswer,
  evaluateFreeTextAnswer,
  calculateTopicAnalytics,
  EvaluationResult,
} from './ragLogic';

test('cleanExtractedText handles hyphens and irregular whitespace', () => {
  const raw = 'The proc-\ness sched-\nuler in an operating\r\nsystem   controls   threads.\n\n\n\nNext section.';
  const cleaned = cleanExtractedText(raw);
  assert.equal(cleaned.includes('process scheduler'), true);
  assert.equal(cleaned.includes('   '), false);
  assert.equal(cleaned.includes('\r'), false);
});

test('chunkTextWithOverlap produces valid chunks with overlap', () => {
  const sampleDoc = `Process Synchronization and Critical Section Problem.
A critical section is a piece of code that accesses shared resources.
Only one process may execute in its critical section at a given time.
To prevent race conditions, mutual exclusion must be guaranteed.
Semaphores and mutex locks are common software synchronization tools.
Deadlock occurs when processes are waiting indefinitely for an event that only another waiting process can cause.`;

  const chunks = chunkTextWithOverlap(sampleDoc, 1, 150, 40);
  assert.ok(chunks.length >= 2, 'Should produce multiple chunks for sized text');
  assert.equal(chunks[0].page, 1);
  assert.ok(chunks[0].topicTag.length > 0);
});

test('inferTopicHeading extracts clean titles', () => {
  const heading = inferTopicHeading('### Memory Management Techniques\nPaging is a memory management scheme...');
  assert.equal(heading, 'Memory Management Techniques');
});

test('evaluateMcqAnswer matches exact and option prefixes correctly', () => {
  const resultExact = evaluateMcqAnswer('A) Mutex Lock', 'A) Mutex Lock');
  assert.equal(resultExact.isCorrect, true);
  assert.equal(resultExact.score, 1.0);

  const resultPrefix = evaluateMcqAnswer('A', 'A) Mutex Lock');
  assert.equal(resultPrefix.isCorrect, true);

  const resultWrong = evaluateMcqAnswer('B) Semaphore', 'A) Mutex Lock');
  assert.equal(resultWrong.isCorrect, false);
  assert.equal(resultWrong.score, 0.0);
});

test('evaluateFreeTextAnswer scores technical keyword density', () => {
  const correct = 'Deadlock occurs when processes wait indefinitely for resources held by each other.';
  const explanation = 'Requires mutual exclusion, hold and wait, no preemption, and circular wait.';

  const goodAnswer = 'Deadlock happens when processes wait indefinitely for resources held by others in circular wait.';
  const evalGood = evaluateFreeTextAnswer(goodAnswer, correct, explanation);
  assert.ok(evalGood.score >= 0.6, `Score should be >= 0.6, got ${evalGood.score}`);
  assert.equal(evalGood.isCorrect, true);

  const badAnswer = 'Computer screens are bright in the dark.';
  const evalBad = evaluateFreeTextAnswer(badAnswer, correct, explanation);
  assert.ok(evalBad.score < 0.4, `Score should be < 0.4, got ${evalBad.score}`);
  assert.equal(evalBad.isCorrect, false);
});

test('calculateTopicAnalytics identifies weak topics with < 60% accuracy', () => {
  const evaluations: EvaluationResult[] = [
    {
      questionId: 1,
      questionText: 'Q1',
      topicTag: 'Deadlocks',
      studentAnswer: 'Ans',
      correctAnswer: 'Correct',
      explanation: 'Exp',
      isCorrect: true,
      scoreAwarded: 1.0,
      feedback: 'Good',
    },
    {
      questionId: 2,
      questionText: 'Q2',
      topicTag: 'Deadlocks',
      studentAnswer: 'Ans',
      correctAnswer: 'Correct',
      explanation: 'Exp',
      isCorrect: true,
      scoreAwarded: 1.0,
      feedback: 'Good',
    },
    {
      questionId: 3,
      questionText: 'Q3',
      topicTag: 'Virtual Memory',
      studentAnswer: 'Ans',
      correctAnswer: 'Correct',
      explanation: 'Exp',
      isCorrect: false,
      scoreAwarded: 0.2,
      feedback: 'Poor',
    },
    {
      questionId: 4,
      questionText: 'Q4',
      topicTag: 'Virtual Memory',
      studentAnswer: 'Ans',
      correctAnswer: 'Correct',
      explanation: 'Exp',
      isCorrect: false,
      scoreAwarded: 0.3,
      feedback: 'Poor',
    },
  ];

  const analytics = calculateTopicAnalytics(evaluations);
  assert.ok(analytics.weakTopics.includes('Virtual Memory'), 'Virtual Memory must be identified as weak');
  assert.ok(!analytics.weakTopics.includes('Deadlocks'), 'Deadlocks has 100% accuracy and is not weak');
  assert.ok(analytics.recommendations.some((r) => r.includes('Virtual Memory')));
});
