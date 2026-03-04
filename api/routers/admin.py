from fastapi import APIRouter, Header, HTTPException
from models.tenant import Customer, SessionLocal, generate_api_key, LLMProvider
from services.rag import ensure_collection, delete_collection, list_points
import os

router = APIRouter(prefix="/admin", tags=["Admin"])

def verify_admin(secret: str = Header(..., alias="x-admin-secret")):
    if secret != os.getenv("ADMIN_SECRET"):
        raise HTTPException(status_code=403, detail="Forbidden")

# ── Tạo customer thủ công ────────────────────
@router.post("/customers")
def create_customer(data: dict, _=None):
    verify_admin(data.get("admin_secret", ""))
    db = SessionLocal()

    cid = data["id"].lower().replace(" ", "-")
    api_key = generate_api_key()
    collection = f"kb_{cid}"

    customer = Customer(
        id=cid,
        name=data["name"],
        email=data["email"],
        api_key=api_key,
        qdrant_collection=collection,
        llm_provider=data.get("llm_provider", "deepseek"),
        llm_model=data.get("llm_model", "deepseek-chat"),
        bot_name=data.get("bot_name", "AI Assistant"),
        system_prompt=data.get("system_prompt",
            f"Bạn là trợ lý tư vấn domain/hosting của {data['name']}. "
            "Chỉ trả lời dựa trên thông tin được cung cấp. Trả lời ngắn gọn, thân thiện."
        ),
        plan=data.get("plan", "free"),
        max_requests_day=data.get("max_requests_day", 100)
    )
    db.add(customer)
    db.commit()
    ensure_collection(collection)
    db.close()

    return {
        "customer_id": cid,
        "api_key": api_key,        # lưu lại, chỉ show 1 lần
        "collection": collection,
        "embed_snippet": f'<script src="https://yourdomain.com/widget.js" data-key="{api_key}"></script>'
    }

# ── Liệt kê tất cả customers ─────────────────
@router.get("/customers")
def list_customers(x_admin_secret: str = Header(...)):
    verify_admin(x_admin_secret)
    db = SessionLocal()
    customers = db.query(Customer).all()
    db.close()
    return [{"id": c.id, "name": c.name, "plan": c.plan,
             "active": c.is_active, "requests_today": c.requests_today} for c in customers]

# ── Update customer ───────────────────────────
@router.patch("/customers/{customer_id}")
def update_customer(customer_id: str, data: dict, x_admin_secret: str = Header(...)):
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        raise HTTPException(404, "Customer not found")
    for k, v in data.items():
        if hasattr(c, k):
            setattr(c, k, v)
    db.commit()
    db.close()
    return {"status": "updated"}

# ── Xem KB của customer ───────────────────────
@router.get("/customers/{customer_id}/kb")
def get_kb(customer_id: str, x_admin_secret: str = Header(...)):
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    db.close()
    if not c:
        raise HTTPException(404, "Not found")
    docs = list_points(c.qdrant_collection)
    return {"collection": c.qdrant_collection, "total": len(docs), "docs": docs[:20]}

# ── Xoá KB ───────────────────────────────────
@router.delete("/customers/{customer_id}/kb")
def clear_kb(customer_id: str, x_admin_secret: str = Header(...)):
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    db.close()
    if not c:
        raise HTTPException(404)
    delete_collection(c.qdrant_collection)
    ensure_collection(c.qdrant_collection)
    return {"status": "kb cleared"}