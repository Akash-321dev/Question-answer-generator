"""
EduGenAI - Local LLM Integration Service (Ollama REST API + Answer Evaluator)
Interacts with local Ollama daemon (e.g. llama3, mistral) via http://localhost:11434/api/generate.
Enforces strict PDF-grounded questions, timeout limits, and zero mock/fallback questions.
"""

import os
import re
import json
import logging
from typing import List, Dict, Any, Optional
import httpx
import numpy as np

logger = logging.getLogger("edugenai.llm")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
REQUEST_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT", "120.0"))


class LLMService:
    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None):
        self.base_url = (base_url or OLLAMA_BASE_URL).rstrip("/")
        self.model = model or OLLAMA_MODEL

    async def check_health(self) -> Dict[str, Any]:
        """Verify if local Ollama daemon is active and list available models."""
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m.get("name") for m in data.get("models", [])]
                    is_model_present = any(self.model in m for m in models)
                    return {
                        "status": "connected",
                        "base_url": self.base_url,
                        "configured_model": self.model,
                        "is_model_installed": is_model_present,
                        "available_models": models
                    }
                return {"status": "error", "message": f"HTTP {resp.status_code} from Ollama: {resp.text}"}
        except httpx.ConnectError:
            return {
                "status": "offline",
                "message": f"Cannot connect to Ollama at {self.base_url}. Ensure 'ollama serve' is running."
            }
        except Exception as e:
            return {"status": "offline", "message": str(e)}

    async def generate_quiz_questions(
        self,
        retrieved_chunks: List[Dict[str, Any]],
        question_type: str = "MCQ",
        difficulty: str = "Medium",
        num_questions: int = 5,
        topic_focus: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Construct a strict context-grounded prompt and invoke Ollama to generate quiz questions.
        Raises an exception immediately if Ollama fails, times out, or returns invalid data.
        NEVER returns hardcoded or fallback questions.
        """
        if not retrieved_chunks:
            raise ValueError("Cannot generate questions: No text chunks were provided from the document.")

        # Format context from retrieved PDF chunks
        context_blocks = []
        for i, c in enumerate(retrieved_chunks):
            page_info = f"[Page {c.get('page', '?')} | Topic: {c.get('topic_tag', 'General')}]"
            context_blocks.append(f"Source Snippet #{i+1} {page_info}:\n{c.get('text', '')}")

        context_text = "\n\n".join(context_blocks)

        # Mandatory terminal print of context length
        print(f"Sending {len(context_text)} chars of PDF context to LLM...")

        type_instructions = ""
        if question_type.upper() == "MCQ":
            type_instructions = (
                "Each question MUST be Multiple Choice with exactly 4 distinct options labeled 'A', 'B', 'C', 'D'. "
                "options must be an array of 4 strings (e.g. ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4']). "
                "correct_answer MUST exactly match one of the 4 options (e.g. 'A) Option 1')."
            )
        elif question_type.upper() in ["SHORT ANSWER", "SHORT"]:
            type_instructions = (
                "Each question must require a 2-4 sentence concise conceptual answer. "
                "options must be null. correct_answer must contain the key points directly from the context."
            )
        elif question_type.upper() in ["LONG ANSWER", "LONG"]:
            type_instructions = (
                "Each question must require a detailed analytical answer explaining mechanisms, steps, or principles. "
                "options must be null. correct_answer must provide an in-depth rubric based directly on the context."
            )
        elif question_type.upper() == "VIVA":
            type_instructions = (
                "Each question must be a challenging oral examination (Viva Voce) question testing core intuition "
                "and conceptual understanding of the context. options must be null."
            )

        prompt = f"""CRITICAL INSTRUCTION: You must generate questions, answers, and explanations EXCLUSIVELY from the provided STUDY MATERIAL CONTEXT below. Do NOT use external knowledge. Every question must test a specific fact, concept, or section present in the text below.

=== STUDY MATERIAL CONTEXT ===
{context_text}
=== END OF CONTEXT ===

TASK REQUIREMENTS:
- Target Topic Focus: {topic_focus or 'Key Concepts across the provided study material'}
- Question Type: {question_type}
- Difficulty Level: {difficulty}
- Exact Number of Questions to generate: {num_questions}
- {type_instructions}

OUTPUT FORMAT:
Return ONLY a valid JSON array of question objects. Do NOT include markdown code fences, headers, preambles, or conversational commentary outside the JSON array.
[
  {{
    "id": 1,
    "question": "Specific question testing facts from the context above?",
    "type": "{question_type}",
    "difficulty": "{difficulty}",
    "topic_tag": "Specific Subtopic Name",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."] or null,
    "correct_answer": "Exact answer derived directly from the context",
    "explanation": "Detailed explanation citing the specific fact or mechanism in the context."
  }}
]"""

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.2,
                "top_p": 0.9,
                "num_ctx": 4096
            }
        }

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.post(f"{self.base_url}/api/generate", json=payload)
                if resp.status_code != 200:
                    raise RuntimeError(
                        f"Ollama API returned HTTP {resp.status_code}: {resp.text}"
                    )

                response_json = resp.json()
                raw_response = response_json.get("response", "")
                if not raw_response or not raw_response.strip():
                    raise RuntimeError("Ollama returned an empty response.")

                parsed_questions = self._extract_json_array(raw_response)

                if not parsed_questions or not isinstance(parsed_questions, list):
                    raise RuntimeError(
                        f"Ollama output did not contain a valid JSON array. Response: {raw_response[:300]}"
                    )

                cleaned = []
                for idx, q in enumerate(parsed_questions[:num_questions]):
                    if not isinstance(q, dict) or "question" not in q:
                        continue
                    cleaned.append({
                        "id": idx + 1,
                        "question": q.get("question"),
                        "type": q.get("type", question_type),
                        "difficulty": q.get("difficulty", difficulty),
                        "topic_tag": q.get("topic_tag") or (retrieved_chunks[0].get("topic_tag") if retrieved_chunks else "General"),
                        "options": q.get("options") if question_type.upper() == "MCQ" else None,
                        "correct_answer": q.get("correct_answer", ""),
                        "explanation": q.get("explanation", "Extracted from provided study material.")
                    })

                if not cleaned:
                    raise RuntimeError("No valid questions could be extracted from Ollama's response.")

                return cleaned

        except httpx.ConnectError:
            raise RuntimeError(
                f"Connection Error: Could not connect to Ollama at {self.base_url}. "
                f"Please ensure Ollama is running ('ollama serve') and model '{self.model}' is installed ('ollama pull {self.model}')."
            )
        except httpx.TimeoutException:
            raise RuntimeError(
                f"Timeout Error: Ollama generation timed out after {REQUEST_TIMEOUT_SECONDS}s. "
                "Consider using a smaller model (e.g. 'ollama pull llama3.2') or reducing question count."
            )

    def _extract_json_array(self, text: str) -> List[Dict[str, Any]]:
        """Safely extract and parse JSON array from model output."""
        text = text.strip()

        # 1. Direct JSON parse
        try:
            val = json.loads(text)
            if isinstance(val, list):
                return val
            if isinstance(val, dict):
                for k in ["questions", "quiz", "data", "results"]:
                    if k in val and isinstance(val[k], list):
                        return val[k]
        except Exception:
            pass

        # 2. Markdown code block match ```json ... ```
        code_block = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
        if code_block:
            try:
                return json.loads(code_block.group(1))
            except Exception:
                pass

        # 3. Greedy square bracket match
        bracket_match = re.search(r"\[\s*\{.*?\}\s*\]", text, re.DOTALL)
        if bracket_match:
            try:
                return json.loads(bracket_match.group(0))
            except Exception:
                pass

        raise ValueError(f"Failed to parse valid JSON question list from Ollama response: {text[:300]}...")

    async def evaluate_answer(
        self,
        question_text: str,
        question_type: str,
        student_answer: str,
        correct_answer: str,
        explanation: str
    ) -> Dict[str, Any]:
        """
        Evaluate a student's answer.
        MCQ: strict matching.
        Short/Long/Viva: local dense semantic cosine similarity against correct reference text.
        """
        s_ans = str(student_answer or "").strip()

        if question_type.upper() == "MCQ":
            clean_student = s_ans.strip()
            clean_correct = correct_answer.strip()
            is_match = False

            if clean_student.lower() == clean_correct.lower():
                is_match = True
            elif clean_student and len(clean_student) == 1 and clean_correct.startswith(clean_student):
                is_match = True
            elif clean_student.startswith(clean_correct[:2]):
                is_match = True

            return {
                "score": 1.0 if is_match else 0.0,
                "is_correct": is_match,
                "feedback": "Correct answer! Well done." if is_match else f"Incorrect. The correct choice is: {correct_answer}"
            }

        # For Short, Long, Viva: semantic cosine evaluation using Sentence Transformers
        try:
            from backend.rag_engine import get_embedding_model
            model = get_embedding_model()

            reference_text = f"{correct_answer}. {explanation}"
            embeddings = model.encode([s_ans, reference_text], convert_to_numpy=True, normalize_embeddings=True)
            similarity = float(np.dot(embeddings[0], embeddings[1]))

            score = max(0.0, min(1.0, (similarity - 0.25) / 0.55))
            score = round(score, 2)
            is_correct = score >= 0.65

            if score >= 0.85:
                feedback = "Excellent response! Your answer accurately captures the core concepts and key terminology from the study material."
            elif score >= 0.65:
                feedback = "Good answer! You have the right idea, though a few technical details from the source text could strengthen it."
            elif score >= 0.40:
                feedback = f"Partially correct. Key aspects were missing. Refer to explanation: {explanation}"
            else:
                feedback = f"Needs improvement. The response deviates from key concepts. Expected answer: {correct_answer}"

            return {
                "score": score,
                "is_correct": is_correct,
                "feedback": feedback
            }
        except Exception as e:
            logger.warning(f"Semantic scoring error: {e}")
            ref_words = set(re.findall(r'\b[a-zA-Z]{4,}\b', correct_answer.lower()))
            ans_words = set(re.findall(r'\b[a-zA-Z]{4,}\b', s_ans.lower()))
            overlap = len(ref_words.intersection(ans_words)) / max(len(ref_words), 1)
            score = round(min(1.0, overlap * 1.5), 2)
            return {
                "score": score,
                "is_correct": score >= 0.6,
                "feedback": f"Evaluated via keyword density ({int(score*100)}%). Key points: {correct_answer}"
            }
