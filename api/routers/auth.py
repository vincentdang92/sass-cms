from fastapi import APIRouter, HTTPException
from models.tenant import Customer, SessionLocal, generate_api_key
from services.rag import ensure_collection
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/auth", tags=["Auth"])

class RegisterRequest(BaseModel):
    id:       str
    name:     str
    email:    str
    password: str   # hash trong production

@router.post("/register")
def register(req: RegisterRequest):
    db = SessionLocal()

    # Check email tồn tại chưa
    if db.query(Customer).filter_by(email=req.email).first():
        raise HTTPException(400, "Email already registered")

    cid = req.id.lower().replace(" ", "-")
    api_key = generate_api_key()
    collection = f"kb_{cid}"

    customer = Customer(
        id=cid,
        name=req.name,
        email=req.email,
        api_key=api_key,
        qdrant_collection=collection,
        is_self_registered=True,
        plan="free",
        max_requests_day=50   # free plan giới hạn hơn
    )
    db.add(customer)
    db.commit()
    ensure_collection(collection)
    db.close()

    return {
        "api_key": api_key,
        "message": "Đăng ký thành công! Lưu API key này để dùng.",
        "docs_url": "https://yourdomain.com/docs"
    }