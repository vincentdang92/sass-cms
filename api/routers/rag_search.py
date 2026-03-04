from fastapi import APIRouter, Header, HTTPException
from models.tenant import get_customer_by_key
from services.rag import search

router = APIRouter(prefix="/rag", tags=["RAG"])


@router.get("/search")
def rag_search(
    q: str,
    top_k: int = 5,
    x_api_key: str = Header(...),
):
    """Next.js route.ts gọi để lấy KB context trước khi gọi LLM"""
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    results = search(customer.qdrant_collection, q, top_k=top_k)
    return {"context": results, "collection": customer.qdrant_collection}
