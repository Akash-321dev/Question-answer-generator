/**
 * EduGenAI - Frontend Client Logic
 * Handles PDF ingestion, real RAG quiz generation via Ollama, interactive quiz taking,
 * automated evaluation feedback, and weak-topic analytics.
 * Zero mock/dummy questions: strictly queries the backend API.
 */

const API_BASE = window.location.origin;

// State Variables
let selectedFile = null;
let currentDocuments = [];
let activeDocumentId = null;  // Dedicated state variable storing the uploaded/selected document_id
let activeQuiz = null;
let quizTimerId = null;
let quizSeconds = 0;

// DOM Elements
const ollamaStatusDot = document.getElementById("ollamaStatusDot");
const ollamaStatusText = document.getElementById("ollamaStatusText");
const dropzone = document.getElementById("dropzone");
const pdfFileInput = document.getElementById("pdfFileInput");
const selectFileBtn = document.getElementById("selectFileBtn");
const fileInfoBox = document.getElementById("fileInfoBox");
const selectedFileName = document.getElementById("selectedFileName");
const selectedFileSize = document.getElementById("selectedFileSize");
const clearFileBtn = document.getElementById("clearFileBtn");
const uploadBtn = document.getElementById("uploadBtn");
const indexingSpinner = document.getElementById("indexingSpinner");
const uploadSuccessAlert = document.getElementById("uploadSuccessAlert");
const alertDocName = document.getElementById("alertDocName");
const alertDocDetails = document.getElementById("alertDocDetails");

const documentSelect = document.getElementById("documentSelect");
const quizConfigForm = document.getElementById("quizConfigForm");
const topicQueryInput = document.getElementById("topicQueryInput");
const difficultySelect = document.getElementById("difficultySelect");
const numQuestionsSelect = document.getElementById("numQuestionsSelect");
const generationSpinner = document.getElementById("generationSpinner");

const quizBadge = document.getElementById("quizBadge");
const quizEmptyState = document.getElementById("quizEmptyState");
const activeQuizContainer = document.getElementById("activeQuizContainer");
const quizMetaTitle = document.getElementById("quizMetaTitle");
const quizMetaType = document.getElementById("quizMetaType");
const quizMetaDifficulty = document.getElementById("quizMetaDifficulty");
const quizMetaDoc = document.getElementById("quizMetaDoc");
const quizTimer = document.getElementById("quizTimer");
const quizProgressBar = document.getElementById("quizProgressBar");
const quizProgressText = document.getElementById("quizProgressText");
const questionsContainer = document.getElementById("questionsContainer");
const quizSubmissionForm = document.getElementById("quizSubmissionForm");
const evaluationResultsCard = document.getElementById("evaluationResultsCard");
const evalScoreText = document.getElementById("evalScoreText");
const evalPercentageText = document.getElementById("evalPercentageText");
const evalBreakdownContainer = document.getElementById("evalBreakdownContainer");

const goToUploadBtn = document.getElementById("goToUploadBtn");
const retakeQuizBtn = document.getElementById("retakeQuizBtn");
const viewAnalyticsBtn = document.getElementById("viewAnalyticsBtn");

// Analytics elements
const kpiQuizzes = document.getElementById("kpiQuizzes");
const kpiQuestions = document.getElementById("kpiQuestions");
const kpiAccuracy = document.getElementById("kpiAccuracy");
const kpiWeakTopics = document.getElementById("kpiWeakTopics");
const recommendationsList = document.getElementById("recommendationsList");
const weakTopicsPills = document.getElementById("weakTopicsPills");
const topicProgressContainer = document.getElementById("topicProgressContainer");
const recentAttemptsTbody = document.getElementById("recentAttemptsTbody");

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  initHealthCheck();
  loadDocuments();
  setupEventListeners();
  loadAnalytics();
});

// ---------------- Health Check ----------------
async function initHealthCheck() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) {
      const data = await res.json();
      const ol = data.ollama;
      if (ol && ol.status === "connected") {
        ollamaStatusDot.className = "status-dot online";
        ollamaStatusText.textContent = `Ollama: ${ol.configured_model} (Online)`;
        ollamaStatusText.title = `Available models: ${ol.available_models ? ol.available_models.join(', ') : 'None'}`;
      } else {
        ollamaStatusDot.className = "status-dot offline";
        ollamaStatusText.textContent = "Ollama: Offline (Run 'ollama serve')";
      }
    } else {
      ollamaStatusDot.className = "status-dot offline";
      ollamaStatusText.textContent = "Backend Offline";
    }
  } catch (e) {
    ollamaStatusDot.className = "status-dot offline";
    ollamaStatusText.textContent = "Backend / LLM Offline";
  }
}

// ---------------- Document & File Handling ----------------
async function loadDocuments() {
  try {
    const res = await fetch(`${API_BASE}/api/documents`);
    if (res.ok) {
      currentDocuments = await res.json();
      populateDocumentSelect();
    }
  } catch (err) {
    console.error("Failed to load documents:", err);
  }
}

function populateDocumentSelect() {
  documentSelect.innerHTML = "";
  if (currentDocuments.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No documents indexed yet. Upload a PDF first!";
    opt.disabled = true;
    opt.selected = true;
    documentSelect.appendChild(opt);
    activeDocumentId = null;
    return;
  }

  currentDocuments.forEach((doc, idx) => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = `${doc.filename} (${doc.total_pages} pgs, ${doc.chunk_count} chunks)`;
    if (activeDocumentId && doc.id === activeDocumentId) {
      opt.selected = true;
    } else if (!activeDocumentId && idx === 0) {
      opt.selected = true;
      activeDocumentId = doc.id;
    }
    documentSelect.appendChild(opt);
  });
}

function setupEventListeners() {
  // Dropzone clicks
  selectFileBtn.addEventListener("click", () => pdfFileInput.click());
  dropzone.addEventListener("click", (e) => {
    if (e.target !== selectFileBtn) pdfFileInput.click();
  });

  // Drag and drop
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  pdfFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  clearFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    selectedFile = null;
    pdfFileInput.value = "";
    fileInfoBox.classList.add("d-none");
    dropzone.classList.remove("d-none");
    uploadSuccessAlert.classList.add("d-none");
  });

  // Track document select changes
  documentSelect.addEventListener("change", (e) => {
    activeDocumentId = e.target.value;
  });

  // Upload button
  uploadBtn.addEventListener("click", handleUpload);

  // Generate quiz form
  quizConfigForm.addEventListener("submit", handleGenerateQuiz);

  // Quiz submission
  quizSubmissionForm.addEventListener("submit", handleQuizSubmit);

  // Navigation helpers
  if (goToUploadBtn) {
    goToUploadBtn.addEventListener("click", () => {
      const tabEl = document.querySelector("#upload-tab");
      bootstrap.Tab.getInstance(tabEl)?.show() || new bootstrap.Tab(tabEl).show();
    });
  }

  if (retakeQuizBtn) {
    retakeQuizBtn.addEventListener("click", () => {
      if (activeQuiz) renderActiveQuiz(activeQuiz);
    });
  }

  if (viewAnalyticsBtn) {
    viewAnalyticsBtn.addEventListener("click", () => {
      const tabEl = document.querySelector("#analytics-tab");
      bootstrap.Tab.getInstance(tabEl)?.show() || new bootstrap.Tab(tabEl).show();
      loadAnalytics();
    });
  }

  // Refresh analytics when switching to analytics tab
  document.getElementById("analytics-tab").addEventListener("shown.bs.tab", () => {
    loadAnalytics();
  });
}

function handleFileSelected(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    alert("Invalid format: Please select a valid PDF file (.pdf).");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    alert("File exceeds maximum allowed size of 20 MB.");
    return;
  }
  if (file.size === 0) {
    alert("The selected file is empty (0 bytes).");
    return;
  }

  selectedFile = file;
  selectedFileName.textContent = file.name;
  selectedFileSize.textContent = `(${(file.size / (1024 * 1024)).toFixed(2)} MB)`;

  dropzone.classList.add("d-none");
  fileInfoBox.classList.remove("d-none");
  uploadSuccessAlert.classList.add("d-none");
}

async function handleUpload() {
  if (!selectedFile) {
    alert("Please select or drop a PDF file first.");
    return;
  }

  const formData = new FormData();
  formData.append("file", selectedFile);

  uploadBtn.disabled = true;
  indexingSpinner.classList.remove("d-none");
  uploadSuccessAlert.classList.add("d-none");

  try {
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || `Upload failed with HTTP ${res.status}`);
    }

    // Save document_id in state variable
    activeDocumentId = data.document_id;

    // Display confirmation
    alertDocName.textContent = `Indexed: ${data.filename}`;
    alertDocDetails.textContent = `${data.total_pages} page(s) extracted into ${data.chunk_count} local FAISS vector chunks.`;
    uploadSuccessAlert.classList.remove("d-none");

    // Refresh documents list and set selected document
    await loadDocuments();
    documentSelect.value = activeDocumentId;
  } catch (err) {
    alert(`PDF Indexing Error: ${err.message}`);
  } finally {
    uploadBtn.disabled = false;
    indexingSpinner.classList.add("d-none");
  }
}

// ---------------- Real Quiz Generation ----------------
async function handleGenerateQuiz(e) {
  e.preventDefault();

  const docId = activeDocumentId || documentSelect.value;
  if (!docId) {
    alert("Please upload and index a PDF document before generating practice questions.");
    return;
  }

  const selectedTypeRadio = document.querySelector('input[name="questionType"]:checked');
  const questionType = selectedTypeRadio ? selectedTypeRadio.value : "MCQ";
  const topicQuery = topicQueryInput.value.trim();
  const difficulty = difficultySelect.value;
  const numQuestions = parseInt(numQuestionsSelect.value, 10);

  const generateBtn = document.getElementById("generateQuizBtn");
  generateBtn.disabled = true;
  generationSpinner.classList.remove("d-none");

  try {
    // Await the real backend response from /api/generate-quiz
    const res = await fetch(`${API_BASE}/api/generate-quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_id: docId,
        topic_or_query: topicQuery || null,
        question_type: questionType,
        difficulty: difficulty,
        num_questions: numQuestions,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      // Show exact real error from the backend (no fallback to fake questions)
      throw new Error(data.detail || `Generation failed with status ${res.status}`);
    }

    if (!data.questions || data.questions.length === 0) {
      throw new Error("Backend returned an empty question array. Ensure the PDF has readable text and Ollama is functioning.");
    }

    activeQuiz = data;
    renderActiveQuiz(activeQuiz);

    // Switch tab to Active Quiz
    const quizTabEl = document.querySelector("#quiz-tab");
    bootstrap.Tab.getInstance(quizTabEl)?.show() || new bootstrap.Tab(quizTabEl).show();
    quizBadge.classList.remove("d-none");
  } catch (err) {
    alert(`Generation Error: ${err.message}`);
    // Explicitly do NOT load any fallback mock array
  } finally {
    generateBtn.disabled = false;
    generationSpinner.classList.add("d-none");
  }
}

// ---------------- Quiz Taking & Render ----------------
function renderActiveQuiz(quizData) {
  quizEmptyState.classList.add("d-none");
  activeQuizContainer.classList.remove("d-none");
  evaluationResultsCard.classList.add("d-none");

  quizMetaTitle.textContent = quizData.topic_or_query || "PDF Practice Quiz";
  quizMetaType.textContent = quizData.question_type;
  quizMetaDifficulty.textContent = quizData.difficulty;

  const currentDocObj = currentDocuments.find((d) => d.id === quizData.document_id);
  quizMetaDoc.textContent = `Source: ${currentDocObj ? currentDocObj.filename : 'Uploaded Document'}`;

  // Reset timer
  clearInterval(quizTimerId);
  quizSeconds = 0;
  quizTimer.textContent = "00:00";
  quizTimerId = setInterval(() => {
    quizSeconds++;
    const mins = String(Math.floor(quizSeconds / 60)).padStart(2, "0");
    const secs = String(quizSeconds % 60).padStart(2, "0");
    quizTimer.textContent = `${mins}:${secs}`;
  }, 1000);

  updateProgress(0, quizData.questions.length);

  // Render question cards strictly from the retrieved questions
  questionsContainer.innerHTML = "";
  quizData.questions.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "card border-0 shadow-sm glass-panel";
    card.id = `qCard_${q.id}`;

    let inputHtml = "";
    if (q.type.toUpperCase() === "MCQ" && Array.isArray(q.options)) {
      inputHtml = `
        <div class="d-flex flex-column gap-2 mt-3">
          ${q.options.map((opt, optIdx) => `
            <div class="position-relative">
              <input type="radio" class="btn-check" name="answer_${q.id}" id="opt_${q.id}_${optIdx}" value="${escapeHtml(opt)}">
              <label class="quiz-option-label" for="opt_${q.id}_${optIdx}">
                <div class="d-flex align-items-center">
                  <span class="fw-medium">${escapeHtml(opt)}</span>
                </div>
              </label>
            </div>
          `).join("")}
        </div>
      `;
    } else {
      inputHtml = `
        <div class="mt-3">
          <textarea class="form-control bg-dark-subtle border-secondary-subtle" name="answer_${q.id}" rows="3" 
            placeholder="Type your ${q.type} response based strictly on your PDF study notes..."></textarea>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-body p-4">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-secondary-subtle text-secondary border rounded-pill">Q${index + 1}</span>
            <span class="badge bg-info-subtle text-info border border-info-subtle rounded-pill">${escapeHtml(q.topic_tag || 'PDF Concept')}</span>
          </div>
          <span class="text-xs text-muted">${q.difficulty}</span>
        </div>
        <h5 class="fw-bold mb-0 text-light">${escapeHtml(q.question)}</h5>
        ${inputHtml}
      </div>
    `;

    questionsContainer.appendChild(card);
  });

  // Track answer inputs for progress bar
  questionsContainer.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("change", checkAnsweredCount);
    el.addEventListener("input", checkAnsweredCount);
  });
}

function checkAnsweredCount() {
  if (!activeQuiz) return;
  const total = activeQuiz.questions.length;
  let answered = 0;

  activeQuiz.questions.forEach((q) => {
    if (q.type.toUpperCase() === "MCQ") {
      const checked = document.querySelector(`input[name="answer_${q.id}"]:checked`);
      if (checked) answered++;
    } else {
      const txt = document.querySelector(`textarea[name="answer_${q.id}"]`);
      if (txt && txt.value.trim().length > 3) answered++;
    }
  });

  updateProgress(answered, total);
}

function updateProgress(answered, total) {
  const pct = total > 0 ? (answered / total) * 100 : 0;
  quizProgressBar.style.width = `${pct}%`;
  quizProgressText.textContent = `${answered} / ${total} Answered`;
}

// ---------------- Quiz Submission & Evaluation ----------------
async function handleQuizSubmit(e) {
  e.preventDefault();
  if (!activeQuiz) return;

  const responses = [];
  activeQuiz.questions.forEach((q) => {
    let studentAns = "";
    if (q.type.toUpperCase() === "MCQ") {
      const selected = document.querySelector(`input[name="answer_${q.id}"]:checked`);
      studentAns = selected ? selected.value : "";
    } else {
      const txt = document.querySelector(`textarea[name="answer_${q.id}"]`);
      studentAns = txt ? txt.value.trim() : "";
    }
    responses.push({
      question_id: q.id,
      student_answer: studentAns,
    });
  });

  const submitBtn = document.getElementById("submitQuizBtn");
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Evaluating with Local Model...';

  try {
    const res = await fetch(`${API_BASE}/api/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quiz_id: activeQuiz.quiz_id,
        responses: responses,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || `Evaluation failed with status ${res.status}`);
    }

    clearInterval(quizTimerId);
    quizBadge.classList.add("d-none");
    renderEvaluationResults(data);
  } catch (err) {
    alert(`Evaluation Error: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-send-check-fill me-1"></i> Submit Quiz for Evaluation';
  }
}

function renderEvaluationResults(evalData) {
  evaluationResultsCard.classList.remove("d-none");
  evalScoreText.textContent = `${evalData.total_score} / ${evalData.max_score}`;
  evalPercentageText.textContent = `${evalData.percentage}%`;

  if (evalData.percentage >= 80) {
    evalPercentageText.className = "fw-bold text-success mb-0";
  } else if (evalData.percentage >= 60) {
    evalPercentageText.className = "fw-bold text-warning mb-0";
  } else {
    evalPercentageText.className = "fw-bold text-danger mb-0";
  }

  evalBreakdownContainer.innerHTML = "";
  evalData.results.forEach((item, index) => {
    const card = document.createElement("div");
    const isCorrect = item.is_correct || item.score_awarded >= 0.7;
    const isPartial = !isCorrect && item.score_awarded >= 0.35;

    let borderClass = "eval-card-incorrect";
    let badgeHtml = '<span class="badge bg-danger rounded-pill">Incorrect (0 pts)</span>';

    if (isCorrect) {
      borderClass = "eval-card-correct";
      badgeHtml = `<span class="badge bg-success rounded-pill">Correct (${item.score_awarded} pts)</span>`;
    } else if (isPartial) {
      borderClass = "eval-card-partial";
      badgeHtml = `<span class="badge bg-warning rounded-pill text-dark">Partial (${item.score_awarded} pts)</span>`;
    }

    card.className = `card border-0 shadow-sm p-3 glass-panel ${borderClass}`;
    card.innerHTML = `
      <div class="d-flex align-items-center justify-content-between mb-2">
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-dark-subtle border rounded-pill text-xs">Q${index + 1}</span>
          <span class="badge bg-info-subtle text-info border border-info-subtle rounded-pill text-xs">${escapeHtml(item.topic_tag || 'PDF Concept')}</span>
        </div>
        ${badgeHtml}
      </div>
      <h6 class="fw-bold mb-2">${escapeHtml(item.question_text)}</h6>

      <div class="bg-dark-subtle p-2 rounded mb-2 text-xs">
        <span class="text-muted d-block">Your Answer:</span>
        <span class="fw-medium text-light">${item.student_answer ? escapeHtml(item.student_answer) : '<em>No answer provided</em>'}</span>
      </div>

      <div class="bg-primary-subtle bg-opacity-10 p-2 rounded mb-2 text-xs border border-primary-subtle">
        <span class="text-primary fw-bold d-block">Correct Reference:</span>
        <span class="text-light">${escapeHtml(item.correct_answer)}</span>
      </div>

      <div class="text-xs text-muted mt-2 border-top pt-2">
        <strong>Explanation & Rubric:</strong> ${escapeHtml(item.explanation)}
        <div class="mt-1 text-info"><em>Feedback:</em> ${escapeHtml(item.feedback)}</div>
      </div>
    `;

    evalBreakdownContainer.appendChild(card);
  });

  evaluationResultsCard.scrollIntoView({ behavior: "smooth" });
}

// ---------------- Analytics & Recommendations ----------------
async function loadAnalytics() {
  try {
    const res = await fetch(`${API_BASE}/api/analytics`);
    if (!res.ok) return;

    const data = await res.json();

    kpiQuizzes.textContent = data.total_quizzes_taken;
    kpiQuestions.textContent = data.total_questions_answered;
    kpiAccuracy.textContent = `${data.overall_accuracy}%`;
    kpiWeakTopics.textContent = data.weak_topics ? data.weak_topics.length : 0;

    // Study Recommendations
    recommendationsList.innerHTML = "";
    if (data.study_recommendations && data.study_recommendations.length > 0) {
      data.study_recommendations.forEach((rec) => {
        const item = document.createElement("div");
        item.className = "p-3 bg-dark-subtle rounded-3 border-start border-3 border-warning text-sm";
        item.textContent = rec;
        recommendationsList.appendChild(item);
      });
    }

    // Weak Topic Badges
    weakTopicsPills.innerHTML = "";
    if (data.weak_topics && data.weak_topics.length > 0) {
      data.weak_topics.forEach((wt) => {
        const badge = document.createElement("span");
        badge.className = "badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-3 py-2 text-xs";
        badge.innerHTML = `<i class="bi bi-exclamation-circle me-1"></i> ${escapeHtml(wt.topic)} (${wt.accuracy_percentage}%)`;
        weakTopicsPills.appendChild(badge);
      });
    } else {
      weakTopicsPills.innerHTML = '<span class="text-muted text-xs">No weak topics! All assessed areas are &ge; 60% accuracy.</span>';
    }

    // Topic Progress Bars
    topicProgressContainer.innerHTML = "";
    if (data.topic_analytics && data.topic_analytics.length > 0) {
      data.topic_analytics.forEach((t) => {
        const row = document.createElement("div");
        row.className = "mb-2";

        let barColor = "bg-danger";
        if (t.accuracy_percentage >= 80) barColor = "bg-success";
        else if (t.accuracy_percentage >= 60) barColor = "bg-warning";

        row.innerHTML = `
          <div class="d-flex justify-content-between align-items-center text-xs mb-1">
            <span class="fw-semibold">${escapeHtml(t.topic)}</span>
            <span class="text-muted">${t.correct_answers}/${t.total_questions} correct (${t.accuracy_percentage}%)</span>
          </div>
          <div class="progress" style="height: 8px;">
            <div class="progress-bar ${barColor}" role="progressbar" style="width: ${t.accuracy_percentage}%"></div>
          </div>
        `;
        topicProgressContainer.appendChild(row);
      });
    } else {
      topicProgressContainer.innerHTML = '<div class="text-center py-4 text-muted text-sm">No quizzes taken yet.</div>';
    }

    // Recent Attempts Table
    recentAttemptsTbody.innerHTML = "";
    if (data.recent_attempts && data.recent_attempts.length > 0) {
      data.recent_attempts.forEach((att) => {
        const tr = document.createElement("tr");
        let statusBadge = att.percentage >= 60
          ? '<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill">Passed</span>'
          : '<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill">Review</span>';

        tr.innerHTML = `
          <td>${att.completed_at || 'Just now'}</td>
          <td>${att.correct_count} / ${att.total_questions}</td>
          <td class="fw-bold">${att.percentage}%</td>
          <td>${statusBadge}</td>
        `;
        recentAttemptsTbody.appendChild(tr);
      });
    } else {
      recentAttemptsTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No history recorded yet.</td></tr>';
    }
  } catch (err) {
    console.error("Failed to load analytics:", err);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
