from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from qdrant_client import QdrantClient
from sqlalchemy import create_engine, text
import os
import secrets

# Create directory for saving avatars
os.makedirs("data/avatars", exist_ok=True)

# ── Env config ─────────────────────────────────────────────────────────
_DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"
_ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = (
    [o.strip() for o in _ALLOWED_ORIGINS_RAW.split(",") if o.strip()]
    if _ALLOWED_ORIGINS_RAW
    else ["*"]  # fallback: open in dev
)

# TrustedHostMiddleware chỉ so sánh hostname (không có port)
# → phải strip port khỏi list trước khi truyền vào middleware
_ALLOWED_HOSTS_RAW = os.getenv("ALLOWED_HOSTS", "*")
ALLOWED_HOSTS = (
    ["*"]
    if _ALLOWED_HOSTS_RAW.strip() == "*"
    else [h.strip().split(":")[0] for h in _ALLOWED_HOSTS_RAW.split(",") if h.strip()]
)

SYSTEM_DOCS_USER = os.getenv("SYSTEM_DOCS_USER", "admin")
SYSTEM_DOCS_PASS = os.getenv("SYSTEM_DOCS_PASS", "changeme")

_ALLOWED_ADMIN_IPS_RAW = os.getenv("ALLOWED_ADMIN_IPS", "*")
ALLOWED_ADMIN_IPS = (
    ["*"]
    if _ALLOWED_ADMIN_IPS_RAW.strip() == "*"
    else [ip.strip() for ip in _ALLOWED_ADMIN_IPS_RAW.split(",") if ip.strip()]
)

# ── Client-API tags (exposed in /docs) ─────────────────────────────────
CLIENT_TAGS = {"Knowledge Base (Client)", "Chat (Client)", "RAG Search (Client)"}

# ── FastAPI app — docs disabled (we expose custom endpoints below) ──────
app = FastAPI(
    title="SaaS Chatbot API",
    description="Domain Chatbot — Multi-tenant RAG + LLM API",
    version="1.0.0",
    docs_url=None,      # Custom /docs below
    redoc_url=None,
    openapi_url=None,   # Custom /openapi.json below
)

# ── IP Whitelist for Admin & Tenant ─────────────────────────────────────
from fastapi.responses import JSONResponse
from fastapi import Request

@app.middleware("http")
async def ip_whitelist_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/admin") or path.startswith("/system-docs"):
        if "*" not in ALLOWED_ADMIN_IPS:
            # Lấy IP thật (nếu có proxy từ Nginx)
            client_ip = request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for") or request.client.host
            if client_ip and "," in client_ip:
                client_ip = client_ip.split(",")[0].strip()
            
            if client_ip not in ALLOWED_ADMIN_IPS:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Forbidden: Your IP is not whitelisted for Admin/Tenant operations."}
                )
    return await call_next(request)


# ── TrustedHost Middleware ──────────────────────────────────────────────
if "*" not in ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

# ── CORS ────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── SQLAlchemy engine with connection pool ──────────────────────────────
engine = create_engine(
    os.getenv("DATABASE_URL", ""),
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,   # recycle connections every 30 min
    pool_pre_ping=True,  # verify connection health before use
)

# ── Qdrant ──────────────────────────────────────────────────────────────
qdrant = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))

# ── Mount routers ───────────────────────────────────────────────────────
from routers import admin, auth, chat, kb, rag_search, crm, analytics

app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(kb.router)
app.include_router(rag_search.router)
app.include_router(crm.router)
app.include_router(analytics.router)

app.mount("/avatars", StaticFiles(directory="data/avatars"), name="avatars")


# ── Custom Swagger: Client API (/docs) ─────────────────────────────────
def _client_openapi():
    """OpenAPI schema chỉ gồm Client-facing endpoints."""
    full = get_openapi(
        title="SaaS Chatbot — Client API",
        version="1.0.0",
        description="Public API dành cho Developer tích hợp Widget & KB. Xác thực bằng `x-api-key` header.",
        routes=app.routes,
    )
    # Filter paths: chỉ giữ paths thuộc CLIENT_TAGS
    filtered_paths = {}
    for path, item in full.get("paths", {}).items():
        for method, op in item.items():
            if set(op.get("tags", [])) & CLIENT_TAGS:
                filtered_paths[path] = item
                break
    full["paths"] = filtered_paths
    return full

@app.get("/openapi-client.json", include_in_schema=False)
def client_openapi_json():
    return _client_openapi()

@app.get("/docs", include_in_schema=False)
def client_swagger_ui():
    return get_swagger_ui_html(
        openapi_url="/openapi-client.json",
        title="Client API Docs",
    )


# ── Custom Swagger: System API (/system-docs) — Basic Auth ─────────────
_http_basic = HTTPBasic()

def _require_system_auth(credentials: HTTPBasicCredentials = Depends(_http_basic)):
    ok_user = secrets.compare_digest(credentials.username, SYSTEM_DOCS_USER)
    ok_pass = secrets.compare_digest(credentials.password, SYSTEM_DOCS_PASS)
    if not (ok_user and ok_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )

@app.get("/openapi-system.json", include_in_schema=False)
def system_openapi_json(credentials: HTTPBasicCredentials = Depends(_http_basic)):
    _require_system_auth(credentials)
    return get_openapi(
        title="SaaS Chatbot — System API",
        version="1.0.0",
        description="Internal API dành cho Platform Admin. Xác thực bằng `x-admin-secret` header.",
        routes=app.routes,
    )

@app.get("/system-docs", include_in_schema=False)
def system_swagger_ui(credentials: HTTPBasicCredentials = Depends(_http_basic)):
    _require_system_auth(credentials)
    return get_swagger_ui_html(
        openapi_url="/openapi-system.json",
        title="System API Docs",
    )


# ── Health checks ───────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "service": "saas-chatbot-api", "version": "1.0.0"}

@app.get("/health/qdrant", tags=["System"])
def health_qdrant():
    try:
        collections = qdrant.get_collections()
        return {"status": "ok", "collections": len(collections.collections)}
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