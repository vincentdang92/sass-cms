from fastapi import APIRouter, Header, HTTPException, BackgroundTasks
from typing import Optional
import time
from models.tenant import get_customer_by_key
from services.rag import search, search_hybrid
from services.query_router import route_query
from services.analytics import log_rag_query

router = APIRouter(prefix="/rag", tags=["RAG Search (Client)"])


@router.get("/search")
def rag_search(
    q: str,
    background_tasks: BackgroundTasks,
    top_k: int = 5,
    hybrid: bool = False,  # opt-in: ?hybrid=true để bật BM25+Dense hybrid
    session_id: Optional[str] = None,
    x_api_key: str = Header(...),
):
    """Next.js route.ts gọi để lấy KB context trước khi gọi LLM.
    
    Dùng ?hybrid=true để bật Hybrid Search (BM25 + Dense Vector + RRF).
    Mặc định false để backward compat với tenant chưa có BM25 index.
    """
    start_time = time.time()
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    # Query Router: xác định mode (static/realtime/hybrid) và categories
    mode, categories = route_query(q)

    search_type = "hybrid" if hybrid else "dense"
    
    if hybrid:
        results = search_hybrid(
            customer.qdrant_collection, q,
            top_k=top_k, mode=mode,
            categories=categories or None,
            return_dicts=True
        )
    else:
        results = search(
            customer.qdrant_collection, q,
            top_k=top_k, mode=mode,
            categories=categories or None,
            return_dicts=True
        )

    latency_ms = int((time.time() - start_time) * 1000)
    
    # Ghi log background, không chặn I/O
    background_tasks.add_task(
        log_rag_query,
        customer.id,
        q,
        search_type,
        results,
        latency_ms,
        session_id
    )

    # Convert mapping array of dicts to array of strings for Next.js legacy compat
    # UI Client will still expect list[str] on this endpoint for now
    context_strings = [r["content"] for r in results] if results else []

    return {
        "context": context_strings,
        "collection": customer.qdrant_collection,
        "mode": mode,
        "categories": categories,
        "search_type": search_type,
    }
