from fastapi import APIRouter, Header, UploadFile, File, HTTPException
from models.tenant import get_customer_by_key
from services.rag import ingest
import json

router = APIRouter(prefix="/kb", tags=["Knowledge Base"])

def chunk_text(text: str, size: int = 400) -> list[str]:
    words = text.split()
    return [" ".join(words[i:i+size]) for i in range(0, len(words), size)]

@router.post("/upload")
async def upload_kb(
    files: list[UploadFile] = File(...),
    x_api_key: str = Header(...)
):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    total = 0
    for file in files:
        content = await file.read()
        text = content.decode("utf-8", errors="ignore")

        # Detect type để tag metadata
        kb_type = "general"
        name_lower = file.filename.lower()
        if any(x in name_lower for x in ["price", "gia", "bảng giá"]):
            kb_type = "pricing"
        elif any(x in name_lower for x in ["faq", "support"]):
            kb_type = "faq"
        elif any(x in name_lower for x in ["policy", "terms", "điều khoản"]):
            kb_type = "policy"

        chunks = chunk_text(text)
        docs = [{
            "content": c,
            "metadata": {
                "filename": file.filename,
                "type": kb_type,
                "customer_id": customer.id
            }
        } for c in chunks]

        total += ingest(customer.qdrant_collection, docs)

    return {"uploaded_chunks": total, "files": len(files)}

@router.post("/upload/json")
async def upload_json_kb(data: dict, x_api_key: str = Header(...)):
    """Upload KB dạng JSON — tiện cho bảng giá có cấu trúc"""
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)

    items = data.get("items", [])
    docs = [{
        "content": json.dumps(item, ensure_ascii=False),
        "metadata": {"type": data.get("type", "product"), "customer_id": customer.id}
    } for item in items]

    total = ingest(customer.qdrant_collection, docs)
    return {"uploaded_chunks": total}