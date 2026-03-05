from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from qdrant_client import QdrantClient
from sqlalchemy import create_engine, text
import os

# Create directory for saving avatars
os.makedirs("data/avatars", exist_ok=True)

app = FastAPI(
    title="SaaS Chatbot API",
    description="Domain Chatbot — Multi-tenant RAG + LLM API",
    version="1.0.0"
)

# ── CORS — cho phép widget từ mọi domain gọi vào ──────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # production: thu hẹp về domain cụ thể
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Kết nối services ───────────────────────────────────────────────────
qdrant = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
engine = create_engine(os.getenv("DATABASE_URL", ""))

# ── Mount routers ──────────────────────────────────────────────────────
from routers import admin, auth, chat, kb, rag_search, crm

app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(kb.router)
app.include_router(rag_search.router)
app.include_router(crm.router)

app.mount("/avatars", StaticFiles(directory="data/avatars"), name="avatars")

# ── Health check endpoints ─────────────────────────────────────────────
@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "service": "saas-chatbot-api", "version": "1.0.0"}

@app.get("/health/qdrant", tags=["System"])
def health_qdrant():
    try:
        collections = qdrant.get_collections()
        return {
            "status": "ok",
            "collections": len(collections.collections)
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@app.get("/health/db", tags=["System"])
def health_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}