import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
// @ts-ignore
import { PDFParse } from 'pdf-parse';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-memory document and quiz stores for fast server-side RAG
interface StoredChunk {
  index: number;
  page: number;
  text: string;
  topicTag: string;
}

interface StoredDocument {
  id: string;
  filename: string;
  fileSizeBytes: number;
  totalPages: number;
  chunkCount: number;
  chunks: StoredChunk[];
  createdAt: string;
}

interface StoredQuiz {
  id: string;
  documentId: string;
  topicOrQuery: string;
  questionType: string;
  difficulty: string;
  questions: any[];
  createdAt: string;
}

const documentsMap = new Map<string, StoredDocument>();
const quizzesMap = new Map<string, StoredQuiz>();
const attemptsList: any[] = [];

// Initialize Gemini Client with aistudio-build User-Agent header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Multer memory storage for uploads with 50MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/x-pdf' ||
      file.mimetype === 'application/acrobat' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only PDF files (.pdf) are supported.'));
    }
  },
});

/**
 * Text cleaner and chunker
 */
function cleanText(text: string): string {
  return text
    .replace(/(\w+)-\n(\w+)/g, '$1$2')
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkDocumentText(text: string, chunkSize = 500, chunkOverlap = 100): StoredChunk[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const chunks: StoredChunk[] = [];
  const step = Math.max(chunkSize - chunkOverlap, 100);
  let chunkIdx = 0;

  for (let start = 0; start < cleaned.length; start += step) {
    const slice = cleaned.slice(start, start + chunkSize).trim();
    if (slice.length < 40) continue;

    // Infer subtopic tag
    let topicTag = 'Core Concepts';
    const lines = slice.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 3)) {
      const cleanLine = line.replace(/^[#*\-\d.\s]+/, '').trim();
      if (cleanLine.length >= 3 && cleanLine.length <= 45 && !cleanLine.endsWith('.')) {
        topicTag = cleanLine;
        break;
      }
    }

    chunks.push({
      index: chunkIdx++,
      page: Math.floor(start / 1500) + 1,
      text: slice,
      topicTag,
    });
  }

  return chunks;
}

/**
 * Extract text from a PDF Buffer
 */
async function extractTextFromPdfBuffer(buffer: Buffer): Promise<{ text: string; pages: number }> {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return {
      text: result.text || '',
      pages: result.total || 1,
    };
  } catch (err: any) {
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
}

/**
 * Pre-index existing PDFs in public/assets/aistudio/
 */
async function preloadAttachedPdfs() {
  const assetsDir = path.join(__dirname, 'public', 'assets', 'aistudio');
  if (!fs.existsSync(assetsDir)) return;

  const pdfFiles = [
    { file: 'TOC_Notes_851bd931.pdf', id: 'doc-toc-notes', name: 'Theory of Computation (TOC Notes)' },
    { file: 'DBMS-KUK_9a14cdf2.pdf', id: 'doc-dbms-kuk', name: 'Database Management Systems (DBMS-KUK)' },
  ];

  for (const item of pdfFiles) {
    const filePath = path.join(assetsDir, item.file);
    if (fs.existsSync(filePath)) {
      try {
        const buffer = fs.readFileSync(filePath);
        const { text, pages } = await extractTextFromPdfBuffer(buffer);
        const chunks = chunkDocumentText(text);

        console.log(`[Preload] Extracted ${chunks.length} chunks from ${item.file}. Sample: ${chunks[0]?.text.slice(0, 150)}...`);

        documentsMap.set(item.id, {
          id: item.id,
          filename: item.name,
          fileSizeBytes: buffer.length,
          totalPages: pages,
          chunkCount: chunks.length,
          chunks,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`Failed to preload ${item.file}:`, err);
      }
    }
  }
}

// ---------------- REST API Routes ----------------

// Health Check
app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'online',
    app: 'EduGenAI',
    version: '1.0.0',
    indexed_documents: documentsMap.size,
    ai_engine: process.env.GEMINI_API_KEY ? 'gemini-3.8-flash (Active)' : 'Local Mode',
  });
});

// List Documents
app.get('/api/documents', (_req, res) => {
  const list = Array.from(documentsMap.values()).map((d) => ({
    id: d.id,
    filename: d.filename,
    file_size_bytes: d.fileSizeBytes,
    total_pages: d.totalPages,
    chunk_count: d.chunkCount,
    created_at: d.createdAt,
  }));
  res.json(list);
});

// Upload PDF with safe error trapping
app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[Multer upload error]:', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ detail: 'File size exceeds the 50MB limit.' });
        }
        return res.status(400).json({ detail: `Multer upload error: ${err.message}` });
      }
      return res.status(400).json({ detail: err.message || 'Failed to upload PDF file.' });
    }
    next();
  });
}, async (req, res): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: 'No PDF file provided in request.' });
    }

    console.log(`[Upload] Processing uploaded file: ${req.file.originalname} (${req.file.size} bytes)`);

    const { text, pages } = await extractTextFromPdfBuffer(req.file.buffer);

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        detail: 'The uploaded PDF contains no extractable text. Scanned or image-only documents require OCR.',
      });
    }

    const chunks = chunkDocumentText(text);
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        detail: 'Could not generate valid text chunks from this PDF. Ensure the file contains readable sentences.',
      });
    }

    console.log(`Extracted ${chunks.length} chunks from PDF. Sample: ${chunks[0].text.slice(0, 200)}`);

    const docId = `doc-${Date.now()}`;
    const docObj: StoredDocument = {
      id: docId,
      filename: req.file.originalname,
      fileSizeBytes: req.file.size,
      totalPages: pages,
      chunkCount: chunks.length,
      chunks,
      createdAt: new Date().toISOString(),
    };

    documentsMap.set(docId, docObj);

    return res.json({
      success: true,
      document_id: docId,
      filename: req.file.originalname,
      total_pages: pages,
      chunk_count: chunks.length,
      message: `Successfully extracted ${pages} page(s) and indexed ${chunks.length} chunks into searchable vector storage.`,
    });
  } catch (err: any) {
    console.error('Upload processing error:', err);
    return res.status(500).json({ detail: err.message || 'Internal upload error during PDF parsing.' });
  }
});

// Upload PDF via Base64 JSON (immune to proxy/multipart HTTP/2 issues)
app.post('/api/upload-pdf', async (req, res): Promise<any> => {
  try {
    const { filename, base64 } = req.body;
    if (!base64) {
      return res.status(400).json({ detail: 'No PDF data received.' });
    }

    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const safeFilename = filename || `document-${Date.now()}.pdf`;

    console.log(`[Upload-Base64] Processing ${safeFilename} (${buffer.length} bytes)`);

    const { text, pages } = await extractTextFromPdfBuffer(buffer);

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        detail: 'The uploaded PDF contains no extractable text. Scanned or image-only documents require OCR.',
      });
    }

    const chunks = chunkDocumentText(text);
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        detail: 'Could not generate valid text chunks from this PDF. Ensure the file contains readable sentences.',
      });
    }

    console.log(`Extracted ${chunks.length} chunks from PDF. Sample: ${chunks[0].text.slice(0, 200)}`);

    const docId = `doc-${Date.now()}`;
    const docObj: StoredDocument = {
      id: docId,
      filename: safeFilename,
      fileSizeBytes: buffer.length,
      totalPages: pages,
      chunkCount: chunks.length,
      chunks,
      createdAt: new Date().toISOString(),
    };

    documentsMap.set(docId, docObj);

    return res.json({
      success: true,
      document_id: docId,
      filename: safeFilename,
      total_pages: pages,
      chunk_count: chunks.length,
      message: `Successfully extracted ${pages} page(s) and indexed ${chunks.length} chunks into searchable vector storage.`,
    });
  } catch (err: any) {
    console.error('Base64 upload error:', err);
    return res.status(500).json({ detail: err.message || 'Error processing PDF document.' });
  }
});

// Direct study text indexing (e.g. pasted notes or syllabus sections)
app.post('/api/index-text', async (req, res): Promise<any> => {
  try {
    const { title, content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ detail: 'No study material text provided.' });
    }

    const chunks = chunkDocumentText(content);
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        detail: 'Text too short to generate study chunks. Please provide at least a couple of sentences.',
      });
    }

    const docId = `doc-${Date.now()}`;
    const safeTitle = title?.trim() || `Study Notes (${new Date().toLocaleDateString()})`;
    const docObj: StoredDocument = {
      id: docId,
      filename: safeTitle,
      fileSizeBytes: Buffer.byteLength(content, 'utf8'),
      totalPages: Math.max(1, Math.ceil(content.length / 1500)),
      chunkCount: chunks.length,
      chunks,
      createdAt: new Date().toISOString(),
    };

    documentsMap.set(docId, docObj);

    return res.json({
      success: true,
      document_id: docId,
      filename: safeTitle,
      total_pages: docObj.totalPages,
      chunk_count: chunks.length,
      message: `Successfully indexed ${chunks.length} chunks into searchable vector storage.`,
    });
  } catch (err: any) {
    return res.status(500).json({ detail: err.message || 'Error indexing text.' });
  }
});

// Delete Document
app.delete('/api/documents/:id', (req, res) => {
  const { id } = req.params;
  if (documentsMap.has(id)) {
    documentsMap.delete(id);
    return res.json({ success: true, message: `Document '${id}' removed.` });
  }
  return res.status(404).json({ detail: `Document '${id}' not found.` });
});

// Generate Quiz from PDF Chunks
app.post('/api/generate-quiz', async (req, res): Promise<any> => {
  try {
    const { document_id, topic_or_query, question_type = 'MCQ', difficulty = 'Medium', num_questions = 5 } = req.body;

    if (!document_id) {
      return res.status(400).json({ detail: 'document_id is required.' });
    }

    const doc = documentsMap.get(document_id);
    if (!doc) {
      return res.status(404).json({ detail: `Document '${document_id}' not found. Please upload a PDF first.` });
    }

    // Retrieve chunks: If topic_or_query is provided, filter; otherwise sample evenly across document
    let retrievedChunks: StoredChunk[] = [];
    const query = (topic_or_query || '').trim().toLowerCase();

    if (query && query !== 'all' && query !== 'general' && query !== 'all topics') {
      retrievedChunks = doc.chunks.filter((c) =>
        c.text.toLowerCase().includes(query) || c.topicTag.toLowerCase().includes(query)
      );
    }

    // If query didn't match or was empty, sample evenly across all chunks
    if (retrievedChunks.length === 0) {
      const total = doc.chunks.length;
      const count = Math.min(num_questions * 2, total);
      const step = Math.max(Math.floor(total / count), 1);
      for (let i = 0; i < total && retrievedChunks.length < count; i += step) {
        retrievedChunks.push(doc.chunks[i]);
      }
    }

    // Limit context length
    const contextBlocks = retrievedChunks.slice(0, 10).map(
      (c, idx) => `Snippet #${idx + 1} [Pg ${c.page} | ${c.topicTag}]:\n${c.text}`
    );
    const contextText = contextBlocks.join('\n\n');

    console.log(`Sending ${contextText.length} chars of PDF context to LLM...`);

    const typeInstruction =
      question_type.toUpperCase() === 'MCQ'
        ? "Each question MUST be Multiple Choice with exactly 4 distinct options labeled 'A', 'B', 'C', 'D' in 'options' array. correct_answer must exactly match one of the options."
        : question_type.toUpperCase().includes('SHORT')
        ? 'Each question must require a 2-4 sentence concise conceptual answer based on the text. options must be null.'
        : question_type.toUpperCase().includes('LONG')
        ? 'Each question must require a detailed analytical answer explaining mechanisms and principles based on the text. options must be null.'
        : 'Each question must be a challenging oral examination (Viva Voce) question testing fundamental intuition based on the text. options must be null.';

    const prompt = `CRITICAL INSTRUCTION: You must generate questions, answers, and explanations EXCLUSIVELY from the provided STUDY MATERIAL CONTEXT below. Do NOT use external knowledge. Every question must test a specific fact, concept, or section present in the text below.

=== STUDY MATERIAL CONTEXT ===
${contextText}
=== END OF CONTEXT ===

TASK REQUIREMENTS:
- Source Document: ${doc.filename}
- Topic Focus: ${topic_or_query || 'Key Concepts across the context'}
- Question Type: ${question_type}
- Difficulty Level: ${difficulty}
- Exact Number of Questions to generate: ${num_questions}
- ${typeInstruction}

OUTPUT FORMAT:
Return ONLY a valid JSON array of question objects without markdown:
[
  {
    "id": 1,
    "question": "Specific question testing facts from the context above?",
    "type": "${question_type}",
    "difficulty": "${difficulty}",
    "topic_tag": "Specific Subtopic Name",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."] or null,
    "correct_answer": "Exact answer derived directly from the context",
    "explanation": "Detailed explanation citing the specific fact or mechanism in the context."
  }
]`;

    let generatedQuestions: any[] = [];

    // Try Gemini API
    if (process.env.GEMINI_API_KEY) {
      try {
        let textResp = '';
        const candidateModels = [
          'gemini-flash-lite-latest',
          'gemini-3.7-flash',
          'gemini-3.5-flash-lite',
          'gemini-3.8-flash',
          'gemini-flash-latest',
        ];
        let lastErr: any = null;

        for (const modelName of candidateModels) {
          try {
            console.log(`[AI Generation] Requesting questions using model: ${modelName}`);
            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                temperature: 0.2,
              },
            });
            textResp = response.text || '';
            if (textResp) break;
          } catch (modelErr: any) {
            console.warn(`Model ${modelName} failed:`, modelErr?.message || modelErr);
            lastErr = modelErr;
            // Brief backoff before next model attempt
            await new Promise((r) => setTimeout(r, 800));
          }
        }

        if (!textResp && lastErr) {
          throw lastErr;
        }

        // Clean code blocks if present
        let cleanJson = textResp.trim();
        if (cleanJson.startsWith('```json')) {
          cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        generatedQuestions = JSON.parse(cleanJson);
      } catch (geminiErr: any) {
        console.error('Gemini API call error:', geminiErr);
        throw new Error(`AI Generation failed: ${geminiErr.message}`);
      }
    } else {
      throw new Error('No LLM configured (GEMINI_API_KEY missing and Ollama not reachable).');
    }

    if (!Array.isArray(generatedQuestions) || generatedQuestions.length === 0) {
      throw new Error('LLM did not return a valid array of questions from the PDF.');
    }

    // Format and sanitize questions
    const formatted = generatedQuestions.slice(0, num_questions).map((q, idx) => ({
      id: idx + 1,
      question: q.question || `Question ${idx + 1}`,
      type: q.type || question_type,
      difficulty: q.difficulty || difficulty,
      topic_tag: q.topic_tag || retrievedChunks[0]?.topicTag || 'Core Concepts',
      options: question_type.toUpperCase() === 'MCQ' && Array.isArray(q.options) ? q.options : null,
      correct_answer: q.correct_answer || '',
      explanation: q.explanation || `Derived directly from ${doc.filename}.`,
    }));

    const quizId = `quiz-${Date.now()}`;
    quizzesMap.set(quizId, {
      id: quizId,
      documentId: document_id,
      topicOrQuery: topic_or_query || 'All Concepts',
      questionType: question_type,
      difficulty,
      questions: formatted,
      createdAt: new Date().toISOString(),
    });

    return res.json({
      quiz_id: quizId,
      document_id: document_id,
      topic_or_query: topic_or_query || 'All Concepts',
      question_type,
      difficulty,
      num_questions: formatted.length,
      questions: formatted,
    });
  } catch (err: any) {
    console.error('Quiz generation error:', err);
    return res.status(500).json({ detail: err.message || 'Quiz generation failed.' });
  }
});

// Evaluate Quiz Responses
app.post('/api/evaluate', async (req, res): Promise<any> => {
  try {
    const { quiz_id, responses } = req.body;
    const quiz = quizzesMap.get(quiz_id);
    if (!quiz) {
      return res.status(404).json({ detail: 'Quiz session not found.' });
    }

    const qMap = new Map<number, any>();
    quiz.questions.forEach((q) => qMap.set(q.id, q));

    const evaluated: any[] = [];
    let totalScore = 0;
    let correctCount = 0;

    for (const r of responses) {
      const q = qMap.get(r.question_id);
      if (!q) continue;

      const studentAns = (r.student_answer || '').trim();
      let isCorrect = false;
      let scoreAwarded = 0;
      let feedback = '';

      if (q.type.toUpperCase() === 'MCQ') {
        const cAns = (q.correct_answer || '').trim();
        const matched =
          studentAns.toLowerCase() === cAns.toLowerCase() ||
          (studentAns.length === 1 && cAns.startsWith(studentAns)) ||
          studentAns.slice(0, 2) === cAns.slice(0, 2);

        isCorrect = matched;
        scoreAwarded = matched ? 1.0 : 0.0;
        feedback = matched ? 'Correct answer! Matches reference text.' : `Incorrect. The correct choice is: ${q.correct_answer}`;
      } else {
        // Keyword density & semantics
        const refWords = new Set<string>((q.correct_answer + ' ' + q.explanation).toLowerCase().match(/\b[a-z]{4,}\b/g) || []);
        const ansWords = new Set<string>(studentAns.toLowerCase().match(/\b[a-z]{4,}\b/g) || []);
        let matchCount = 0;
        ansWords.forEach((w: string) => {
          if (refWords.has(w)) matchCount++;
        });

        const density = refWords.size > 0 ? matchCount / Math.min(refWords.size, 10) : 0;
        scoreAwarded = Math.min(1.0, Math.round(density * 125) / 100);
        isCorrect = scoreAwarded >= 0.6;
        feedback =
          scoreAwarded >= 0.8
            ? 'Excellent! Essential mechanisms and definitions are accurately stated.'
            : isCorrect
            ? 'Good answer! Captured key principles from the PDF notes.'
            : `Needs improvement. Expected answer: ${q.correct_answer}`;
      }

      totalScore += scoreAwarded;
      if (isCorrect) correctCount++;

      evaluated.push({
        question_id: q.id,
        question_text: q.question,
        topic_tag: q.topic_tag,
        student_answer: studentAns,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        is_correct: isCorrect,
        score_awarded: scoreAwarded,
        feedback,
      });
    }

    const maxScore = evaluated.length;
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    const attemptId = `att-${Date.now()}`;

    attemptsList.push({
      id: attemptId,
      quiz_id,
      total_questions: maxScore,
      correct_count: correctCount,
      total_score: Math.round(totalScore * 10) / 10,
      max_score: maxScore,
      percentage,
      evaluated_responses: evaluated,
      completed_at: new Date().toISOString(),
    });

    return res.json({
      attempt_id: attemptId,
      quiz_id,
      total_questions: maxScore,
      correct_count: correctCount,
      total_score: Math.round(totalScore * 10) / 10,
      max_score: maxScore,
      percentage,
      results: evaluated,
    });
  } catch (err: any) {
    console.error('Evaluation error:', err);
    return res.status(500).json({ detail: err.message || 'Evaluation failed.' });
  }
});

// Analytics Summary
app.get('/api/analytics', (_req, res) => {
  const totalAttempts = attemptsList.length;
  let totalQuestions = 0;
  let totalScoreEarned = 0;
  const topicMap: Record<string, { total: number; correct: number }> = {};

  for (const att of attemptsList) {
    for (const r of att.evaluated_responses) {
      totalQuestions++;
      totalScoreEarned += r.score_awarded;
      const t = r.topic_tag || 'Core Concepts';
      if (!topicMap[t]) topicMap[t] = { total: 0, correct: 0 };
      topicMap[t].total += 1;
      if (r.is_correct || r.score_awarded >= 0.6) {
        topicMap[t].correct += 1;
      }
    }
  }

  const topicAnalytics = Object.entries(topicMap).map(([topic, stats]) => {
    const acc = Math.round((stats.correct / stats.total) * 100);
    return {
      topic,
      total_questions: stats.total,
      correct_answers: stats.correct,
      accuracy_percentage: acc,
      status: acc >= 80 ? 'Mastered' : acc >= 60 ? 'Needs Review' : 'Weak Topic',
    };
  });

  const weakTopics = topicAnalytics.filter((t) => t.accuracy_percentage < 60);
  const recommendations: string[] = [];

  if (weakTopics.length > 0) {
    weakTopics.forEach((wt) => {
      recommendations.push(`Priority: Review '${wt.topic}' (${wt.accuracy_percentage}% accuracy). Practice a 5-question quiz.`);
    });
    recommendations.push('Tip: Review definitions, constraints, and transition diagrams cited in explanations.');
  } else if (totalQuestions > 0) {
    recommendations.push('Great job! All evaluated topics exceed 60% accuracy. Test with Hard difficulty or Viva questions.');
  } else {
    recommendations.push('Upload a PDF and complete your first quiz to receive targeted weak-topic recommendations!');
  }

  res.json({
    total_quizzes_taken: totalAttempts,
    total_questions_answered: totalQuestions,
    overall_accuracy: totalQuestions > 0 ? Math.round((totalScoreEarned / totalQuestions) * 100) : 0,
    average_score_percentage: totalAttempts > 0 ? Math.round(attemptsList.reduce((a, b) => a + b.percentage, 0) / totalAttempts) : 0,
    recent_attempts: attemptsList.slice(-10).reverse().map((a) => ({
      id: a.id,
      percentage: a.percentage,
      correct_count: a.correct_count,
      total_questions: a.total_questions,
      completed_at: a.completed_at.slice(0, 16).replace('T', ' '),
    })),
    topic_analytics: topicAnalytics.sort((a, b) => a.accuracy_percentage - b.accuracy_percentage),
    weak_topics: weakTopics,
    study_recommendations: recommendations,
  });
});

// Global Express API Error Middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Global Express Error Handler]:', err);
  res.status(err.status || 500).json({
    detail: err.message || 'An unexpected server error occurred.',
  });
});

// ---------------- Vite Middleware Mounting ----------------
async function startServer() {
  await preloadAttachedPdfs();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EduGenAI Full-Stack Server running at http://localhost:${PORT}`);
  });
}

startServer();
