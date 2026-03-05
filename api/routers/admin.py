from fastapi import APIRouter, Header, HTTPException
from models.tenant import Customer, SessionLocal, generate_api_key, LLMProvider, ChatSession, ChatMessage, RequestTopup
from services.rag import ensure_collection, delete_collection, list_points
from sqlalchemy import func
from datetime import datetime, date
import os

router = APIRouter(prefix="/admin", tags=["Admin"])

# ── Customer self-lookup (dùng cho Next.js route.ts) ─────────────────
@router.get("/customers/me")
def get_customer_me(x_api_key: str = Header(...)):
    """Next.js route.ts gọi endpoint này để lấy customer config"""
    db = SessionLocal()
    c = db.query(Customer).filter_by(api_key=x_api_key, is_active=True).first()
    db.close()
    if not c:
        raise HTTPException(401, "Invalid API key")
    return {
        "id": c.id,
        "bot_name": c.bot_name,
        "system_prompt": c.system_prompt,
        "llm_provider": c.llm_provider,
        "llm_model": c.llm_model,
        "qdrant_collection": c.qdrant_collection,
        "plan": c.plan,
    }

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
    return [{
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "plan": c.plan,
        "active": c.is_active,
        "requests_today": c.requests_today,
        "max_requests_day": c.max_requests_day,
        "api_key": c.api_key,
        "bot_name": c.bot_name,
        "llm_provider": c.llm_provider,
        "llm_model": c.llm_model,
        "qdrant_collection": c.qdrant_collection,
        "system_prompt": c.system_prompt,
    } for c in customers]

# ── Update customer ───────────────────────────
@router.patch("/customers/{customer_id}")
def update_customer(customer_id: str, data: dict, x_admin_secret: str = Header(...)):
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        raise HTTPException(404, "Customer not found")
    for k, v in data.items():
        if hasattr(c, k) and k not in ('id', 'api_key', 'qdrant_collection'):
            setattr(c, k, v)
    db.commit()
    db.close()
    return {"status": "updated"}

# ── Regenerate API Key ──────────────────────
@router.post("/customers/{customer_id}/regenerate-key")
def regenerate_api_key(customer_id: str, x_admin_secret: str = Header(...)):
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        raise HTTPException(404, "Customer not found")
    new_key = generate_api_key()
    c.api_key = new_key
    db.commit()
    db.close()
    return {"status": "ok", "api_key": new_key}

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
    # Normalize: list_points returns flat {id, content, filename, type, customer_id, ...}
    # Convert to consistent structure for frontend
    normalized = []
    for d in docs[:50]:
        doc_id = d.get("id", "")
        content = d.get("content", "")
        meta = {k: v for k, v in d.items() if k not in ("id", "content")}
        normalized.append({"id": doc_id, "content": content, "metadata": meta})
    return {"collection": c.qdrant_collection, "total": len(docs), "docs": normalized}

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


# ── Chat History ────────────────────────────────────────
@router.get("/customers/{customer_id}/chat-sessions")
def list_chat_sessions(
    customer_id: str,
    x_admin_secret: str = Header(...),
    page: int = 1,
    limit: int = 20
):
    """List all chat sessions for a tenant with pagination"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        db.close()
        raise HTTPException(404, "Customer not found")

    total = db.query(func.count(ChatSession.id)).filter_by(customer_id=customer_id).scalar()
    sessions = (
        db.query(ChatSession)
        .filter_by(customer_id=customer_id)
        .order_by(ChatSession.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    results = []
    for s in sessions:
        # Count messages in session
        msg_count = db.query(func.count(ChatMessage.id)).filter_by(session_id=s.id).scalar()
        # Get first user message as preview
        first_msg = db.query(ChatMessage).filter_by(session_id=s.id, role="user").first()
        results.append({
            "id": s.id,
            "title": s.title,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            "message_count": msg_count,
            "preview": (first_msg.content or "")[:120] if first_msg else "",
        })

    db.close()
    return {"total": total, "page": page, "sessions": results}


@router.get("/customers/{customer_id}/chat-sessions/{session_id}")
def get_chat_session_messages(customer_id: str, session_id: str, x_admin_secret: str = Header(...)):
    """Get all messages in a specific session"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    session = db.query(ChatSession).filter_by(id=session_id, customer_id=customer_id).first()
    if not session:
        db.close()
        raise HTTPException(404, "Session not found")

    messages = (
        db.query(ChatMessage)
        .filter_by(session_id=session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    result = {
        "session_id": session_id,
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "messages": [{
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in messages if m.role in ("user", "assistant")]
    }
    db.close()
    return result


@router.delete("/customers/{customer_id}/chat-sessions/{session_id}")
def delete_chat_session(customer_id: str, session_id: str, x_admin_secret: str = Header(...)):
    """Delete a chat session and all its messages"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    session = db.query(ChatSession).filter_by(id=session_id, customer_id=customer_id).first()
    if not session:
        db.close()
        raise HTTPException(404)
    db.query(ChatMessage).filter_by(session_id=session_id).delete()
    db.delete(session)
    db.commit()
    db.close()
    return {"status": "deleted"}


@router.get("/customers/{customer_id}/chat-stats")
def get_chat_stats(customer_id: str, x_admin_secret: str = Header(...)):
    """Aggregate stats: total sessions, messages, user-only messages, top intents preview"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        db.close()
        raise HTTPException(404)

    total_sessions = db.query(func.count(ChatSession.id)).filter_by(customer_id=customer_id).scalar()
    total_msgs = db.query(func.count(ChatMessage.id)) \
        .join(ChatSession, ChatMessage.session_id == ChatSession.id) \
        .filter(ChatSession.customer_id == customer_id).scalar()
    user_msgs = db.query(func.count(ChatMessage.id)) \
        .join(ChatSession, ChatMessage.session_id == ChatSession.id) \
        .filter(ChatSession.customer_id == customer_id, ChatMessage.role == "user").scalar()

    # Recent 5 user messages for quick scan
    recent = db.query(ChatMessage) \
        .join(ChatSession, ChatMessage.session_id == ChatSession.id) \
        .filter(ChatSession.customer_id == customer_id, ChatMessage.role == "user") \
        .order_by(ChatMessage.created_at.desc()).limit(5).all()

    db.close()
    return {
        "total_sessions": total_sessions,
        "total_messages": total_msgs,
        "user_messages": user_msgs,
        "requests_today": c.requests_today,
        "max_requests_day": c.max_requests_day,
        "recent_queries": [{"content": m.content[:100], "at": m.created_at.isoformat() if m.created_at else None} for m in recent],
    }


# ── Quota Management ────────────────────────────────────────────────────

PLAN_DEFAULTS = {
    "free":       {"max_requests_day": 100},
    "pro":        {"max_requests_day": 1000},
    "enterprise": {"max_requests_day": 99999},
}


@router.get("/customers/{customer_id}/quota")
def get_quota(customer_id: str, x_admin_secret: str = Header(...)):
    """Get current quota stats for a tenant"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        db.close()
        raise HTTPException(404)

    # Check if today's counter needs reset
    today = date.today()
    if c.last_reset_date != today and c.requests_today > 0:
        c.requests_today = 0
        c.last_reset_date = today
        db.commit()

    used_pct = round((c.requests_today / c.max_requests_day * 100), 1) if c.max_requests_day else 0
    remaining = max(0, c.max_requests_day - c.requests_today)

    # Count topups this month
    from datetime import timedelta
    month_start = today.replace(day=1)
    topups_this_month = db.query(func.sum(RequestTopup.amount)).filter(
        RequestTopup.customer_id == customer_id,
        RequestTopup.created_at >= datetime.combine(month_start, datetime.min.time())
    ).scalar() or 0

    db.close()
    return {
        "customer_id": customer_id,
        "plan": c.plan,
        "requests_today": c.requests_today,
        "max_requests_day": c.max_requests_day,
        "remaining": remaining,
        "used_pct": used_pct,
        "topups_this_month": topups_this_month,
        "plan_default": PLAN_DEFAULTS.get(c.plan, {}).get("max_requests_day", 100),
        "last_reset_date": c.last_reset_date.isoformat() if c.last_reset_date else None,
    }


@router.post("/customers/{customer_id}/quota/topup")
def topup_quota(customer_id: str, data: dict, x_admin_secret: str = Header(...)):
    """Add extra requests to a tenant's daily quota (does not reset usage counter)"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        db.close()
        raise HTTPException(404)

    amount = int(data.get("amount", 0))
    if amount <= 0:
        db.close()
        raise HTTPException(400, "amount must be positive")

    reason = data.get("reason", "manual topup")
    note = data.get("note", "")

    balance_before = c.max_requests_day
    balance_after = balance_before + amount
    c.max_requests_day = balance_after

    topup = RequestTopup(
        customer_id=customer_id,
        amount=amount,
        reason=reason,
        note=note,
        balance_before=balance_before,
        balance_after=balance_after,
    )
    db.add(topup)
    db.commit()
    db.close()

    return {
        "status": "ok",
        "amount_added": amount,
        "new_max": balance_after,
        "reason": reason,
    }


@router.post("/customers/{customer_id}/quota/reset-counter")
def reset_daily_counter(customer_id: str, x_admin_secret: str = Header(...)):
    """Manually reset today's usage counter (admin override)"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        db.close()
        raise HTTPException(404)

    old = c.requests_today
    c.requests_today = 0
    c.last_reset_date = date.today()

    # Log the reset as a topup with 0 amount
    topup = RequestTopup(
        customer_id=customer_id,
        amount=0,
        reason="counter reset",
        note=f"Admin manually reset counter (was {old})",
        balance_before=c.max_requests_day,
        balance_after=c.max_requests_day,
    )
    db.add(topup)
    db.commit()
    db.close()
    return {"status": "reset", "old_value": old}


@router.get("/customers/{customer_id}/quota/history")
def get_topup_history(
    customer_id: str,
    x_admin_secret: str = Header(...),
    page: int = 1,
    limit: int = 20
):
    """List all quota topup events for a tenant"""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    c = db.query(Customer).filter_by(id=customer_id).first()
    if not c:
        db.close()
        raise HTTPException(404)

    total = db.query(func.count(RequestTopup.id)).filter_by(customer_id=customer_id).scalar()
    rows = (
        db.query(RequestTopup)
        .filter_by(customer_id=customer_id)
        .order_by(RequestTopup.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    db.close()

    return {
        "total": total,
        "page": page,
        "history": [{
            "id": r.id,
            "amount": r.amount,
            "reason": r.reason,
            "note": r.note,
            "balance_before": r.balance_before,
            "balance_after": r.balance_after,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
    }