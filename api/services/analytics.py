import time
import logging
from models.tenant import SessionLocal, RagAnalyticsLog

logger = logging.getLogger(__name__)

def log_rag_query(customer_id: str, query: str, search_mode: str, results: list, latency_ms: int, session_id: str | None = None):
    """
    Logs RAG search queries and retrieved chunks asynchronously to optimize miss rate.
    """
    db = SessionLocal()
    try:
        top_score = results[0].get("score", 0.0) if results else 0.0
        
        # Extract minimal data from chunks to keep JSON small
        chunks_data = []
        for r in results:
            content = r.get("content", "")
            trimmed_content = content[:200] + ("..." if len(content) > 200 else "")
            chunks_data.append({
                "id": r.get("id"),
                "score": r.get("score"),
                "content": trimmed_content,
                "type": r.get("type", ""),
                "kb_type": r.get("kb_type", "")
            })
            
        log_entry = RagAnalyticsLog(
            customer_id=customer_id,
            session_id=session_id,
            query=query,
            search_mode=search_mode,
            top_score=top_score,
            retrieved_chunks=chunks_data,
            latency_ms=latency_ms
        )
        db.add(log_entry)
        db.commit()
    except Exception as e:
        logger.error(f"[RAG Analytics] Error logging query: {e}")
    finally:
        db.close()
