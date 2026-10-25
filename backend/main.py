"""
EduGenAI - FastAPI Main Application Server
Full-stack REST API for PDF ingestion, local RAG retrieval, Ollama question generation,
automated evaluation, and learning analytics.
Zero mock questions: raises real HTTPExceptions on errors.
"""

import os
import uuid
import logging
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv()

from backend.database import (
    init_db,
    get_db,
    save_document,
    save_chunks,
    save_quiz,
    save_quiz_attempt,
    get_analytics_summary,
    DocumentModel,
    QuizModel,
    QuestionModel
)
from backend.rag_engine import RAGEngine
from backend.llm_service import LLMService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("edugenai.api")

# Initialize SQLite tables
init_db()

# Services
rag_engine = RAGEngine(chunk_size=500, chunk_overlap=100)
llm_service = LLMService(
    base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
    model=os.getenv("OLLAMA_MODEL", "llama3")
)

app = FastAPI(
    title="EduGenAI – AI-Powered PDF Question Generation & Learning Assistant",
    description="Local RAG pipeline for study materials with zero API cost, automated grading, and weak-topic recommendations.",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB


# Pydantic Schemas
class GenerateQuizRequest(BaseModel):
    document_id: str
    topic_or_query: Optional[str] = Field(default=None, description="Optional focus topic or keyword")
    question_type: str = Field(default="MCQ", description="MCQ, Short Answer, Long Answer, or Viva")
    difficulty: str = Field(default="Medium", description="Easy, Medium, or Hard")
    num_questions: int = Field(default=5, ge=1, le=25, description="Number of questions to generate")


class StudentAnswerItem(BaseModel):
    question_id: int
    student_answer: str


class EvaluateQuizRequest(BaseModel):
    quiz_id: str
    responses: List[StudentAnswerItem]


# ----------------- REST API Endpoints -----------------

@app.get("/api/health")
async def health_check():
    """Health check endpoint reporting Ollama and system status."""
    ollama_info = await llm_service.check_health()
    return {
        "status": "online",
        "app": "EduGenAI",
        "version": "1.0.0",
        "ollama": ollama_info
    }


@app.post("/api/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Upload and index a PDF file:
    1. Validate extension (.pdf) and size (<= 20MB).
    2. Extract text page by page with PyMuPDF.
    3. If 0 extractable text, raise 400 error immediately.
    4. Split into overlapping chunks with topic metadata.
    5. Build local FAISS index and store document records in SQLite.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Only PDF files (.pdf) are supported."
        )

    file_bytes = await file.read()
    file_size = len(file_bytes)

    if file_size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum allowed size of 20 MB (Current: {file_size / (1024 * 1024):.2f} MB)."
        )

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is empty (0 bytes)."
        )

    try:
        # Step 2: Extract text from PDF
        pages_data = rag_engine.extract_text_from_pdf(file_bytes)
    except ValueError as ve:
        # Immediate 400 error if PDF has no extractable text
        logger.warning(f"PDF extraction error: {ve}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        logger.error(f"PyMuPDF unexpected error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse PDF document: {str(e)}"
        )

    total_pages = len(pages_data)

    try:
        # Step 3: Chunk text
        chunks = rag_engine.chunk_document(pages_data)
        if not chunks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not generate valid text chunks from this PDF. Ensure the file contains readable paragraphs."
            )

        document_id = str(uuid.uuid4())

        # Step 4: Build FAISS vector store
        rag_engine.build_faiss_index(document_id, chunks)

        # Step 5: Persist to SQLite
        save_document(
            db=db,
            doc_id=document_id,
            filename=file.filename,
            size=file_size,
            pages=total_pages,
            chunk_count=len(chunks)
        )
        save_chunks(db=db, doc_id=document_id, chunks_data=chunks)

        return {
            "success": True,
            "document_id": document_id,
            "filename": file.filename,
            "total_pages": total_pages,
            "chunk_count": len(chunks),
            "message": f"Successfully extracted {total_pages} page(s) and indexed {len(chunks)} chunks into local FAISS vector store."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Indexing error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Vector indexing failed: {str(e)}"
        )


@app.get("/api/documents")
async def list_documents(db: Session = Depends(get_db)):
    """List all previously indexed documents."""
    docs = db.query(DocumentModel).order_by(DocumentModel.created_at.desc()).all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "file_size_bytes": d.file_size_bytes,
            "total_pages": d.total_pages,
            "chunk_count": d.chunk_count,
            "created_at": d.created_at.isoformat() if d.created_at else None
        }
        for d in docs
    ]


@app.post("/api/generate-quiz")
async def generate_quiz(
    req: GenerateQuizRequest,
    db: Session = Depends(get_db)
):
    """
    Generate questions using local RAG:
    1. Retrieve relevant chunks from FAISS based on document_id and topic.
    2. Prompt Ollama to generate structured questions in strict JSON format.
    3. Save the quiz and questions to SQLite and return.
    No fallback mock questions: raises real 500 if LLM fails.
    """
    doc = db.query(DocumentModel).filter(DocumentModel.id == req.document_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document '{req.document_id}' not found. Please upload a PDF first."
        )

    try:
        # Retrieve context chunks (samples evenly if topic is empty)
        top_k = min(max(req.num_questions * 2, 5), 15)
        retrieved_chunks = rag_engine.search_similar_chunks(
            document_id=req.document_id,
            query=req.topic_or_query,
            top_k=top_k
        )

        if not retrieved_chunks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No readable context chunks could be retrieved for this document."
            )

        # Invoke local LLM Service
        questions = await llm_service.generate_quiz_questions(
            retrieved_chunks=retrieved_chunks,
            question_type=req.question_type,
            difficulty=req.difficulty,
            num_questions=req.num_questions,
            topic_focus=req.topic_or_query
        )

        if not questions:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="The local LLM returned an empty question list from the provided PDF context."
            )

        quiz_id = str(uuid.uuid4())
        save_quiz(
            db=db,
            quiz_id=quiz_id,
            doc_id=req.document_id,
            topic_or_query=req.topic_or_query,
            q_type=req.question_type,
            difficulty=req.difficulty,
            num_questions=len(questions),
            questions_list=questions
        )

        # Retrieve questions from database to include database question IDs
        db_questions = db.query(QuestionModel).filter(QuestionModel.quiz_id == quiz_id).all()
        formatted_questions = []
        import json
        for q in db_questions:
            opts = json.loads(q.options_json) if q.options_json else None
            formatted_questions.append({
                "id": q.id,
                "question": q.question_text,
                "type": q.question_type,
                "difficulty": q.difficulty,
                "topic_tag": q.topic_tag,
                "options": opts,
                "correct_answer": q.correct_answer,
                "explanation": q.explanation
            })

        return {
            "quiz_id": quiz_id,
            "document_id": req.document_id,
            "topic_or_query": req.topic_or_query or "Key Concepts",
            "question_type": req.question_type,
            "difficulty": req.difficulty,
            "num_questions": len(formatted_questions),
            "questions": formatted_questions
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating quiz: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Question generation failed: {str(e)}"
        )


@app.post("/api/evaluate")
async def evaluate_quiz(
    req: EvaluateQuizRequest,
    db: Session = Depends(get_db)
):
    """
    Evaluate student's answers:
    - MCQ: exact match.
    - Short/Long/Viva: semantic similarity and keyword evaluation.
    - Persist attempt and response analytics to SQLite.
    """
    quiz = db.query(QuizModel).filter(QuizModel.id == req.quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz session not found."
        )

    questions_map = {q.id: q for q in quiz.questions}
    evaluated_responses = []
    total_score = 0.0
    correct_count = 0

    for resp in req.responses:
        q = questions_map.get(resp.question_id)
        if not q:
            continue

        eval_result = await llm_service.evaluate_answer(
            question_text=q.question_text,
            question_type=q.question_type,
            student_answer=resp.student_answer,
            correct_answer=q.correct_answer,
            explanation=q.explanation
        )

        score = eval_result["score"]
        is_corr = eval_result["is_correct"]

        total_score += score
        if is_corr or score >= 0.7:
            correct_count += 1

        evaluated_responses.append({
            "question_id": q.id,
            "question_text": q.question_text,
            "topic_tag": q.topic_tag,
            "student_answer": resp.student_answer,
            "correct_answer": q.correct_answer,
            "explanation": q.explanation,
            "is_correct": is_corr,
            "score_awarded": score,
            "feedback": eval_result["feedback"]
        })

    max_score = float(len(evaluated_responses))
    percentage = (total_score / max_score * 100.0) if max_score > 0 else 0.0

    attempt_id = str(uuid.uuid4())
    save_quiz_attempt(
        db=db,
        attempt_id=attempt_id,
        quiz_id=req.quiz_id,
        total_q=len(evaluated_responses),
        correct_q=correct_count,
        total_score=total_score,
        max_score=max_score,
        percentage=percentage,
        evaluated_responses=evaluated_responses
    )

    return {
        "attempt_id": attempt_id,
        "quiz_id": req.quiz_id,
        "total_questions": len(evaluated_responses),
        "correct_count": correct_count,
        "total_score": round(total_score, 1),
        "max_score": round(max_score, 1),
        "percentage": round(percentage, 1),
        "results": evaluated_responses
    }


@app.get("/api/analytics")
async def get_analytics(db: Session = Depends(get_db)):
    """Calculate overall accuracy, attempt history, topic breakdown, and weak-topic study recommendations."""
    return get_analytics_summary(db)


# Static Files & Frontend Serving
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(frontend_dir, "index.html"))
