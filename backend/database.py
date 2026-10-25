"""
EduGenAI - SQLite Database and SQLAlchemy ORM Models
Stores document metadata, text chunks, generated quizzes, questions, attempts, and evaluation results.
"""

import os
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Text,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    desc
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session

DB_PATH = os.getenv("DATABASE_URL", "sqlite:///./edugenai.db")

engine = create_engine(
    DB_PATH,
    connect_args={"check_same_thread": False} if DB_PATH.startswith("sqlite") else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class DocumentModel(Base):
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    file_size_bytes = Column(Integer, nullable=False)
    total_pages = Column(Integer, nullable=False)
    chunk_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    chunks = relationship("ChunkModel", back_populates="document", cascade="all, delete-orphan")
    quizzes = relationship("QuizModel", back_populates="document", cascade="all, delete-orphan")


class ChunkModel(Base):
    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    page_number = Column(Integer, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    topic_tag = Column(String(100), default="General")

    document = relationship("DocumentModel", back_populates="chunks")


class QuizModel(Base):
    __tablename__ = "quizzes"

    id = Column(String(36), primary_key=True, index=True)
    document_id = Column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    topic_or_query = Column(String(255), nullable=True)
    question_type = Column(String(50), nullable=False)  # MCQ, Short Answer, Long Answer, Viva
    difficulty = Column(String(50), nullable=False)     # Easy, Medium, Hard
    num_questions = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("DocumentModel", back_populates="quizzes")
    questions = relationship("QuestionModel", back_populates="quiz", cascade="all, delete-orphan")
    attempts = relationship("QuizAttemptModel", back_populates="quiz", cascade="all, delete-orphan")


class QuestionModel(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    quiz_id = Column(String(36), ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    question_text = Column(Text, nullable=False)
    question_type = Column(String(50), nullable=False)
    difficulty = Column(String(50), nullable=False)
    topic_tag = Column(String(100), default="General")
    options_json = Column(Text, nullable=True)  # JSON-encoded array for MCQs
    correct_answer = Column(Text, nullable=False)
    explanation = Column(Text, nullable=False)

    quiz = relationship("QuizModel", back_populates="questions")


class QuizAttemptModel(Base):
    __tablename__ = "quiz_attempts"

    id = Column(String(36), primary_key=True, index=True)
    quiz_id = Column(String(36), ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    total_questions = Column(Integer, nullable=False)
    correct_count = Column(Integer, default=0)
    total_score = Column(Float, default=0.0)
    max_score = Column(Float, default=0.0)
    percentage = Column(Float, default=0.0)
    completed_at = Column(DateTime, default=datetime.utcnow)

    quiz = relationship("QuizModel", back_populates="attempts")
    responses = relationship("QuestionResponseModel", back_populates="attempt", cascade="all, delete-orphan")


class QuestionResponseModel(Base):
    __tablename__ = "question_responses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attempt_id = Column(String(36), ForeignKey("quiz_attempts.id", ondelete="CASCADE"), index=True)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"))
    student_answer = Column(Text, nullable=False)
    is_correct = Column(Boolean, default=False)
    score_awarded = Column(Float, default=0.0)
    feedback = Column(Text, nullable=True)

    attempt = relationship("QuizAttemptModel", back_populates="responses")
    question = relationship("QuestionModel")


def init_db():
    """Create all database tables."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency helper for FastAPI endpoints."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Database Queries and Analytics Helper Functions
def save_document(db: Session, doc_id: str, filename: str, size: int, pages: int, chunk_count: int) -> DocumentModel:
    doc = DocumentModel(
        id=doc_id,
        filename=filename,
        file_size_bytes=size,
        total_pages=pages,
        chunk_count=chunk_count
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def save_chunks(db: Session, doc_id: str, chunks_data: List[Dict[str, Any]]) -> None:
    chunk_models = [
        ChunkModel(
            document_id=doc_id,
            page_number=c.get("page", 1),
            chunk_index=c.get("index", idx),
            content=c.get("text", ""),
            topic_tag=c.get("topic_tag", "General")
        )
        for idx, c in enumerate(chunks_data)
    ]
    db.bulk_save_objects(chunk_models)
    db.commit()


def save_quiz(db: Session, quiz_id: str, doc_id: str, topic_or_query: Optional[str],
              q_type: str, difficulty: str, num_questions: int, questions_list: List[Dict[str, Any]]) -> QuizModel:
    quiz = QuizModel(
        id=quiz_id,
        document_id=doc_id,
        topic_or_query=topic_or_query or "All Topics",
        question_type=q_type,
        difficulty=difficulty,
        num_questions=num_questions
    )
    db.add(quiz)
    db.flush()

    for q in questions_list:
        opts = q.get("options")
        opts_str = json.dumps(opts) if opts and isinstance(opts, list) else None
        question = QuestionModel(
            quiz_id=quiz_id,
            question_text=q.get("question", ""),
            question_type=q.get("type", q_type),
            difficulty=q.get("difficulty", difficulty),
            topic_tag=q.get("topic_tag", "General"),
            options_json=opts_str,
            correct_answer=q.get("correct_answer", ""),
            explanation=q.get("explanation", "")
        )
        db.add(question)

    db.commit()
    db.refresh(quiz)
    return quiz


def save_quiz_attempt(db: Session, attempt_id: str, quiz_id: str,
                      total_q: int, correct_q: int, total_score: float,
                      max_score: float, percentage: float,
                      evaluated_responses: List[Dict[str, Any]]) -> QuizAttemptModel:
    attempt = QuizAttemptModel(
        id=attempt_id,
        quiz_id=quiz_id,
        total_questions=total_q,
        correct_count=correct_q,
        total_score=round(total_score, 1),
        max_score=round(max_score, 1),
        percentage=round(percentage, 1)
    )
    db.add(attempt)
    db.flush()

    for resp in evaluated_responses:
        qr = QuestionResponseModel(
            attempt_id=attempt_id,
            question_id=resp.get("question_id"),
            student_answer=str(resp.get("student_answer", "")),
            is_correct=bool(resp.get("is_correct", False)),
            score_awarded=float(resp.get("score_awarded", 0.0)),
            feedback=str(resp.get("feedback", ""))
        )
        db.add(qr)

    db.commit()
    db.refresh(attempt)
    return attempt


def get_analytics_summary(db: Session) -> Dict[str, Any]:
    """Calculate overall accuracy, attempt history, topic breakdown, and weak-topic study recommendations."""
    attempts = db.query(QuizAttemptModel).order_by(desc(QuizAttemptModel.completed_at)).all()
    responses = db.query(QuestionResponseModel, QuestionModel).join(
        QuestionModel, QuestionResponseModel.question_id == QuestionModel.id
    ).all()

    total_attempts = len(attempts)
    total_questions_answered = len(responses)

    if total_questions_answered == 0:
        return {
            "total_quizzes_taken": 0,
            "total_questions_answered": 0,
            "overall_accuracy": 0.0,
            "average_score_percentage": 0.0,
            "recent_attempts": [],
            "topic_analytics": [],
            "difficulty_analytics": [],
            "weak_topics": [],
            "study_recommendations": [
                "Upload a PDF and complete your first quiz to generate personalized weak-topic recommendations!"
            ]
        }

    # Aggregate by topic
    topic_stats: Dict[str, Dict[str, float]] = {}
    diff_stats: Dict[str, Dict[str, float]] = {}

    for resp, quest in responses:
        # Topic
        t_tag = quest.topic_tag or "General"
        if t_tag not in topic_stats:
            topic_stats[t_tag] = {"total": 0, "correct": 0, "score_earned": 0.0, "max_score": 0.0}
        topic_stats[t_tag]["total"] += 1
        if resp.is_correct or resp.score_awarded >= 0.7:
            topic_stats[t_tag]["correct"] += 1
        topic_stats[t_tag]["score_earned"] += resp.score_awarded
        topic_stats[t_tag]["max_score"] += 1.0

        # Difficulty
        diff = quest.difficulty or "Medium"
        if diff not in diff_stats:
            diff_stats[diff] = {"total": 0, "correct": 0}
        diff_stats[diff]["total"] += 1
        if resp.is_correct or resp.score_awarded >= 0.7:
            diff_stats[diff]["correct"] += 1

    topic_analytics = []
    weak_topics = []
    for topic, stats in topic_stats.items():
        acc = round((stats["correct"] / stats["total"]) * 100, 1)
        score_pct = round((stats["score_earned"] / stats["max_score"]) * 100, 1) if stats["max_score"] > 0 else 0
        topic_data = {
            "topic": topic,
            "total_questions": int(stats["total"]),
            "correct_answers": int(stats["correct"]),
            "accuracy_percentage": acc,
            "average_score": score_pct,
            "status": "Mastered" if acc >= 80 else ("Needs Review" if acc >= 60 else "Weak Topic")
        }
        topic_analytics.append(topic_data)
        if acc < 60:
            weak_topics.append(topic_data)

    difficulty_analytics = [
        {
            "difficulty": diff,
            "total_questions": int(stats["total"]),
            "accuracy_percentage": round((stats["correct"] / stats["total"]) * 100, 1)
        }
        for diff, stats in diff_stats.items()
    ]

    total_correct = sum(1 for resp, _ in responses if resp.is_correct or resp.score_awarded >= 0.7)
    overall_accuracy = round((total_correct / total_questions_answered) * 100, 1)
    avg_score = round(sum(a.percentage for a in attempts) / total_attempts, 1) if total_attempts else 0.0

    # Build recommendations based on weak topics
    recommendations = []
    if weak_topics:
        for wt in weak_topics:
            recommendations.append(
                f"High Priority: Revisit '{wt['topic']}' (current accuracy: {wt['accuracy_percentage']}%). Generate a targeted 5-question quiz focusing strictly on this subtopic."
            )
        recommendations.append(
            "Tip: For Short & Long answers, focus on including primary definitions, key mechanisms, and technical keywords highlighted in the explanations."
        )
    else:
        recommendations.append(
            "Outstanding performance! All tested topics have >= 60% accuracy. Try generating Hard-difficulty or Viva-style quizzes to push deeper conceptual mastery."
        )

    recent_attempts_data = [
        {
            "id": a.id,
            "quiz_id": a.quiz_id,
            "percentage": a.percentage,
            "correct_count": a.correct_count,
            "total_questions": a.total_questions,
            "completed_at": a.completed_at.strftime("%Y-%m-%d %H:%M") if a.completed_at else ""
        }
        for a in attempts[:10]
    ]

    return {
        "total_quizzes_taken": total_attempts,
        "total_questions_answered": total_questions_answered,
        "overall_accuracy": overall_accuracy,
        "average_score_percentage": avg_score,
        "recent_attempts": recent_attempts_data,
        "topic_analytics": sorted(topic_analytics, key=lambda x: x["accuracy_percentage"]),
        "difficulty_analytics": difficulty_analytics,
        "weak_topics": weak_topics,
        "study_recommendations": recommendations
    }
