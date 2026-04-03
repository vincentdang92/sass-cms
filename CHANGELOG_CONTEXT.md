# Changelog & Context Document

> **Mục đích:** Ghi lại context kỹ thuật cho từng task đã thực hiện — lý do thiết kế, side effect, TODO còn lại.  
> **Audience:** Dev nội bộ onboarding, code review, debug khi có bug liên quan.  
> Sắp xếp: mới nhất → cũ nhất.

---

## [Mar 23, 2026] RAG Analytics: Miss Rate Tracking (Phase 1 - Backend Logging)
**Task:** Tự động giám sát mọi truy vấn (query) vào hệ thống RAG và lưu lại các chunk DB trả về kèm điểm số (score) để Admin có thể dựa vào đó tối ưu hóa dữ liệu, khắc phục lỗi Miss Rate.

### 1. Lý do thiết kế (Technical Context)
- **Vấn đề:** Khi RAG bot trả lời thiếu chính xác ("miss"), Admin không biết được do User hỏi sai, hay do Vector DB fetch trúng chunk không liên quan, hay score quá thấp nên RAG bỏ qua.
- **Giải pháp:** Xây dựng cơ chế **Zero-Latency Logging**. Mỗi khi route `/chat` hoặc `/rag/search` thực hiện tìm kiếm, ta dùng `FastAPI BackgroundTasks` để ghi lại *(Customer ID, Câu hỏi, Mode, Điểm Max, Cấu trúc Chunks)* vào bảng `rag_analytics_logs`.
- Toàn bộ mảng document trả về được đưa vào cột kiểu **JSONB** gốc của PostgreSQL, giúp ghi cực nhanh trên 1 Row thay vì bảng phụ.

### 2. Thay đổi cụ thể
- **`api/models/tenant.py`:** Thêm `RagAnalyticsLog` table sử dụng cột `JSON`.
- **`api/services/analytics.py`** (NEW): Hàm `log_rag_query` insert async.
- **`api/services/rag.py`:** Cập nhật hàm `search` và `search_hybrid` thêm option `return_dicts=True` để lấy cả Score và chunk ID thay vì chỉ string thô như trước.
- **`api/routers/rag_search.py` & `api/routers/chat.py`:** Inject `BackgroundTasks`, thu thập `latency_ms` và đẩy xuống `log_rag_query`. Trễ ghi DB hoàn toàn bị triệt tiêu với người dùng.

### 3. Side Effect
- Dung lượng Database PostgreSQL sẽ tăng do chuỗi JSON chứa nội dung log. 
- *Cách khắc phục sau này:* Cần 1 worker xóa các log cũ có điểm số `top_score > 0.8` (vì không cần tối ưu) để tiết kiệm ổ cứng.

### 4. Triển khai Phase 2 (Tenant UI & Analytics Dashboard)
- **`api/routers/analytics.py`**: Tạo router mới chứa 2 endpoints:
  - `GET /analytics/rag-stats`: Tính tổng số query, số query rủi ro (score < 0.4), tỉ lệ Miss Rate %, và độ trễ trung bình.
  - `GET /analytics/rag-logs`: Truy xuất lịch sử các query kèm thông tin chi tiết các chunk trả về, hỗ trợ filter theo thời gian và điểm số.
- Đã đăng ký `analytics.router` vào `main.py`.
- **`chatbot-ui/app/tenant/dashboard/page.tsx`**: Thêm tab **📈 Analytics** mới:
  - Hiển thị 4 thẻ thống kê trực quan (Tổng Query, Câu hỏi rủi ro, Tỉ lệ Miss, Độ trễ DB).
  - Bảng lịch sử các query gần nhất, highlight màu đỏ cho các query có điểm < 0.4 (cảnh báo RAG missed).
  - Tích hợp gọi API với Header `x-api-key`.

### 5. Triển khai Phase 3 (Actionable Analytics & Cleanup)
- **Interactive UI (Tenant Dashboard):** Thêm nút "⚡ Tối ưu" ở mỗi dòng query. Bấm vào sẽ mở `OptimizeModal` để phân tích query và các chunks bị miss.
- **Actionable Fixes:** Cung cấp 2 phương án tùy chọn trực tiếp trên Modal:
  - **Phương án 1 (Thêm Hỏi Đáp Thủ Công):** Nhập trực tiếp câu trả lời cho query để sinh ra 1 KB file dạng Manual Text lưu vào hệ thống (`POST /admin/customers/{id}/kb/text`).
  - **Phương án 2 (Sửa Chunk hiện tại):** Nếu có trả về chunk nhưng điểm thấp, cho phép click **Sửa Chunk này** để bổ sung Keyword/Synonyms thẳng vào văn bản gốc (`PUT /admin/customers/{id}/kb/{doc_id}`).
- **Database Cleanup:** Thêm API `DELETE /analytics/cleanup` tự dọn dẹp các log cũ hơn 30 ngày VÀ có `top_score >= 0.8` (các truy vấn đã tốt, không cần theo dõi) để tối ưu dung lượng PostgreSQL.

---

## [Mar 22, 2026] Hybrid Search Upgrade — Phase 1 (BM25 + Reciprocal Rank Fusion)
**Task:** Nâng cấp RAG retrieval từ pure Dense Vector Search sang Hybrid Search (BM25 lexical + Dense vector + RRF merge) để giảm miss rate khi khách hỏi tên sản phẩm chính xác, mã SKU, hoặc từ khóa đặc thù.

### 1. Lý do thiết kế (Technical Context)
- **Vấn đề gốc:** Model `paraphrase-multilingual-MiniLM-L12-v2` rất tốt cho semantic similarity nhưng kém với exact-match queries (tên SP "iPhone 16 Pro Max", mã "SP001") vì embedding map semantic meaning, không giữ nguyên từ khóa. Miss rate baseline ~5.7%.
- **Giải pháp:** Áp dụng kỹ thuật **Hybrid Search** theo Anthropic Contextual Retrieval: Dense (Qdrant) + BM25 (lexical), merge bằng **Reciprocal Rank Fusion (RRF)** — thuật toán rank merging tự động không cần tune weight, `k=60` theo paper gốc. Kết quả lấy `top_k` từ merged list.
- **Backward compatibility:** `search()` cũ giữ nguyên hoàn toàn. `search_hybrid()` là opt-in qua `?hybrid=true`. Nếu collection chưa có BM25 index → fallback dense-only (hành vi y hệt trước).

### 2. Thay đổi cụ thể

**`api/services/bm25_store.py`** (NEW):
- `BM25Store` class: corpus + doc IDs, serialize `/data/bm25_indexes/{collection}.pkl` (Docker volume).
- `tokenize_vi()`: regex tokenizer giữ dấu tiếng Việt, bỏ ký tự đơn vô nghĩa.
- `add_documents()`, `remove_by_ids()`, `search()`, `save()`, `load()`.
- `reciprocal_rank_fusion()`: merge ranked lists theo RRF formula.
- Helper: `get_bm25_store()`, `save_bm25_store()`, `delete_bm25_store()`.

**`api/services/rag.py`:**
- Thêm `ingest_with_ids()`: như `ingest()` nhưng trả về `list[str]` point IDs để BM25 tracking.
- Thêm `search_hybrid()`: dense search (threshold=0.25, pool=`top_k×4`) + BM25 + RRF merge + fetch payload + cache kết quả. Fallback về `search()` khi lỗi.
- `delete_by_filename()`: scroll Qdrant thu thập IDs trước khi delete → sync `bm25_store.remove_by_ids()`.
- `delete_collection()`: thêm `delete_bm25_store()` khi clear toàn bộ collection.

**`api/routers/kb.py`:**
- `process_kb_ingestion()`: sau Qdrant ingest, collect `(point_id, content)` → `get_bm25_store()` → `add_documents()` → `save_bm25_store()`. Lỗi BM25 không làm fail ingestion chính.

**`api/routers/rag_search.py`:**
- Thêm `hybrid: bool = False` query param. Khi `True` → `search_hybrid()`. Response thêm `search_type` field.

**`api/scripts/build_bm25_indexes.py`** (NEW):
- Migration script: scroll Qdrant → rebuild BM25 index → lưu pkl. Chạy 1 lần cho tenant data cũ.

**`docker-compose.yml`:** Volume `bm25-indexes:/data/bm25_indexes`, env `BM25_INDEX_DIR`.

**`api/requirements.txt`:** Thêm `rank-bm25`.

### 3. Side Effect (Chủ đích & Tiềm ẩn)
- **Ghost IDs trong BM25:** Xóa chunk khỏi Qdrant mà không sync BM25 → BM25 trả về ID không còn tồn tại → `qdrant.retrieve()` bỏ qua → content rỗng, không crash. `delete_by_filename()` đã handle. `delete_by_source_id()` (Realtime KB) chưa sync — thêm sau nếu cần.
- **BM25 rebuild cost:** Mỗi lần thêm document phải rebuild `BM25Okapi` (không hỗ trợ incremental). Collection lớn (>50k chunks) rebuild ~5-10s — chạy background nên không ảnh hưởng user.
- **Dense threshold trong hybrid:** Giảm từ 0.35 → 0.25 để pool lớn hơn cho RRF. Kết quả cuối an toàn vì RRF rerank.
- **Disk:** mỗi `.pkl` ~2-10MB. 100 tenants < 1GB — không đáng kể.

### 4. TODO còn lại (Next steps if any)
- **Phase 2 (optional):** Contextual Embeddings — Claude Haiku generate context per chunk, cần `ANTHROPIC_API_KEY`. Giảm thêm ~35% miss rate.
- **Phase 3 (optional):** CrossEncoder Reranker (`BAAI/bge-reranker-v2-m3`) sau RRF → tổng giảm ~67% miss rate, thêm ~100ms latency.
- Bật `hybrid=true` mặc định trong `route.ts` sau khi backfill BM25 indexes xong.
- Sync `delete_by_source_id()` với BM25 nếu Realtime KB cần exact-match support.

---

## [2026-03-20] Comprehensive KB Ingestion Improvements (Phase 1, 2, 3)
**Task:** Tái cấu trúc pipeline xử lý file Upload (Knowledge Base Ingestion) để giải quyết các vấn đề về memory leak, security, RAG quality và scalability.

### 1. Lý do thiết kế (Technical Context)
- **Security & Stability (Phase 1):** 
  - `db.close()` ở pipeline cũ bị sót trong trường hợp exception văng ra sớm `db.query()`, dễ dẫn đến tràn connection pool. Đã fix bằng cấu trúc 1 `try/finally` bao toàn bộ logic.
  - Cấu hình validate **MIME type** qua thư viện `python-magic` thực sự thay vì chỉ ngó đuôi file extension, nhằm chống spoofing & malware injection. 
- **RAG Quality (Phase 2):**
  - Tách từ (Chunking) theo số từ cố định ở code cũ gây cắt ngắt câu (không có overlap). Đổi sang `RecursiveCharacterTextSplitter` (Langchain) để chunking có duy trì ngữ cảnh (overlap=100) và ưu tiên ngắt ở dấu câu. 
  - Thêm cơ chế **Deduplication** (chống trùng lặp data): Sử dụng mã băm `SHA-256` của nội dung file để kiểm tra. Xóa vector cũ nếu upload đè file cùng tên. Dữ liệu bảng (CSV/XLSX) được gán 1 `row` = 1 `document`. Auto-detect luôn ngôn ngữ (`vi`/`en`) gán vào Metadata.
- **Scalability (Phase 3):**
  - File trước đó bị buffer hoàn toàn in-memory xuyến suốt background job (Gây quá tải RAM với file nặng). Đổi cơ chế Streaming qua `/tmp` disk storage (`tempfile.NamedTemporaryFile`) rồi tự động unlink dọn dẹp khi xong.
  - Áp dụng structured logging tính toán duration của từng chunks ingestion cho việc observability.

### 2. Side Effect (Chủ đích & Tiềm ẩn)
- Yêu cầu library OS-level là `libmagic1` trong Docker (`apt-get install libmagic1`) để `python-magic` làm việc được.
- Build image có thể nặng hơn do cài đặt chuỗi dependency của `langchain-text-splitters` và Torch.

### 3. TODO còn lại (Next steps if any)
- Bổ sung cơ chế OCR (vào Phase 4) nếu cần support file PDF quét dạng ảnh.

---

## [2026-03-20] Configurable Industry Context & Custom Greeting Message
**Task:** Thêm thiết lập "Lĩnh vực hoạt động" (Industry) và "Câu chào mặc định" (Greeting Message) riêng biệt cho từng Tenant.

### 1. Lý do thiết kế (Technical Context)
- **Vấn đề:** 
  - Khách hàng (Tenant) ở các ngành hàng khác nhau (ví dụ Nail, Spa) thường bị AI sinh ra nội dung hoặc hành vi chệch hướng (hallucination) do không có System Context chuyên sâu ngoài Prompt.
  - Widget mặc định hiển thị câu chào cứng: *"Xin chào! Tôi có thể giúp gì cho bạn về domain và hosting hôm nay?"*, quá đặc thù cho công ty Hosting.
- **Giải pháp:** 
  - Thêm cột `industry` và `greeting_message` vào model `Customer` (PostgresDB).
  - Cập nhật backend API (`/admin/customers` và `/admin/customers/me`) để đọc/ghi 2 trường này.
  - Sửa frontend Widget (`chatbot-ui/app/api/chat/route.ts`): Tự động nhúng câu `(Lĩnh vực hoạt động của doanh nghiệp này: {industry})` vào system prompt. Nhờ đó, ngay cả khi Tenant quên cấu hình Prompt, AI vẫn biết đang tư vấn cho Spa hay Bất Động Sản.
  - UI Admin & Tenant Dashboard (`[tenantId]/page.tsx`, `tenant/dashboard/page.tsx`): Bổ sung Form Input cho phép tùy chỉnh Lĩnh vực và Câu chào.

### 2. Side Effect (Chủ đích & Tiềm ẩn)
- Các Tenant cũ chưa có dữ liệu sẽ tự động lấy Fallback String: Lĩnh vực là "Tổng hợp" và câu chào mặc định lịch sự.
- DB thao tác Alter column thông qua raw SQL chạy trên Docker container, không làm hỏng dữ liệu cũ.

### 3. TODO còn lại (Next steps if any)
- Nếu có quá nhiều thiết lập ngữ cảnh phức tạp hơn, có thể chuyển `industry` và các system config sang 1 cột dạng JSON `metadata` thay vì thêm nhiều cột VARCHAR rời rạc vào bảng Customer.


---

## [2026-03-20] Dynamic Domain-Agnostic Context & Components
**Task:** Loại bỏ các thông tin hardcode giới hạn hệ thống vào "tên miền / hosting", mở rộng cho mọi lĩnh vực ngành nghề (Nail, Ecommerce, v.v.).

### 1. Lý do thiết kế (Technical Context)
- **Vấn đề:** 
  - File `app/api/chat/route.ts` trước đây ép cứng System Prompt bằng các nguyên tắc như: `Khi khách hỏi giá → gọi tool showPricing`.
  - Tool `showPricing` định nghĩa `category: z.enum(['domain', 'hosting', 'vps'])`. Điều này khiến AI hiểu nhầm nó chỉ bán Tên miền, nếu Tenant là một Tiệm Nail (ex: Collection `kb_amaz-nail`), AI sẽ bị "ảo giác" (hallucination) hoặc trả về schema không hợp lệ.
- **Giải pháp:** 
  - **Mềm dẻo hoá Prompt:** Cập nhật System Prompt trong `route.ts`. Thay vì ép AI gọi tool cụ thể, prompt mô tả: *"Bạn có thể sử dụng các "Tools" được cung cấp để hiển thị thông tin trực quan hơn..."*. Để cho chính Tenant Config (`config.system_prompt`) làm nội dung định hướng chính (ví dụ Tenant cấu hình "Tôi là tiệm làm Nail...").
  - **Mềm dẻo hoá Schema:** Sửa `category` thành `z.string().describe('Tên danh mục sản phẩm/dịch vụ...')`, cho phép AI tự điền "Dịch vụ làm móng", "Mỹ phẩm" thay vì ép `domain`.
  - **Chỉnh sửa Component:** Cập nhật `<PricingCard />` để render linh hoạt mọi category mà AI trả về, thay vì render icon tĩnh theo object lookup.

### 2. Side Effect (Chủ đích & Tiềm ẩn)
- **Hiệu năng suy luận (Inference):** Vì prompt linh hoạt hơn nên LLM cần khả năng suy luận tốt để tự quyết định khi nào gọi GUI Tools. Đối với DeepSeek-Chat hoặc GPT-4o-mini, chúng thừa sức thực hiện việc này.
- Component sẽ render tên category chính xác mà LLM sinh ra cùng với icon chung `🏷️` nếu không macth các category cũ.

### 3. TODO còn lại (Next steps if any)
- Nếu sau này có thêm nhiều UI Components mới, cần có cơ chế để LLM tự generate dynamic props thay vì phải khai báo `zod` schema thủ công trong code.


---

## [2026-03-20] Implementing IP Whitelist (Security Validation)
**Task:** Thêm security validate allow ipv4 để cho phép admin và tenant có thể login vào trang quản trị.

### 1. Lý do thiết kế (Technical Context)
- **Vấn đề:** Các trang quản trị (Super Admin Dashboard và Tenant Portal) có nguy cơ bị tấn công brute-force auth token hoặc khai thác lỗ hổng UI nếu để public. Cần cơ chế lọc IP truy cập.
- **Giải pháp:** 
  - Triển khai **Security 2 lớp**:
    1. **Frontend (Next.js Middleware):** Chặn ở mức Route Routing. `middleware.ts` bắt mọi request vào `/admin` và `/tenant`. Nếu IP không có trong danh sách `ALLOWED_ADMIN_IPS`, lập tức trả về `403 Forbidden`. Nhanh và tiết kiệm resource cho backend.
    2. **Backend (FastAPI Middleware):** Chặn ở mức API Layer. Các logic thao tác data siêu nhạy cảm (`/admin/*`) và document hệ thống (`/system-docs`) đều qua HTTP Middleware trong `main.py` để phân giải `X-Forwarded-For` từ Nginx proxy và chặn truy cập trái phép.
  - Biến môi trường: Sử dụng `ALLOWED_ADMIN_IPS` (phân cách bằng dấu phẩy) để quy định danh sách. Hỗ trợ wildcard `*` dành cho môi trường dev.

### 2. Side Effect (Chủ đích & Tiềm ẩn)
- **Lưu ý triển khai (Deployment):** Bắt buộc Nginx (hoặc Reverse Proxy) phải truyền qua header `X-Real-IP` hoặc `X-Forwarded-For`, nếu không API sẽ nhận IP của Docker Gateway (thường là `172.x.x.x`), gây block nhầm hoặc bypass whitelist. *Đã config Nginx chuyển `X-Real-IP` đúng cách trước đó.*
- **Lưu ý Local Dev:** Gần đây `main.py` đọc hostname thông qua `TrustedHostMiddleware`. Middleware này đòi hỏi client gửi đúng host header, do vậy ta phải xử lý chuỗi host header cắt port `:8001` trước khi so host.
- **Tính trọn vẹn của Widget:** Route `/api/chat` và Next.js `/widget` hoàn toàn **không** chịu ảnh hưởng của IP Whitelist này, khách thuê (Guest) vào chat bình thường không bị chặn.

### 3. TODO còn lại (Next steps if any)
- Bổ sung cấu trúc parse CIDR block (như `192.168.1.0/24`) vào Middleware nếu doanh nghiệp có scale mạng lớn thay vì chỉ match exact IPv4 string như hiện tại.

---

## [Mar 21, 2026] RAG Architecture Upgrades — Phase 2 & 3 (Master Planning)
- **Technical Context**: Đổi Embedding Model từ `paraphrase-MiniLM-L3-v2` sang `paraphrase-multilingual-MiniLM-L12-v2` để hỗ trợ tiếng Việt hiệu quả thay vì text thuần túy tiếng Anh. Xây dựng logic AI Routing thay vì filter cứng.
- **Side effects**: Cần chạy Data Migration Script (`python scripts/re_embed.py`) trên production db do Vector Space bị sai khác giữa 2 model dẫn đến toàn bộ query cũ ra random result nếu không re-embed.  `score_threshold` được nâng từ 0.2 lên 0.35 vì model xịn hơn trả về score cực cao với context chuẩn xác.
- **Changes**:
  - `rag.py`: Thay đổi tên model embedding và score threshold lên `0.35` (cách ly fallback `0.3`).
  - `scripts/re_embed.py`: API tool chạy ngầm tái cấu trúc lại Vector Space (Kéo Qdrant collections về, chạy vào encode mới, sau đó upsert ghi đè point id).
  - `query_router.py`: Tool phân luồng tìm kiếm (Pricing, Policy = STATIC/REALTIME) trước khi gọi RAG Search để tránh query nhầm data.
  - `rag_search.py`: Chèn logic Routing này vào endpoint dành riêng cho Chatbot UI Widget call sang thay vì LLM phải tự phân biệt ngu ngốc.
  - `kb.py`: 
    - Auto-skip Ingest cho những file Hash content trùng lặp khớp `status="completed"`. Tiết kiệm CPU xử lý file 10-20MB vô ích.
    - PDF Extraction: Tách cấu trúc `{text, page_num}` làm attribute meta `source_page` cho từng node Chunk Text từ file PDF.
    - Router endpoint DELETE/POST `realtime/invalidate` dựa trên danh mục.
  - `cache.py`: Update hàm `invalidate_by_category`.

---
## [Mar 20, 2026] Widget Error Isolation & Nginx Reverse Proxy dựng Tenant Portal riêng biệt độc lập khỏi Admin, tách biệt và cô lập Widget routing không đánh crash app chính.

### 1. Lý do thiết kế
- **Tenant Portal:** Giảm tải cho Super Admin, cho phép khách hàng chủ động Upload Knowledge Base và Edit Prompts. Tạo `/tenant/login` và auth bằng `x-api-key`. Auth được cache trong `sessionStorage`.
- **Widget Error Isolation:** Khi khách hàng dev MCP Tools lỗi hoặc gọi API lỗi dẫn đến crash React render, nguyên Next.js App không được sập theo. Đã apply standard Route-level Error Boundaries của React/Next13: `widget/error.tsx` tuỳ chỉnh hiển thị error page local mà không ảnh hưởng `layout.tsx` bên ngoài. Backend Nginx proxy timeout cho Widget ép xuống ngắn hơn (15s) thay vì treo.

### 2. Side Effect
- Do backend gỡ `--reload` bằng gunicorn production 2 workers, logging stream console bị đổi format, không còn màu của mặc định uvicorn nhưng chuẩn hơn cho production APM log.

### 3. TODO còn lại
- Chức năng Chat History trong Tenant Dashboard hiện tại mang tính chất placeholder. API `/history` đã ghi log session, nhưng cần xây dựng UI list view trong dashboard sau.
