from fastapi import APIRouter, Header, HTTPException
from models.tenant import get_customer_by_key, SessionLocal
from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import create_engine
from datetime import datetime
from pydantic import BaseModel
import os

router = APIRouter(prefix="/crm", tags=["CRM"])

Base = declarative_base()
engine = create_engine(os.getenv("DATABASE_URL", ""))


# ── DB Models ─────────────────────────────────────────────────────────

class Order(Base):
    __tablename__ = "orders"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(String)          # tenant ID
    product     = Column(String)
    amount      = Column(Float)
    status      = Column(String, default="pending")
    buyer_name  = Column(String)
    buyer_email = Column(String)
    buyer_phone = Column(String)
    created_at  = Column(DateTime, default=datetime.now)


class Ticket(Base):
    __tablename__ = "tickets"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(String)
    title       = Column(String)
    description = Column(Text)
    email       = Column(String)
    status      = Column(String, default="open")
    created_at  = Column(DateTime, default=datetime.now)


class Rating(Base):
    __tablename__ = "ratings"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(String)
    score       = Column(Integer)         # 1-5
    comment     = Column(Text)
    created_at  = Column(DateTime, default=datetime.now)


Base.metadata.create_all(engine)


# ── Pydantic schemas ───────────────────────────────────────────────────

class OrderCreate(BaseModel):
    product:     str
    amount:      float
    buyer_name:  str
    buyer_email: str
    buyer_phone: str = ""


class TicketCreate(BaseModel):
    title:       str
    description: str
    email:       str


class RatingCreate(BaseModel):
    score:   int           # 1–5
    comment: str = ""


# ── Endpoints ──────────────────────────────────────────────────────────

@router.post("/orders")
def create_order(data: OrderCreate, x_api_key: str = Header(...)):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    db = SessionLocal()
    order = Order(
        customer_id=customer.id,
        product=data.product,
        amount=data.amount,
        buyer_name=data.buyer_name,
        buyer_email=data.buyer_email,
        buyer_phone=data.buyer_phone,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    order_id = order.id
    db.close()
    return {"order_id": order_id, "status": "pending", "message": "Đơn hàng đã được tạo!"}


@router.post("/tickets")
def create_ticket(data: TicketCreate, x_api_key: str = Header(...)):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    db = SessionLocal()
    ticket = Ticket(
        customer_id=customer.id,
        title=data.title,
        description=data.description,
        email=data.email,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    ticket_id = ticket.id
    db.close()
    return {"ticket_id": ticket_id, "status": "open", "message": "Ticket đã được gửi! Chúng tôi sẽ phản hồi trong vòng 4 giờ."}


@router.post("/ratings")
def create_rating(data: RatingCreate, x_api_key: str = Header(...)):
    if not 1 <= data.score <= 5:
        raise HTTPException(400, "Score phải từ 1 đến 5")
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    db = SessionLocal()
    rating = Rating(
        customer_id=customer.id,
        score=data.score,
        comment=data.comment,
    )
    db.add(rating)
    db.commit()
    db.close()
    return {"message": "Cảm ơn bạn đã đánh giá!"}
