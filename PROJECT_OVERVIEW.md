# Project Overview: SaaS Chatbot CMS

> Cập nhật lần cuối: Mar 22, 2026

## 1. Giới thiệu

**SaaS Chatbot CMS** là nền tảng **Multi-tenant AI Chatbot** hỗ trợ chăm sóc khách hàng tự động. Mỗi doanh nghiệp (Tenant) được trang bị chatbot tích hợp **Knowledge Base (RAG)** và khả năng kết nối với hệ thống nội bộ thông qua chuẩn **Model Context Protocol (MCP)**.

Tenant có thể: đăng ký tài khoản → cấu hình Bot (Tên, Avatar, System Prompt, Lĩnh vực, Câu chào) → tải lên tài liệu KB → nhúng script vào Website để tự động tư vấn bán hàng.

---

## 2. Tính năng Chính

### Multi-tenant
- Mỗi Tenant cô lập hoàn toàn: KB riêng (Qdrant Collection), lịch sử chat riêng, quota API riêng.
- Tenant tự quản lý qua **Tenant Portal** (`/tenant`) bằng API Key.

### RAG (Retrieval-Augmented Generation)
- **Static KB:** Upload PDF, TXT, CSV, XLSX, JSON — xử lý nền (Background Ingestion) không block UI.
- **Realtime KB:** Cập nhật giá/khuyến mãi liên tục qua API với TTL tự động.
- **Query Router:** Tự động phân luồng câu hỏi vào đúng mode (`static` / `realtime` / `hybrid`) dựa trên keyword intent.
- **Hybrid Search:** Dense Vector (Qdrant) + BM25 lexical (rank-bm25) merged bằng **Reciprocal Rank Fusion (RRF)**. Opt-in qua `?hybrid=true`. Giảm miss rate ~49% so với pure embedding. Backward compat: BM25 store trống → fallback dense-only.
- **Embedding:** Model `paraphrase-multilingual-MiniLM-L12-v2` — hỗ trợ tiếng Việt và 50+ ngôn ngữ khác. Score threshold `0.35` (dense) / `0.25` (hybrid pool).
- **Deduplication:** Tự động skip re-ingest nếu file hash (SHA-256) không đổi.
- **PDF Page Tracking:** Metadata `source_page` gán per-chunk để truy vết nguồn.
- **RAG Analytics (Zero-Latency):** Tracking mọi user query, search mode bật/tắt, top score, và các chunk trả về lưu dưới dạng JSONB. Async Logging thông qua `FastAPI BackgroundTasks` đảm bảo độ trễ = 0. Giúp Admin tối ưu Miss Rate sau này.

### KB Ingestion Pipeline
- MIME Type Validation (byte-level, `python-magic`) — chặn file giả mạo đuôi.
- Chunking với overlap: `RecursiveCharacterTextSplitter` (600-800 chars, overlap 100-150).
- Auto Language Detection (`langdetect`) gán vào metadata.
- Streaming qua `/tmp` — không buffer toàn file in-memory.
- Structured Logging: log `job_id`, `elapsed`, `chunk_count` để monitor.

### Dynamic Tool Calling (MCP)
- Bot gọi API nội bộ của doanh nghiệp (check tồn kho, cước phí, đơn hàng) qua MCP Server URL cấu hình per-tenant.
- Frontend render UI Component trực tiếp (`PricingCard`, `BuyForm`, `DomainResult`) từ Tool Calls — không render text thô.

### Bot Customization per Tenant
- `bot_name`, `bot_avatar`, `system_prompt`, `industry` (Lĩnh vực hoạt động), `greeting_message` (Câu chào).
- `industry` tự động nhúng vào System Prompt để giảm hallucination.

### Security
- IP Whitelist 2 lớp: Next.js Middleware + FastAPI Middleware kiểm tra `ALLOWED_ADMIN_IPS`.
- Swagger tách biệt: `/docs` (Client APIs, public) · `/system-docs` (toàn bộ, HTTP Basic Auth).
- MIME Validation, Upload limit (10MB/file, 50MB total, 10 files max).
- Nginx: Rate limit, gzip, timeout isolation (Widget 15s / Admin 60s).

### Admin Dashboard
- Quản lý Tenants, cấu hình hệ thống, theo dõi Quota / Requests hàng ngày, Topup.

---

## 3. Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| Backend | FastAPI (Python), Gunicorn 2 workers |
| Database | PostgreSQL (ORM SQLAlchemy) |
| Vector DB | Qdrant |
| Cache | Redis (TTL by search mode) |
| Embedding | `paraphrase-multilingual-MiniLM-L12-v2` (SentenceTransformers, local) |
| Hybrid Search | `rank-bm25` (BM25Okapi) + RRF merge — lexical index per-tenant, lưu `.pkl` |
| LLM | DeepSeek API / OpenAI API (configurable per-tenant) |
| Frontend | Next.js (TypeScript), Vercel AI SDK |
| Styling | Vanilla CSS |
| Proxy | Nginx (reverse proxy, rate limit, gzip) |

---

## 4. Deployment (docker-compose)

| Service | Vai trò |
|---------|---------|
| `api` | FastAPI container |
| `postgres` | PostgreSQL |
| `qdrant` | Vector DB |
| `redis` | Cache + Rate Limit |
| `nginx` | Reverse proxy |
| Next.js | Node process (ngoài Docker hoặc riêng) |

---

## 5. Roadmap

| Hạng mục | Trạng thái |
|----------|------------|
| KB Ingestion Pipeline (Phase 1-3) | ✅ Done |
| Multilingual Embedding + Query Router | ✅ Done |
| Hybrid Search Phase 1 — BM25 + RRF | ✅ Done — miss rate giảm ~49% |
| Realtime KB với TTL | ✅ Done |
| IP Whitelist 2 lớp | ✅ Done |
| Bot Avatar upload | ✅ Done |
| Industry / Greeting Message per Tenant | ✅ Done |
| Query Router trong Chat Endpoint | 🔲 Hiện chỉ trong `/rag/search` — chưa tích hợp `chat.py` |
| RAG Analytics: Backend, Tenant UI & Actionable Fixes (Phase 1-3) | ✅ Done |
| Hybrid Search Phase 2 — Contextual Embeddings | 🔲 Optional — cần ANTHROPIC_API_KEY |
| Hybrid Search Phase 3 — CrossEncoder Reranker | 🔲 Optional — thêm ~100ms latency |
| Chat History UI trong Tenant Dashboard | 🔲 Placeholder |
| Sensitivity Classifier + PII Sanitizer | 🔲 Phase 4 — Zero-Upload RAG |
| MCP Gateway on-premise + mTLS | 🔲 Phase 4 |
| OCR cho PDF dạng ảnh quét | 🔲 Phase 4 |
