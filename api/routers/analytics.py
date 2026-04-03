from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import desc, func
from models.tenant import SessionLocal, Customer, RagAnalyticsLog
from datetime import datetime, timedelta, timezone
import os
import json

def verify_admin(secret: str):
    if secret != os.getenv("ADMIN_SECRET"):
        raise HTTPException(status_code=403, detail="Forbidden")

router = APIRouter(prefix="/analytics", tags=["Analytics"])

@router.get("/rag-logs")
def get_rag_logs(
    x_api_key: str = Header(...),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    min_score: float = Query(None),
    max_score: float = Query(None)
):
    """Lấy danh sách log RAG retrieval của Tenant."""
    db = SessionLocal()
    customer = db.query(Customer).filter_by(api_key=x_api_key).first()
    if not customer:
        db.close()
        raise HTTPException(401, "Invalid API key")
        
    query = db.query(RagAnalyticsLog).filter_by(customer_id=customer.id)
    
    if min_score is not None:
        query = query.filter(RagAnalyticsLog.top_score >= min_score)
    if max_score is not None:
        query = query.filter(RagAnalyticsLog.top_score <= max_score)
        
    total = query.count()
    logs = query.order_by(desc(RagAnalyticsLog.created_at)).offset((page - 1) * limit).limit(limit).all()
    
    result = []
    for log in logs:
        # PostgreSQL JSONB returns dict/list natively, but just in case, handle string
        chunks = log.retrieved_chunks
        if isinstance(chunks, str):
            try:
                chunks = json.loads(chunks)
            except:
                chunks = []
                
        result.append({
            "id": log.id,
            "session_id": log.session_id,
            "query": log.query,
            "search_mode": log.search_mode,
            "top_score": log.top_score,
            "retrieved_chunks": chunks,
            "latency_ms": log.latency_ms,
            "created_at": log.created_at.isoformat() if log.created_at else None
        })
        
    db.close()
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "logs": result
    }

@router.get("/rag-stats")
def get_rag_stats(x_api_key: str = Header(...)):
    """Tổng quan nhanh về Miss Rate của RAG."""
    db = SessionLocal()
    customer = db.query(Customer).filter_by(api_key=x_api_key).first()
    if not customer:
        db.close()
        raise HTTPException(401, "Invalid API key")
        
    query = db.query(RagAnalyticsLog).filter_by(customer_id=customer.id)
    
    total_queries = query.count()
    
    # Định nghĩa "miss" là score < 0.4 (threshold mặc định cần theo dõi)
    miss_queries = query.filter(RagAnalyticsLog.top_score < 0.4).count()
    
    avg_latency = db.query(func.avg(RagAnalyticsLog.latency_ms)).filter_by(customer_id=customer.id).scalar() or 0
    
    db.close()
    
    miss_rate_pct = 0
    if total_queries > 0:
        miss_rate_pct = round((miss_queries / total_queries) * 100, 1)
        
    return {
        "total_queries": total_queries,
        "miss_queries": miss_queries,
        "miss_rate_pct": miss_rate_pct,
        "avg_latency_ms": int(avg_latency)
    }

@router.delete("/cleanup")
def cleanup_rag_logs(x_admin_secret: str = Header(...)):
    """Dọn dẹp các log RAG cũ hơn 30 ngày và có điểm cao (>0.8) để tiết kiệm DB."""
    verify_admin(x_admin_secret)
    db = SessionLocal()
    
    threshold_date = datetime.now(timezone.utc) - timedelta(days=30)
    
    try:
        deleted_count = db.query(RagAnalyticsLog).filter(
            RagAnalyticsLog.top_score >= 0.8,
            RagAnalyticsLog.created_at < threshold_date
        ).delete()
        db.commit()
    except Exception as e:
        db.rollback()
        db.close()
        raise HTTPException(500, str(e))
        
    db.close()
    
    return {"status": "success", "deleted_count": deleted_count}
