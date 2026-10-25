# EduGenAI – AI-Powered PDF Question Generation & Learning Assistant

EduGenAI converts student-uploaded PDF study materials (notes, textbooks, research papers up to 20 MB) into personalized practice quizzes using a **local RAG (Retrieval-Augmented Generation) pipeline** with **zero external API costs**. Students can customize quiz parameters, attempt interactive quizzes, receive immediate automated semantic evaluation, and view performance analytics with weak-topic study recommendations.

---

## 1. Project Directory Structure

```text
edugenai/
├── .env.example              # Environment variables template
├── requirements.txt          # Python dependencies
├── README.md                 # Setup and run guide
├── backend/
│   ├── __init__.py           # Package marker
│   ├── main.py               # FastAPI application with CORS and REST endpoints
│   ├── database.py           # SQLite database models and analytics queries
│   ├── rag_engine.py         # PyMuPDF extraction, chunking, and FAISS vector indexing
│   └── llm_service.py        # Ollama REST API integration and semantic evaluator
├── frontend/
│   ├── index.html            # Bootstrap 5 responsive UI with tabbed navigation
│   ├── styles.css            # Dark mode glassmorphism and quiz feedback styling
│   └── app.js                # Frontend controllers, drag-and-drop, and API integration
└── vector_stores/            # Saved local FAISS indices and chunk metadata (.gitignored)
```

---

## 2. Technology Stack & Architecture

- **Frontend:** HTML5, CSS3, Vanilla JavaScript, Bootstrap 5, Bootstrap Icons.
- **Backend:** Python 3.10+ / 3.11+ with FastAPI & Uvicorn.
- **PDF Extraction:** PyMuPDF (`fitz`) extracting text page-by-page.
- **Embeddings & Vector Store:** `sentence-transformers` (`all-MiniLM-L6-v2`) and `faiss-cpu` for fast similarity search.
- **Local LLM Integration:** Ollama REST API (`http://localhost:11434/api/generate`) with `llama3`, `mistral`, or `llama3.2`.
- **Database:** SQLite with SQLAlchemy ORM storing documents, chunks, quizzes, attempts, and question-level responses.

---

## 3. Step-by-Step Setup & Run Guide

### Step 1: Install Ollama & Pull the Model

1. **Install Ollama** on your machine:
   - **macOS / Linux:**
     ```bash
     curl -fsSL https://ollama.com/install.sh | sh
     ```
   - **Windows:** Download the installer from [ollama.com](https://ollama.com/download).

2. **Pull the Llama 3 or Mistral Model:**
   ```bash
   ollama pull llama3
   # or
   ollama pull mistral
   ```

3. **Verify Ollama is Running:**
   ```bash
   ollama serve
   ```
   *(By default, Ollama listens on `http://localhost:11434`)*.

---

### Step 2: Set Up Python Virtual Environment

1. **Clone or enter the project directory:**
   ```bash
   cd edugenai
   ```

2. **Create and activate a virtual environment:**
   - **Linux / macOS:**
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```
   - **Windows (PowerShell):**
     ```powershell
     python -m venv .venv
     .venv\Scripts\Activate.ps1
     ```

3. **Install dependencies:**
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

---

### Step 3: Configure Environment Variables

Copy `.env.example` to `.env` and adjust settings as needed:
```bash
cp .env.example .env
```

Example `.env`:
```ini
# Backend Server Configuration
HOST=0.0.0.0
PORT=8000

# SQLite Database Location
DATABASE_URL=sqlite:///./edugenai.db

# Vector Index Storage Path
VECTOR_STORE_DIR=./vector_stores

# Local Sentence Transformer Embedding Model
EMBEDDING_MODEL=all-MiniLM-L6-v2

# Local Ollama REST API Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
OLLAMA_TIMEOUT=120.0
```

---

### Step 4: Start the FastAPI Server

Launch the backend with auto-reload:
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

---

### Step 5: Open the Application

Open your browser and navigate to:
```text
http://localhost:8000
```
The FastAPI server automatically serves the frontend at `/` with interactive Swagger API docs available at `http://localhost:8000/docs`.

---

## 4. API Endpoints Reference

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/health` | `GET` | Health status of backend and Ollama connectivity |
| `POST /api/upload` | `POST` | Upload and chunk PDF, build FAISS vector index |
| `GET /api/documents` | `GET` | List all indexed documents |
| `POST /api/generate-quiz` | `POST` | Retrieve chunks from FAISS and prompt Ollama for structured JSON questions |
| `POST /api/evaluate` | `POST` | Evaluate student answers (exact match for MCQ, semantic similarity for Short/Long/Viva) |
| `GET /api/analytics` | `GET` | Get overall accuracy, topic-wise mastery, and weak-topic study recommendations |
