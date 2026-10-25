import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  BookOpen,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Sparkles,
  UploadCloud,
  Cpu,
  Send,
  RotateCcw,
  BarChart3,
  Code2,
  Copy,
  Check,
  Terminal,
  Sliders,
  ArrowRight,
  RefreshCw,
  FileCheck,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import {
  evaluateMcqAnswer,
  evaluateFreeTextAnswer,
  calculateTopicAnalytics,
  EvaluationResult,
  QuizQuestion,
} from './utils/ragLogic';

interface DocumentItem {
  id: string;
  filename: string;
  file_size_bytes: number;
  total_pages: number;
  chunk_count: number;
  created_at?: string;
}

const PROJECT_FILES: Record<string, { language: string; content: string; desc: string }> = {
  'server.ts': {
    language: 'typescript',
    desc: 'Full-stack Express backend with CORS headers, 50MB PDF extraction, vector chunking, and AI question generation',
    content: `// Full-Stack Express server with CORS & PDF extraction endpoints
app.use(corsHeaders);
app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ detail: err.message });
    next();
  });
}, async (req, res) => {
  const { text, pages } = await extractTextFromPdfBuffer(req.file.buffer);
  if (!text) return res.status(400).json({ detail: "No extractable text found in PDF." });
  const chunks = chunkDocumentText(text);
  const docId = "doc-" + Date.now();
  documentsMap.set(docId, { id: docId, filename: req.file.originalname, chunks, pages });
  return res.json({ success: true, document_id: docId, total_pages: pages, chunk_count: chunks.length });
});

app.post('/api/generate-quiz', async (req, res) => {
  const { document_id, topic_or_query, question_type, difficulty, num_questions } = req.body;
  const doc = documentsMap.get(document_id);
  // Context strictly from PDF chunks
  const context = doc.chunks.map(c => c.text).join("\\n\\n");
  const questions = await callLLM(context, question_type, difficulty, num_questions);
  return res.json({ quiz_id: "quiz-" + Date.now(), questions });
});`,
  },
  'backend/rag_engine.py': {
    language: 'python',
    desc: 'Python RAG engine: PyMuPDF extraction, 500-char chunking with 100 overlap, and FAISS vector indexing',
    content: `import fitz, faiss, json
from sentence_transformers import SentenceTransformer

class RAGEngine:
    def __init__(self, chunk_size=500, chunk_overlap=100):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    def extract_text_from_pdf(self, file_bytes):
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = [{"page": i+1, "text": doc[i].get_text()} for i in range(len(doc))]
        if not pages or sum(len(p["text"]) for p in pages) == 0:
            raise ValueError("No extractable text found in PDF.")
        return pages

    def chunk_document(self, pages_data):
        chunks = []
        for p in pages_data:
            text = p["text"]
            for start in range(0, len(text), self.chunk_size - self.chunk_overlap):
                slice_txt = text[start:start + self.chunk_size].strip()
                if len(slice_txt) >= 40:
                    chunks.append({"page": p["page"], "text": slice_txt})
        print(f"Extracted {len(chunks)} chunks from PDF. Sample: {chunks[0]['text'][:200] if chunks else 'None'}")
        return chunks`,
  },
  'backend/llm_service.py': {
    language: 'python',
    desc: 'Strict context-grounded prompting with Ollama llama3/mistral, zero mock fallbacks',
    content: `prompt = f"""CRITICAL INSTRUCTION: You must generate questions, answers, and explanations EXCLUSIVELY from the provided STUDY MATERIAL CONTEXT below. Do NOT use external knowledge. Every question must test a specific fact, concept, or section present in the text below.

=== STUDY MATERIAL CONTEXT ===
{context_text}
=== END OF CONTEXT ==="""`,
  },
  'requirements.txt': {
    language: 'text',
    desc: 'Python dependencies',
    content: `fastapi==0.110.0\nuvicorn==0.28.0\nPyMuPDF==1.23.26\nsentence-transformers==2.5.1\nfaiss-cpu==1.8.0\npython-multipart==0.0.9`,
  },
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'upload' | 'quiz' | 'analytics' | 'code'>('upload');

  // Documents state from backend
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(true);

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Direct paste text state
  const [isPasteMode, setIsPasteMode] = useState<boolean>(false);
  const [pastedTitle, setPastedTitle] = useState<string>('');
  const [pastedContent, setPastedContent] = useState<string>('');
  const [isIndexingText, setIsIndexingText] = useState<boolean>(false);

  // Quiz config
  const [topicFocus, setTopicFocus] = useState<string>('');
  const [questionType, setQuestionType] = useState<'MCQ' | 'Short Answer' | 'Long Answer' | 'Viva'>('MCQ');
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [numQuestions, setNumQuestions] = useState<number>(5);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Active Quiz
  const [activeQuizQuestions, setActiveQuizQuestions] = useState<QuizQuestion[]>([]);
  const [activeQuizMeta, setActiveQuizMeta] = useState<any>(null);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, string>>({});
  const [quizTimer, setQuizTimer] = useState<number>(0);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationResults, setEvaluationResults] = useState<EvaluationResult[] | null>(null);
  const [evalSummary, setEvalSummary] = useState<{ totalScore: number; maxScore: number; percentage: number } | null>(null);

  // Analytics state
  const [analyticsData, setAnalyticsData] = useState<any>(null);

  // Code Explorer state
  const [selectedFileKey, setSelectedFileKey] = useState<string>('server.ts');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load documents on mount
  useEffect(() => {
    fetchDocuments();
    fetchAnalytics();
  }, []);

  // Timer Effect
  useEffect(() => {
    let interval: any = null;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setQuizTimer((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const fetchDocuments = async () => {
    try {
      setIsLoadingDocs(true);
      const res = await fetch('/api/documents');
      if (res.ok) {
        const data: DocumentItem[] = await res.json();
        setDocuments(data);
        if (data.length > 0 && !selectedDocId) {
          setSelectedDocId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const res = await fetch('/api/analytics');
      if (res.ok) {
        const data = await res.json();
        setAnalyticsData(data);
      }
    } catch (err) {
      console.error('Error fetching analytics:', err);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Upload handler with validation
  const processSelectedFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Invalid format: Please upload a valid .pdf file.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      alert('File size exceeds the 50MB limit.');
      return;
    }

    setSelectedFile(file);
    setUploadMessage(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

    const handleUploadSubmit = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadMessage(null);

    try {
      // Step 1: Read file as Base64 in browser
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file from browser storage.'));
        reader.readAsDataURL(selectedFile);
      });

      // Step 2: Send as clean JSON (avoids all proxy / multipart HTTP/2 stream issues)
      let res: Response;
      try {
        res = await fetch('/api/upload-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: selectedFile.name,
            base64: base64Data,
          }),
        });
      } catch (jsonErr) {
        console.warn('JSON upload failed, attempting multipart upload fallback...', jsonErr);
        // Fallback to multipart /api/upload
        const formData = new FormData();
        formData.append('file', selectedFile);
        res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
      }

      let data: any = null;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || `Server responded with status ${res.status}`);
      }

      if (!res.ok) {
        throw new Error(data?.detail || `Upload failed with status ${res.status}`);
      }

      setUploadMessage({
        type: 'success',
        text: `Indexed: ${data.filename} (${data.total_pages} pages, ${data.chunk_count} chunks)`,
      });

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Reload documents and select this newly uploaded document
      await fetchDocuments();
      if (data.document_id) {
        setSelectedDocId(data.document_id);
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      let errorMsg = err.message || 'Failed to upload and index PDF.';
      if (errorMsg === 'Failed to fetch') {
        errorMsg = 'Upload request was blocked by network/proxy. You can also use the "Paste Study Text" option below to generate questions instantly.';
      }
      setUploadMessage({
        type: 'error',
        text: errorMsg,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleIndexPastedText = async () => {
    if (!pastedContent.trim()) {
      alert('Please enter or paste your study notes.');
      return;
    }

    setIsIndexingText(true);
    setUploadMessage(null);

    try {
      const res = await fetch('/api/index-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pastedTitle.trim() || undefined,
          content: pastedContent,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || 'Failed to index study notes.');
      }

      setUploadMessage({
        type: 'success',
        text: `Indexed: ${data.filename} (${data.total_pages} page(s), ${data.chunk_count} chunks)`,
      });

      setPastedTitle('');
      setPastedContent('');
      setIsPasteMode(false);

      await fetchDocuments();
      if (data.document_id) {
        setSelectedDocId(data.document_id);
      }
    } catch (err: any) {
      console.error('Text indexing error:', err);
      setUploadMessage({
        type: 'error',
        text: err.message || 'Failed to index notes.',
      });
    } finally {
      setIsIndexingText(false);
    }
  };

  const handleDeleteDocument = async (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchDocuments();
        if (selectedDocId === docId) {
          setSelectedDocId('');
        }
      }
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  // Generate Quiz handler - calls real /api/generate-quiz
  const handleGenerateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedDocId) {
      alert('Please upload or select a document first.');
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    try {
      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: selectedDocId,
          topic_or_query: topicFocus.trim() || null,
          question_type: questionType,
          difficulty: difficulty,
          num_questions: numQuestions,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `Question generation failed (${res.status})`);
      }

      if (!data.questions || data.questions.length === 0) {
        throw new Error('No questions were generated from this PDF. Please verify the document text.');
      }

      // Set active quiz state
      setActiveQuizQuestions(data.questions);
      setActiveQuizMeta(data);
      setStudentAnswers({});
      setEvaluationResults(null);
      setEvalSummary(null);
      setQuizTimer(0);
      setIsTimerRunning(true);
      setActiveTab('quiz');
    } catch (err: any) {
      setGenerationError(err.message || 'Generation error occurred.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Submit Quiz for evaluation
  const handleEvaluateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuizMeta) return;

    setIsEvaluating(true);

    const responses = activeQuizQuestions.map((q) => ({
      question_id: q.id,
      student_answer: studentAnswers[q.id] || '',
    }));

    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quiz_id: activeQuizMeta.quiz_id,
          responses,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Evaluation failed');
      }

      setIsTimerRunning(false);
      setEvaluationResults(data.results);
      setEvalSummary({
        totalScore: data.total_score,
        maxScore: data.max_score,
        percentage: data.percentage,
      });

      // Refresh global analytics
      await fetchAnalytics();

      if (data.percentage >= 80) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      }
    } catch (err: any) {
      alert(`Evaluation Error: ${err.message}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const activeDocObj = documents.find((d) => d.id === selectedDocId);
  const answeredCount = Object.keys(studentAnswers).filter((k) => studentAnswers[Number(k)]?.trim()).length;
  const progressPct = activeQuizQuestions.length > 0 ? (answeredCount / activeQuizQuestions.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner">
              <BookOpen className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight">
                  Edu<span className="text-blue-500">GenAI</span>
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                  Live RAG Engine
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">Real PDF Question Generation • Zero Fallbacks</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setActiveTab('upload')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'upload'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload & RAG</span>
            </button>

            <button
              onClick={() => setActiveTab('quiz')}
              className={`relative px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'quiz'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Active Quiz</span>
              {activeQuizQuestions.length > 0 && !evaluationResults && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'analytics'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Analytics & Mastery</span>
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'code'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Code2 className="w-4 h-4" />
              <span>Project Files</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* ================= TAB 1: UPLOAD & RAG GENERATOR ================= */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            {/* Banner */}
            <div className="bg-gradient-to-r from-blue-950/40 via-slate-900 to-indigo-950/40 border border-blue-900/30 rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-400" />
                  PDF Question Generation Strictly from Uploaded Notes
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl">
                  Upload any PDF study material. The backend extracts text page-by-page, generates vector chunks,
                  and generates questions strictly grounded in the document text with zero generic fallbacks.
                </p>
              </div>
              <div className="flex items-center gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <Cpu className="w-8 h-8 text-blue-400 flex-shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-200">100% PDF Grounded</div>
                  <div className="text-slate-400">Strict Context Extraction</div>
                </div>
              </div>
            </div>

            {/* Error Banner */}
            {generationError && (
              <div className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-200 text-xs flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <div>
                  <strong>Generation Error:</strong> {generationError}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Upload New PDF */}
              <div className="lg:col-span-6 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold">1</div>
                      <h2 className="font-bold text-base text-slate-100">Study Material Source</h2>
                    </div>
                    <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setIsPasteMode(false);
                          setUploadMessage(null);
                        }}
                        className={`px-3 py-1 rounded-lg font-medium transition ${
                          !isPasteMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Upload PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPasteMode(true);
                          setUploadMessage(null);
                        }}
                        className={`px-3 py-1 rounded-lg font-medium transition ${
                          isPasteMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Paste Notes
                      </button>
                    </div>
                  </div>

                  {!isPasteMode ? (
                    <>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".pdf"
                        onChange={handleFileSelect}
                        className="hidden"
                      />

                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsDragging(true);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsDragging(false);
                        }}
                        onDrop={handleDrop}
                        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center group ${
                          isDragging
                            ? 'border-blue-400 bg-blue-950/30'
                            : 'border-slate-700 hover:border-blue-500 bg-slate-950/50 hover:bg-blue-950/10'
                        }`}
                      >
                        <UploadCloud className={`w-10 h-10 mb-2 transition-colors ${isDragging ? 'text-blue-400' : 'text-slate-400 group-hover:text-blue-400'}`} />
                        <h3 className="font-semibold text-sm text-slate-200 mb-1">
                          {selectedFile ? selectedFile.name : isDragging ? 'Drop PDF file here' : 'Click to Browse or Drag & Drop PDF'}
                        </h3>
                        <p className="text-xs text-slate-400 max-w-sm mb-3">
                          {selectedFile
                            ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB - Ready to index`
                            : 'Upload any lecture handouts, textbooks, or exam notes (.pdf format up to 50MB).'}
                        </p>
                        <button
                          type="button"
                          className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
                        >
                          {selectedFile ? 'Change File' : 'Select PDF File'}
                        </button>
                      </div>

                      {selectedFile && (
                        <div className="mt-3">
                          <button
                            onClick={handleUploadSubmit}
                            disabled={isUploading}
                            className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-blue-900/30"
                          >
                            {isUploading ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Extracting text & vectorizing chunks...</span>
                              </>
                            ) : (
                              <>
                                <UploadCloud className="w-3.5 h-3.5" />
                                <span>Process & Index This Document</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">
                          Document Title / Subject:
                        </label>
                        <input
                          type="text"
                          value={pastedTitle}
                          onChange={(e) => setPastedTitle(e.target.value)}
                          placeholder="e.g. Operating Systems Unit 3, DBMS Transactions"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">
                          Study Material / Lecture Content:
                        </label>
                        <textarea
                          rows={6}
                          value={pastedContent}
                          onChange={(e) => setPastedContent(e.target.value)}
                          placeholder="Paste lecture notes, textbook passages, definitions, or syllabus contents here..."
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                      <button
                        onClick={handleIndexPastedText}
                        disabled={isIndexingText || !pastedContent.trim()}
                        className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-blue-900/30"
                      >
                        {isIndexingText ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Vectorizing chunks into storage...</span>
                          </>
                        ) : (
                          <>
                            <FileText className="w-3.5 h-3.5" />
                            <span>Index Notes & Prepare Quiz</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {uploadMessage && (
                    <div
                      className={`mt-3 p-3 rounded-xl text-xs flex items-center gap-2 ${
                        uploadMessage.type === 'success'
                          ? 'bg-emerald-950/50 border border-emerald-800 text-emerald-200'
                          : 'bg-red-950/50 border border-red-800 text-red-200'
                      }`}
                    >
                      {uploadMessage.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      )}
                      <span>{uploadMessage.text}</span>
                    </div>
                  )}

                  {/* Quick Preset Selector for Testing Multiple PDFs */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80">
                    <span className="text-[11px] font-medium text-slate-400 block mb-1.5">
                      Quickly test with attached study notes:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {documents.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setSelectedDocId(d.id);
                            setUploadMessage(null);
                          }}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition flex items-center gap-1.5 ${
                            selectedDocId === d.id
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-semibold'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                          }`}
                        >
                          <FileText className="w-3 h-3" />
                          <span className="truncate max-w-[140px]">{d.filename}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Available Indexed Documents List */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                        Available Indexed Documents ({documents.length}):
                      </label>
                      <button
                        type="button"
                        onClick={fetchDocuments}
                        className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Refresh</span>
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {documents.length > 0 ? (
                        documents.map((doc) => (
                          <div
                            key={doc.id}
                            onClick={() => setSelectedDocId(doc.id)}
                            className={`w-full p-2.5 rounded-xl text-left border cursor-pointer transition flex items-center justify-between group ${
                              selectedDocId === doc.id
                                ? 'bg-blue-600/10 border-blue-500/50 text-white'
                                : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                            }`}
                          >
                            <div className="truncate flex-1">
                              <div className="text-xs font-semibold truncate">{doc.filename}</div>
                              <div className="text-[11px] text-slate-400">
                                {doc.total_pages} page(s) • {doc.chunk_count} vector chunks
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {selectedDocId === doc.id && (
                                <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-medium">
                                  Active
                                </span>
                              )}
                              <button
                                type="button"
                                title="Remove document from memory"
                                onClick={(e) => handleDeleteDocument(doc.id, e)}
                                className="opacity-0 group-hover:opacity-100 hover:text-red-400 text-slate-500 p-1 rounded transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-3 text-xs text-slate-500 bg-slate-950 rounded-xl text-center">
                          {isLoadingDocs ? 'Loading documents...' : 'No documents indexed yet. Upload one above!'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {activeDocObj && (
                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                    <div className="flex items-center gap-1.5 truncate">
                      <FileCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="truncate">Selected: <strong>{activeDocObj.filename}</strong></span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px] flex-shrink-0">
                      {activeDocObj.chunk_count} chunks
                    </span>
                  </div>
                )}
              </div>

              {/* Right Column: Quiz Configuration Form */}
              <div className="lg:col-span-6 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">2</div>
                      <h2 className="font-bold text-base text-slate-100">Configure Practice Quiz</h2>
                    </div>
                    <Sliders className="w-4 h-4 text-slate-400" />
                  </div>

                  <form onSubmit={handleGenerateQuiz} className="space-y-4">
                    {/* Active Doc Selector */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Selected Document Target
                      </label>
                      <select
                        value={selectedDocId}
                        onChange={(e) => setSelectedDocId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        {documents.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.filename} ({d.total_pages} pages, {d.chunk_count} chunks)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Sub-Topic Focus */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Sub-Topic Focus or Keyword <span className="text-slate-500 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={topicFocus}
                        onChange={(e) => setTopicFocus(e.target.value)}
                        placeholder="e.g. DFA, Regular Expressions, ER Model, ACID properties, Pumping Lemma..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
                      />
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        Leave blank to evenly cover all core concepts across the entire document.
                      </span>
                    </div>

                    {/* Question Type Selector */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Question Format
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(['MCQ', 'Short Answer', 'Long Answer', 'Viva'] as const).map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setQuestionType(type)}
                            className={`py-2 px-2 rounded-xl text-xs font-semibold border transition text-center ${
                              questionType === type
                                ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-600/20'
                                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                            }`}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Difficulty and Question Count */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                          Difficulty
                        </label>
                        <select
                          value={difficulty}
                          onChange={(e) => setDifficulty(e.target.value as any)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                        >
                          <option value="Easy">Easy (Foundational)</option>
                          <option value="Medium">Medium (Standard)</option>
                          <option value="Hard">Hard (Analytical)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                          Questions Count
                        </label>
                        <select
                          value={numQuestions}
                          onChange={(e) => setNumQuestions(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                        >
                          <option value={3}>3 Questions (Quick Test)</option>
                          <option value={5}>5 Questions (Standard)</option>
                          <option value={10}>10 Questions (Deep Review)</option>
                        </select>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={isGenerating || !selectedDocId}
                        className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isGenerating ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Retrieving Chunks & Calling LLM...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            <span>Generate Questions from PDF</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 2: ACTIVE QUIZ ================= */}
        {activeTab === 'quiz' && (
          <div className="space-y-6">
            {activeQuizQuestions.length === 0 ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center max-w-xl mx-auto my-12">
                <div className="w-16 h-16 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-100 mb-2">No Active Quiz</h3>
                <p className="text-sm text-slate-400 mb-6">
                  Select your document in the <strong>Upload & RAG</strong> tab and generate questions strictly from it.
                </p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition inline-flex items-center gap-2"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>Go to Upload & Generator</span>
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header Banner */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {activeQuizMeta?.question_type || questionType}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {activeQuizMeta?.difficulty || difficulty}
                      </span>
                      <span className="text-xs text-slate-400">
                        Source: {activeDocObj?.filename || 'Uploaded Document'}
                      </span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold text-white">
                      {activeQuizMeta?.topic_or_query || 'PDF Practice Questions'}
                    </h2>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-sm font-semibold text-amber-400">
                      <Clock className="w-4 h-4 text-amber-400" />
                      <span>{formatTime(quizTimer)}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Answered</div>
                      <div className="text-sm font-bold text-slate-200">
                        {answeredCount} / {activeQuizQuestions.length}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress */}
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                {/* Evaluation Summary */}
                {evaluationResults && evalSummary && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                          Automated Evaluation Complete
                        </span>
                        <h3 className="text-2xl font-bold text-white mt-1">Quiz Performance Summary</h3>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <div className="text-xs text-slate-400">Total Score</div>
                          <div className="text-2xl font-extrabold text-blue-400">
                            {evalSummary.totalScore} / {evalSummary.maxScore}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-slate-400">Accuracy</div>
                          <div
                            className={`text-2xl font-extrabold ${
                              evalSummary.percentage >= 80
                                ? 'text-emerald-400'
                                : evalSummary.percentage >= 60
                                ? 'text-amber-400'
                                : 'text-red-400'
                            }`}
                          >
                            {evalSummary.percentage}%
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 justify-end pt-2">
                      <button
                        onClick={() => {
                          setEvaluationResults(null);
                          setStudentAnswers({});
                          setQuizTimer(0);
                          setIsTimerRunning(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retake Quiz</span>
                      </button>
                      <button
                        onClick={() => setActiveTab('analytics')}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition flex items-center gap-1.5"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>View Topic Analytics</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Questions List */}
                <form onSubmit={handleEvaluateQuiz} className="space-y-4">
                  {activeQuizQuestions.map((q, idx) => {
                    const evalResult = evaluationResults ? evaluationResults[idx] : null;
                    const evalScore = evalResult ? (evalResult.score_awarded ?? evalResult.scoreAwarded ?? 0) : 0;
                    const evalCorrect = evalResult ? (evalResult.is_correct ?? evalResult.isCorrect ?? false) : false;

                    return (
                      <div
                        key={q.id}
                        className={`bg-slate-900/80 border rounded-2xl p-5 sm:p-6 transition-all ${
                          evalResult
                            ? evalCorrect || evalScore >= 0.7
                              ? 'border-emerald-500/50 bg-emerald-950/10'
                              : evalScore >= 0.35
                              ? 'border-amber-500/50 bg-amber-950/10'
                              : 'border-red-500/50 bg-red-950/10'
                            : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-300 text-xs font-bold flex items-center justify-center">
                              {idx + 1}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-blue-400 border border-slate-700">
                              {q.topic_tag || q.topicTag || 'PDF Concept'}
                            </span>
                          </div>
                          {evalResult && (
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 ${
                                evalCorrect || evalScore >= 0.7
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : evalScore >= 0.35
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                  : 'bg-red-500/10 text-red-400 border border-red-500/30'
                              }`}
                            >
                              <span>Score: {evalScore} / 1.0</span>
                            </span>
                          )}
                        </div>

                        <h4 className="text-base font-semibold text-slate-100 mb-4">{q.question}</h4>

                        {/* Options / Text Input */}
                        {q.options && Array.isArray(q.options) ? (
                          <div className="grid grid-cols-1 gap-2.5">
                            {q.options.map((option, optIdx) => {
                              const isSelected = studentAnswers[q.id] === option;
                              const isCorrectOpt = evalResult && ((q.correct_answer || q.correctAnswer) === option);

                              let optBorder = 'border-slate-800 bg-slate-950/50 hover:bg-slate-800/50 text-slate-300';
                              if (isSelected && !evalResult) {
                                optBorder = 'border-blue-500 bg-blue-600/10 text-white';
                              } else if (evalResult) {
                                if (isCorrectOpt) {
                                  optBorder = 'border-emerald-500 bg-emerald-950/30 text-emerald-200 font-semibold';
                                } else if (isSelected && !evalCorrect) {
                                  optBorder = 'border-red-500 bg-red-950/30 text-red-200';
                                }
                              }

                              return (
                                <label
                                  key={optIdx}
                                  className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between text-xs sm:text-sm ${optBorder}`}
                                >
                                  <div className="flex items-center gap-3">
                                    <input
                                      type="radio"
                                      name={`question_${q.id}`}
                                      value={option}
                                      checked={isSelected}
                                      disabled={!!evalResult}
                                      onChange={() =>
                                        setStudentAnswers((prev) => ({
                                          ...prev,
                                          [q.id]: option,
                                        }))
                                      }
                                      className="text-blue-600 focus:ring-blue-500"
                                    />
                                    <span>{option}</span>
                                  </div>
                                  {evalResult && isCorrectOpt && (
                                    <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded">
                                      Correct
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <div>
                            <textarea
                              rows={3}
                              disabled={!!evalResult}
                              value={studentAnswers[q.id] || ''}
                              onChange={(e) =>
                                setStudentAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              placeholder="Type your response based strictly on the PDF context..."
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-75"
                            />
                          </div>
                        )}

                        {/* Explanations */}
                        {evalResult && (
                          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-2 text-xs">
                            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                              <span className="font-bold text-emerald-400 block mb-1">Model Answer:</span>
                              <p className="text-slate-300">{q.correct_answer || q.correctAnswer}</p>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                              <span className="font-bold text-blue-400 block mb-1">Pedagogical Explanation:</span>
                              <p className="text-slate-300">{q.explanation}</p>
                            </div>
                            <div className="text-slate-400 italic">
                              <strong>Feedback:</strong> {evalResult.feedback}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {!evaluationResults && (
                    <div className="sticky bottom-4 z-40 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-2xl">
                      <span className="text-xs text-slate-400 hidden sm:block">
                        Submit answers to receive automated evaluation based strictly on your PDF material.
                      </span>
                      <button
                        type="submit"
                        disabled={isEvaluating}
                        className="ml-auto px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
                      >
                        {isEvaluating ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Evaluating Responses...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            <span>Submit Quiz for Automated Evaluation</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </form>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: ANALYTICS & WEAK TOPICS ================= */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quizzes Completed</span>
                <div className="text-3xl font-extrabold text-blue-400 mt-2 mb-1">
                  {analyticsData?.total_quizzes_taken ?? 0}
                </div>
                <span className="text-[11px] text-slate-500">Across all study materials</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Questions Evaluated</span>
                <div className="text-3xl font-extrabold text-cyan-400 mt-2 mb-1">
                  {analyticsData?.total_questions_answered ?? 0}
                </div>
                <span className="text-[11px] text-slate-500">All questions assessed</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Overall Accuracy</span>
                <div className="text-3xl font-extrabold text-emerald-400 mt-2 mb-1">
                  {analyticsData?.overall_accuracy ?? 0}%
                </div>
                <span className="text-[11px] text-slate-500">Target benchmark: &ge; 80%</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Weak Topics Found</span>
                <div className="text-3xl font-extrabold text-red-400 mt-2 mb-1">
                  {analyticsData?.weak_topics?.length ?? 0}
                </div>
                <span className="text-[11px] text-slate-500">Accuracy &lt; 60%</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Recommendations */}
              <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Targeted Study Recommendations
                </h3>
                <div className="space-y-2.5">
                  {analyticsData?.study_recommendations?.map((rec: string, i: number) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-xl bg-slate-950 border-l-4 border-l-amber-500 border border-slate-800 text-xs text-slate-300 leading-relaxed"
                    >
                      {rec}
                    </div>
                  )) || (
                    <div className="p-3.5 rounded-xl bg-slate-950 text-xs text-slate-400">
                      Complete a quiz to generate weak-topic recommendations.
                    </div>
                  )}
                </div>
              </div>

              {/* Topic Mastery Bars */}
              <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-400" />
                    Topic-Wise Accuracy Breakdown
                  </h3>
                  <span className="text-xs text-slate-400">Benchmark: 80%</span>
                </div>

                <div className="space-y-3.5">
                  {analyticsData?.topic_analytics && analyticsData.topic_analytics.length > 0 ? (
                    analyticsData.topic_analytics.map((t: any) => (
                      <div key={t.topic} className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-slate-200">{t.topic}</span>
                          <span className="text-slate-400 font-mono">
                            {t.correct_answers}/{t.total_questions} ({t.accuracy_percentage}%)
                          </span>
                        </div>
                        <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              t.accuracy_percentage >= 80
                                ? 'bg-emerald-500'
                                : t.accuracy_percentage >= 60
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${t.accuracy_percentage}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-xs text-slate-500">
                      No topic analytics recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 4: PROJECT FILES ================= */}
        {activeTab === 'code' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-1">
                <Code2 className="w-5 h-5 text-blue-400" />
                Live Architecture & Code Deliverables
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-6">
                All mock questions removed. PDF text is parsed directly from document buffers and streamed to the RAG pipeline.
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-4 bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-2 block mb-2">
                    Project Tree
                  </span>
                  {Object.keys(PROJECT_FILES).map((fileName) => (
                    <button
                      key={fileName}
                      onClick={() => setSelectedFileKey(fileName)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono flex items-center justify-between transition ${
                        selectedFileKey === fileName
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                          : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{fileName}</span>
                      </div>
                      <ChevronRight className="w-3 h-3 text-slate-600" />
                    </button>
                  ))}
                </div>

                <div className="lg:col-span-8 bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
                    <div>
                      <span className="font-mono text-xs font-bold text-slate-200">{selectedFileKey}</span>
                      <p className="text-[11px] text-slate-500">{PROJECT_FILES[selectedFileKey]?.desc}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(PROJECT_FILES[selectedFileKey]?.content, selectedFileKey)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-300 border border-slate-700 flex items-center gap-1.5 transition"
                    >
                      {copiedKey === selectedFileKey ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Code</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="text-xs font-mono text-slate-300 bg-slate-900/60 p-4 rounded-xl overflow-x-auto flex-1 max-h-[460px] leading-relaxed">
                    {PROJECT_FILES[selectedFileKey]?.content}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 px-4 text-center text-xs text-slate-500">
        EduGenAI – Live RAG PDF Question Generation & Learning Assistant • Zero Fallbacks
      </footer>
    </div>
  );
}
