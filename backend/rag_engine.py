"""
EduGenAI - RAG Engine (PDF Extraction, Chunking, Embeddings, FAISS Vector Indexing)
Uses PyMuPDF (fitz) for page-level text extraction, Sentence-Transformers for local dense embeddings,
and FAISS for sub-millisecond similarity search with zero API costs.
"""

import os
import re
import json
import logging
from typing import List, Dict, Any, Union
import numpy as np

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

try:
    import faiss
except ImportError:
    faiss = None

logger = logging.getLogger("edugenai.rag")

VECTOR_STORE_DIR = os.getenv("VECTOR_STORE_DIR", "./vector_stores")
os.makedirs(VECTOR_STORE_DIR, exist_ok=True)

# Global embedding model instance cache
_embedding_model = None


def get_embedding_model():
    """Load and cache SentenceTransformer model locally."""
    global _embedding_model
    if _embedding_model is None:
        if SentenceTransformer is None:
            raise RuntimeError("sentence-transformers is not installed. Please run: pip install sentence-transformers")
        model_name = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
        logger.info(f"Loading local embedding model: {model_name}")
        _embedding_model = SentenceTransformer(model_name)
    return _embedding_model


class RAGEngine:
    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 100):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def extract_text_from_pdf(self, file_path_or_bytes: Union[str, bytes, os.PathLike]) -> List[Dict[str, Any]]:
        """
        Extract text page by page from PDF using PyMuPDF (fitz).
        Returns a list of dictionaries with page number and extracted text.
        """
        if fitz is None:
            raise RuntimeError("PyMuPDF (fitz) is not installed. Please run: pip install PyMuPDF")

        pages_data = []
        if isinstance(file_path_or_bytes, (str, os.PathLike)):
            doc = fitz.open(file_path_or_bytes)
        else:
            # Open binary stream from file bytes
            doc = fitz.open(stream=file_path_or_bytes, filetype="pdf")

        try:
            for page_num in range(len(doc)):
                page = doc[page_num]
                # Extract text using PyMuPDF
                text = page.get_text("text") or ""
                cleaned = self._clean_text(text)
                if cleaned:
                    pages_data.append({
                        "page": page_num + 1,
                        "text": cleaned
                    })
        finally:
            doc.close()

        total_extracted_chars = sum(len(p["text"]) for p in pages_data)
        if not pages_data or total_extracted_chars == 0:
            raise ValueError(
                "No extractable text found in the uploaded PDF. "
                "The document may be scanned, image-only, or encrypted, which requires OCR."
            )

        return pages_data

    def _clean_text(self, text: str) -> str:
        """Clean and normalize extracted raw text from PDF."""
        # Un-hyphenate broken words across line endings
        text = re.sub(r'(\w+)-\n(\w+)', r'\1\2', text)
        text = re.sub(r'\r\n|\r', '\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    def chunk_document(self, pages_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Split document text into overlapping chunks (500 chars with 100 char overlap)
        while preserving page context and detecting topic headings.
        """
        chunks: List[Dict[str, Any]] = []
        chunk_idx = 0
        step = max(self.chunk_size - self.chunk_overlap, 100)

        for p in pages_data:
            page_num = p["page"]
            text = p["text"]

            for start in range(0, len(text), step):
                chunk_slice = text[start:start + self.chunk_size].strip()
                if len(chunk_slice) < 40:
                    continue  # Ignore tiny trailing snippets

                topic_tag = self._infer_topic_tag(chunk_slice)
                chunks.append({
                    "index": chunk_idx,
                    "page": page_num,
                    "text": chunk_slice,
                    "topic_tag": topic_tag
                })
                chunk_idx += 1

        if not chunks:
            raise ValueError("The extracted PDF text could not produce valid content chunks.")

        # Mandatory verification print in terminal
        sample_preview = chunks[0]["text"][:200] if chunks else "None"
        print(f"Extracted {len(chunks)} chunks from PDF. Sample: {sample_preview}")

        return chunks

    def _infer_topic_tag(self, chunk_text: str) -> str:
        """Extract a readable topic or sub-concept heading from chunk text."""
        lines = [line.strip() for line in chunk_text.split('\n') if line.strip()]
        for line in lines[:3]:
            clean_line = re.sub(r'^[#*\-\d.\s]+', '', line).strip()
            if 3 <= len(clean_line) <= 45 and not clean_line.endswith('.'):
                return clean_line

        words = re.findall(r'\b[A-Z][a-z]{3,}\b', chunk_text)
        if words:
            return words[0]
        return "Core Concepts"

    def build_faiss_index(self, document_id: str, chunks: List[Dict[str, Any]]) -> str:
        """
        Generate sentence embeddings for each chunk and build a FAISS IndexFlatIP.
        Persists the index to disk for fast reload.
        """
        if faiss is None:
            raise RuntimeError("faiss-cpu is not installed. Please run: pip install faiss-cpu")

        model = get_embedding_model()
        texts = [c["text"] for c in chunks]

        embeddings = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
        dimension = embeddings.shape[1]

        index = faiss.IndexFlatIP(dimension)
        index.add(embeddings.astype(np.float32))

        index_file = os.path.join(VECTOR_STORE_DIR, f"{document_id}.faiss")
        meta_file = os.path.join(VECTOR_STORE_DIR, f"{document_id}.json")

        faiss.write_index(index, index_file)
        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(chunks, f, ensure_ascii=False, indent=2)

        logger.info(f"Built FAISS index for document {document_id} with {len(chunks)} chunks.")
        return index_file

    def search_similar_chunks(self, document_id: str, query: Optional[str] = None, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Retrieve top-K most semantically relevant chunks for a given topic or query.
        When query is empty, does NOT search with empty string. Instead samples chunks evenly
        across the document or retrieves chunks matching 'core concepts, definitions, and important facts'.
        """
        index_file = os.path.join(VECTOR_STORE_DIR, f"{document_id}.faiss")
        meta_file = os.path.join(VECTOR_STORE_DIR, f"{document_id}.json")

        if not os.path.exists(index_file) or not os.path.exists(meta_file):
            raise FileNotFoundError(f"Vector index for document {document_id} was not found on disk.")

        with open(meta_file, "r", encoding="utf-8") as f:
            chunks = json.load(f)

        if not chunks:
            raise ValueError(f"Document {document_id} has zero indexed chunks.")

        # If query is empty or general: do NOT search FAISS with an empty string!
        # Instead, sample chunks evenly across the document so the entire PDF content is represented.
        clean_query = (query or "").strip()
        if not clean_query or clean_query.lower() in ["all", "all topics", "general", "full document"]:
            total = len(chunks)
            if total <= top_k:
                return chunks
            step = max(total // top_k, 1)
            sampled = [chunks[i] for i in range(0, total, step)][:top_k]
            return sampled

        # Otherwise perform semantic dense retrieval via FAISS
        if faiss is None:
            raise RuntimeError("faiss-cpu is not installed.")

        model = get_embedding_model()
        query_vec = model.encode([clean_query], convert_to_numpy=True, normalize_embeddings=True).astype(np.float32)

        index = faiss.read_index(index_file)
        k_search = min(top_k, index.ntotal)
        scores, indices = index.search(query_vec, k_search)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if 0 <= idx < len(chunks):
                chunk_copy = dict(chunks[idx])
                chunk_copy["similarity_score"] = float(score)
                results.append(chunk_copy)

        # Fallback if no scores met threshold
        if not results:
            results = chunks[:top_k]

        return results
