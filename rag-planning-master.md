# RAG Chatbot — Master Planning

> Tài liệu tổng hợp toàn bộ planning và trạng thái triển khai.  
> Cập nhật lần cuối dựa trên `kb.py` + `rag.py` hiện tại.

---

## Trạng thái tổng quan

| Module | Trạng thái | Ghi chú |
|---|---|---|
| KB Ingestion — Critical fixes | ✅ Done | DB session fix, MIME validation, tmp file |
| KB Ingestion — RAG quality | ✅ Done | Chunking overlap, dedup, rich metadata |
| KB Ingestion — Observability | ✅ Done | Structured logging, elapsed time |
| Embedding model | ⚠️ Cần đổi | Đang dùng L3 EN-only, chưa hỗ trợ tiếng Việt |
| TTL Knowledge Base | 🔲 Chưa làm | Query Router, TTL cache Redis |
| Zero-Upload RAG (MCP) | 🔲 Chưa làm | Sensitivity Classifier, MCP Gateway, PII Sanitizer |

---

## Phần 1 — KB Ingestion

### Những gì đã làm được trong `kb.py`

#### ✅ DB Session Leak Fix
`db = SessionLocal()` và toàn bộ logic nằm trong một `try/finally` duy nhất.
Session luôn được đóng kể cả khi exception xảy ra ở bất kỳ dòng nào.

```python
db = SessionLocal()
job = None
try:
    job = db.query(KBJob).filter_by(id=job_id).first()
    # ... toàn bộ xử lý ...
except Exception as e:
    if job:
        job.status = "failed"
        job.error_message = str(e)[:500]
        db.commit()
finally:
    db.close()          # luôn chạy
    for meta in files_meta:
        os.unlink(meta["tmp_path"])   # dọn tmp files
```

#### ✅ MIME Type Validation
Dùng `python-magic` kiểm tra byte signature thực tế, không chỉ extension.
Graceful degradation nếu `python-magic` chưa được cài.

```python
ALLOWED_MIMES = {
    "application/pdf", "text/plain", "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel", "application/json", "application/octet-stream",
}

def validate_file_mime(content: bytes, filename: str) -> None:
    if not _HAS_MAGIC:
        return
    mime = _magic.from_buffer(content, mime=True)
    if mime not in ALLOWED_MIMES:
        raise HTTPException(415, f"File type not allowed: {mime}")
```

#### ✅ Chunking Strategy với Overlap

| Loại file | Strategy | chunk_size | overlap |
|---|---|---|---|
| General / mặc định | RecursiveCharacterTextSplitter | 600 chars | 100 |
| Policy / điều khoản | RecursiveCharacterTextSplitter | 800 chars | 150 |
| FAQ | Split theo `\n\n` (Q&A pair) | — | — |
| XLSX / CSV (tabular) | 1 row = 1 document | — | — |

Fallback về word-based chunking (size=150, overlap=20) nếu `langchain` chưa cài.

#### ✅ Deduplication bằng File Hash
Trước mỗi ingest, xóa toàn bộ vector cũ cùng `filename` trong Qdrant.
File hash SHA-256 lưu vào metadata để có thể detect file không đổi.

```python
f_hash = file_hash(content)          # SHA-256
delete_by_filename(collection, filename)   # xóa vector cũ
# ingest lại từ đầu với hash mới trong metadata
```

#### ✅ Rich Metadata
Mỗi chunk được đánh tag đầy đủ:

```python
{
    "filename": filename,
    "type": kb_type,           # "general" | "pricing" | "faq" | "policy"
    "kb_type": "static",       # dùng cho Query Router
    "customer_id": job.customer_id,
    "chunk_index": i,          # vị trí trong file
    "total_chunks": len(chunks),
    "file_hash": f_hash,
    "ingested_at": ingested_at,
    "job_id": job_id,
    "language": lang,          # "vi" | "en" | "unknown"
}
```

#### ✅ Memory Management — Tmp File
File bytes được ghi ra `/tmp` ngay trong endpoint, background task chỉ nhận path.
RAM không giữ bytes trong suốt thời gian xử lý.

#### ✅ Structured Logging
```
KB ingestion started | job=<id> files=3
File ingested | job=<id> file=pricing.xlsx chunks=87 type=pricing
KB ingestion completed | job=<id> total_chunks=142 elapsed=4.23s
```

### Việc còn lại trong KB Ingestion

#### 🔲 Skip re-ingest nếu file không đổi
Hiện tại đã có `file_hash` trong metadata nhưng chưa dùng để skip.
Cần thêm column `file_hash` vào `KBJob` model:

```python
# models/tenant.py — thêm column
file_hash = Column(String, nullable=True)

# kb.py — kiểm tra trước khi xóa vector cũ và ingest lại
existing = db.query(KBJob).filter_by(
    customer_id=job.customer_id,
    filename=filename,
    status="completed"
).first()
if existing and existing.file_hash == f_hash:
    logger.info("Skip unchanged file | file=%s hash=%s", filename, f_hash[:8])
    continue
```

#### 🔲 Source page cho PDF
Hiện tại PDF được join thành 1 string rồi chunk — mất thông tin page number.

```python
# kb.py extract_text() — thêm source_page vào metadata
text_parts = []
for page_num, page in enumerate(pdf.pages, start=1):
    page_text = page.extract_text()
    if page_text:
        text_parts.append({"text": page_text, "page": page_num})

# Khi chunk, gán source_page vào metadata từng chunk
```

---

## Phần 2 — Embedding Model

### Vấn đề với model hiện tại

```python
# rag.py — dòng hiện tại
_model = SentenceTransformer("paraphrase-MiniLM-L3-v2")
```

| Vấn đề | Chi tiết |
|---|---|
| Không có tiếng Việt | Train thuần tiếng Anh — câu hỏi "giá bao nhiêu?" embed gần như random với chunk KB tiếng Việt |
| Chỉ 3 layers | MTEB ~47, yếu nhất dòng MiniLM. L6 đã là ~56 |
| Max 128 tokens | Chunk dài hơn 128 tokens bị cắt cụt, mất context cuối |
| Score threshold 0.2 | Đã hạ xuống thấp bất thường trong code — dấu hiệu retrieval đang kém |

### Lộ trình đổi model

#### Bước 1 — Đổi ngay (1 dòng code, miễn phí)

```python
# Thay thế trong rag.py
_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
VECTOR_SIZE = 384   # giữ nguyên, cùng dims
```

Lý do chọn:
- 50+ ngôn ngữ bao gồm tiếng Việt
- MTEB ~53 (tăng từ ~47)
- ~470MB — load 1 lần khi khởi động, không ảnh hưởng inference latency
- Cùng 384 dims — không cần migrate vector store

**Quan trọng:** Sau khi đổi model, phải re-embed toàn bộ KB hiện có vì vector space thay đổi.

```python
# Script re-embed — chạy 1 lần sau khi đổi model
def reembed_collection(collection: str):
    points, _ = list_points(collection, limit=10000)
    for p in points:
        new_vec = embed(p["content"])
        qdrant.upsert(collection_name=collection,
                      points=[PointStruct(id=p["id"], vector=new_vec, payload=p)])
    print(f"Re-embedded {len(points)} points in {collection}")
```

**Sau khi đổi model:** Nâng `score_threshold` từ `0.2` lên `0.35`–`0.4` trong `rag.py`.

#### Bước 2 — Nếu KB chủ yếu tiếng Việt (tùy chọn)

```python
# pip install pyvi
_model = SentenceTransformer("dangvantuan/vietnamese-embedding")
VECTOR_SIZE = 768   # dims khác — cần tạo lại collection
```

Ưu điểm: STS score 84.87 trên tiếng Việt, max 512 tokens.
Nhược điểm: Dims thay đổi (768), cần migrate toàn bộ collection.

#### Bước 3 — Khi scale lên (có server tốt hơn)

```python
_model = SentenceTransformer("BAAI/bge-m3")
VECTOR_SIZE = 1024  # cần ~2.3GB RAM, migrate collection
```

MTEB ~68, max 8192 tokens, 100+ ngôn ngữ.

### So sánh nhanh

| Model | MTEB | Tiếng Việt | Size | Max tokens | Dims |
|---|---|---|---|---|---|
| paraphrase-MiniLM-L3-v2 ← đang dùng | ~47 | ✗ | ~17MB | 128 | 384 |
| paraphrase-multilingual-MiniLM-L12-v2 ← **đổi ngay** | ~53 | ✓ | ~470MB | 128 | 384 |
| dangvantuan/vietnamese-embedding | — (STS 84.87) | ✓ native | ~400MB | 512 | 768 |
| BAAI/bge-m3 | ~68 | ✓ | ~2.3GB | 8192 | 1024 |

---

## Phần 3 — TTL Knowledge Base

### Metadata Schema

Mỗi realtime chunk **bắt buộc** có đủ các field sau (đã implement trong `upload_realtime_kb`):

```json
{
    "source_id": "price_iphone16_pro",
    "category": "pricing",
    "valid_from": "2025-01-01T00:00:00Z",
    "valid_to": "2025-12-31T23:59:59Z",
    "ttl_minutes": 15,
    "version": 1,
    "kb_type": "realtime",
    "customer_id": "...",
    "last_updated": "2025-01-10T08:00:00Z"
}
```

### Query Router — đã có skeleton trong `rag.py`

`rag.py` đã có `mode` parameter (`static` / `realtime` / `hybrid`) và `_valid_realtime_filter()`.
Việc còn lại là **tầng classify ở trên** — quyết định mode nào trước khi gọi `search()`.

```python
# Thêm vào services/query_router.py — chưa có file này
REALTIME_KEYWORDS = {
    "pricing":   ["giá", "bao nhiêu", "price", "cost", "phí"],
    "promotion": ["ưu đãi", "khuyến mãi", "giảm giá", "voucher", "discount"],
    "flash_sale":["flash sale", "sale sốc", "hôm nay sale"],
}
STATIC_KEYWORDS = ["thông số", "tính năng", "cấu hình", "hướng dẫn", "bảo hành"]

def route_query(question: str) -> tuple[str, list[str]]:
    """Returns: (mode, categories)"""
    q = question.lower()
    matched = []
    for cat, kws in REALTIME_KEYWORDS.items():
        if any(kw in q for kw in kws):
            matched.append(cat)

    has_static = any(kw in q for kw in STATIC_KEYWORDS)

    if matched and not has_static:
        return "realtime", matched
    elif has_static and not matched:
        return "static", []
    elif matched and has_static:
        return "hybrid", matched
    return "hybrid", []   # fallback
```

Tích hợp vào chat endpoint:

```python
from services.query_router import route_query
from services.rag import search

mode, categories = route_query(user_question)
results = search(collection, user_question, top_k=5, mode=mode, categories=categories or None)
```

### TTL Cache Layer — Redis

`rag.py` đã import và gọi `get_cached` / `set_cached` từ `services/cache.py`.
Cần kiểm tra `cache.py` đã implement TTL theo loại KB chưa:

```python
# services/cache.py — cần verify / bổ sung
TTL_BY_MODE = {
    "static":   3600,   # 1 giờ
    "realtime": 900,    # 15 phút — pricing
    "hybrid":   600,    # 10 phút
}

def set_cached(collection, query, mode, categories, result):
    ttl = TTL_BY_MODE.get(mode, 600)
    key = _cache_key(collection, query, mode, categories)
    redis.setex(key, ttl, json.dumps(result))
```

### Invalidation khi data thay đổi

`rag.py` đã gọi `invalidate_by_collection()` sau mỗi upsert/delete.
Bổ sung invalidation theo category khi realtime KB thay đổi:

```python
# Webhook endpoint — thêm vào kb.py
@router.post("/realtime/invalidate")
async def invalidate_realtime(data: dict, x_api_key: str = Header(...)):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)
    category = data.get("category")   # "pricing" | "promotion" | "flash_sale"
    invalidate_by_category(customer.qdrant_collection, category)
    return {"status": "invalidated", "category": category}
```

### Checklist TTL KB

- [x] Metadata schema đủ field (`source_id`, `valid_from`, `valid_to`, `kb_type`, `category`)
- [x] `upsert_by_source_id` — Strategy A cho bảng giá
- [x] `ingest_realtime` — ingest batch realtime chunks
- [x] `_valid_realtime_filter` — filter Qdrant theo thời gian hiện tại
- [x] `soft_delete_point` — Strategy B soft delete
- [x] `delete_by_source_id` + `/realtime/expire` endpoint
- [ ] `query_router.py` — classify intent trước khi search
- [ ] Tích hợp Query Router vào chat endpoint
- [ ] Verify `cache.py` TTL theo mode (pricing=15p, promotion=30p)
- [ ] `/realtime/invalidate` endpoint
- [ ] Test edge case: không có realtime chunk hợp lệ → bot phải báo "đang cập nhật"

---

## Phần 4 — Zero-Upload RAG (MCP Gateway)

### Kiến trúc tổng quan

```
[User query]
     │
     ▼
[Sensitivity Classifier]  ← chạy on-premise hoặc rule-based
     │
     ├── PUBLIC   → Cloud Vector Store (Qdrant hiện tại)
     ├── MIXED    → MCP Gateway (on-prem) + Cloud Vector Store
     └── SENSITIVE→ MCP Gateway only
                          │
                          ▼
                 [Context Assembler + PII Sanitizer]
                          │
                          ▼
                 [LLM — Cloud hoặc On-prem]
                          │
                          ▼
                 [PII De-masker → Response]
```

### Sensitivity Classifier

3 tầng, dùng tầng nào tùy resource:

```python
# services/sensitivity_classifier.py

class SensitivityLevel(IntEnum):
    PUBLIC = 0
    MIXED = 1
    SENSITIVE = 2

SENSITIVE_SIGNALS = {
    "identity":  ["cmnd", "cccd", "tên tôi", "tài khoản của tôi"],
    "financial": ["hợp đồng", "nợ", "công nợ", "thanh toán của tôi", "giá của tôi"],
    "order":     ["đơn hàng của tôi", "mã đơn", "trạng thái đơn"],
    "personal":  ["số điện thoại của tôi", "địa chỉ của tôi", "email của tôi"],
}

MIXED_SIGNALS = {
    "pricing":   ["giá", "bảng giá", "price"],
    "inventory": ["còn hàng", "tồn kho", "stock"],
    "promotion": ["flash sale", "ưu đãi hôm nay"],
}

def classify(question: str, user_context: dict = None) -> SensitivityLevel:
    q = question.lower()

    # Check SENSITIVE
    for signals in SENSITIVE_SIGNALS.values():
        if any(s in q for s in signals):
            return SensitivityLevel.SENSITIVE

    # User đã login với customer_id → ít nhất MIXED
    if user_context and user_context.get("customer_id"):
        for signals in MIXED_SIGNALS.values():
            if any(s in q for s in signals):
                return SensitivityLevel.MIXED
        # Có customer context nhưng câu hỏi chung → vẫn MIXED để an toàn
        return SensitivityLevel.MIXED

    # Check MIXED
    for signals in MIXED_SIGNALS.values():
        if any(s in q for s in signals):
            return SensitivityLevel.MIXED

    return SensitivityLevel.PUBLIC
```

### MCP Gateway

Chạy hoàn toàn trong hạ tầng doanh nghiệp. Chatbot cloud gọi vào qua HTTPS + mTLS.

```python
# mcp_gateway/main.py — FastAPI, deploy on-premise

TOOL_PERMISSIONS = {
    "get_product_price":          ["read:pricing"],
    "get_order_status":           ["read:orders"],
    "get_customer_tier":          ["read:customers"],
    "get_inventory":              ["read:inventory"],
    "get_promotion_for_customer": ["read:promotions", "read:customers"],
}

@app.post("/mcp/call")
async def call_tool(body: ToolRequest, token_payload: dict = Depends(verify_token)):
    tool = body.tool
    if tool not in TOOL_PERMISSIONS:
        raise HTTPException(404)

    required = TOOL_PERMISSIONS[tool]
    caller_scopes = token_payload.get("scopes", [])
    if not all(s in caller_scopes for s in required):
        raise HTTPException(403, "Insufficient scopes")

    audit_log(body.request_id, tool, body.params, token_payload.get("sub"))
    result = await dispatch_tool(tool, body.params)
    return ToolResponse(data=result, tool=tool, request_id=body.request_id)
```

Nguyên tắc thiết kế tool — mỗi tool chỉ SELECT đúng field whitelist:

```python
async def get_product_price(product_id: str) -> dict:
    row = await erp_db.query(
        "SELECT product_id, name, price, currency, updated_at FROM prices WHERE product_id = $1",
        product_id
    )
    return {"product_id": row["product_id"], "name": row["name"],
            "price": row["price"], "currency": row["currency"]}
    # Không trả: cost, margin, supplier, internal_notes
```

Security bắt buộc:
- mTLS giữa chatbot cloud và MCP Gateway
- JWT với scope-based permission
- Rate limiter: 60 req/phút per token
- Circuit breaker cho DB connection
- Audit log toàn bộ MCP call, lưu ≥ 90 ngày
- Firewall: chỉ whitelist IP của chatbot cloud, block outbound internet

### PII Sanitizer

Mask PII trước khi ghép context vào prompt LLM cloud. De-mask sau khi LLM trả về.

```python
# services/pii_sanitizer.py

PATTERNS = [
    ("PHONE",  r'(?:0|\+84|84)(?:[35789][0-9]{8})'),
    ("EMAIL",  r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'),
    ("CARD",   r'\b(?:\d{4}[ \-]?){3}\d{4}\b'),
    ("CCCD",   r'\b(?:CCCD|CMND|số)[:\s]+([0-9]{9,12})\b'),
    ("AMOUNT", r'\b([0-9]{1,3}(?:[.,][0-9]{3})*)\s*(?:VNĐ|VND|đồng|₫)\b'),
]

@dataclass
class SanitizerSession:
    mappings: dict[str, str] = field(default_factory=dict)
    counter: dict[str, int] = field(default_factory=dict)

    def add(self, pii_type: str, value: str) -> str:
        for ph, orig in self.mappings.items():
            if orig == value:
                return ph   # cùng giá trị → cùng placeholder
        idx = self.counter.get(pii_type, 0) + 1
        self.counter[pii_type] = idx
        ph = f"[{pii_type.upper()}_{idx:03d}]"
        self.mappings[ph] = value
        return ph

    def demask(self, text: str) -> str:
        for ph, orig in self.mappings.items():
            text = text.replace(ph, orig)
        return text
```

Mức mask theo Sensitivity Level:

```python
MASK_CONFIG = {
    SensitivityLevel.PUBLIC:    [],
    SensitivityLevel.MIXED:     ["PHONE", "EMAIL", "CARD"],
    SensitivityLevel.SENSITIVE: ["PHONE", "EMAIL", "CARD", "CCCD", "AMOUNT"],
    # Thêm NER (NAME, ADDRESS) nếu cần — chậm hơn ~50ms
}
```

### Full request lifecycle

```python
# chat endpoint — tích hợp 3 lớp

async def chat(question: str, user_context: dict, collection: str) -> str:
    session = SanitizerSession()

    # 1. Classify
    level = classify(question, user_context)

    # 2. Retrieve
    mcp_chunks, cloud_chunks = [], []
    if level in (MIXED, SENSITIVE):
        mcp_chunks = await mcp_client.call_tool(
            tool=select_tool(question, level),
            params=extract_params(question, user_context)
        )
    if level in (PUBLIC, MIXED):
        mode, cats = route_query(question)
        cloud_chunks = search(collection, question, mode=mode, categories=cats)

    # 3. Assemble + Sanitize
    all_chunks = rerank(mcp_chunks + cloud_chunks, question)
    if level != PUBLIC:
        all_chunks = sanitizer.mask_context_chunks(all_chunks, session)

    # 4. LLM
    context = "\n\n".join(c["text"] for c in all_chunks)
    if level == SENSITIVE:
        raw = await onprem_llm.generate(build_prompt(question, context))
    else:
        raw = await cloud_llm.generate(build_prompt(question, context))

    # 5. De-mask
    response = session.demask(raw)
    del session   # dispose ngay

    return response
```

### Checklist Zero-Upload RAG

- [ ] `services/sensitivity_classifier.py` — rule-based, test 50 câu mẫu
- [ ] `mcp_gateway/` — FastAPI app với tool definitions, JWT, audit log
- [ ] mTLS setup giữa chatbot và MCP Gateway
- [ ] Firewall rules — whitelist IP + block outbound
- [ ] `services/pii_sanitizer.py` — regex patterns, test với data thật
- [ ] Tích hợp 3 lớp vào chat endpoint
- [ ] Test: PII không bao giờ xuất hiện trong prompt gửi cloud LLM
- [ ] Test: MCP Gateway không trả field ngoài whitelist
- [ ] Test: `SanitizerSession` không leak giữa các request
- [ ] Security audit trước khi go-live với data thật

---

## Roadmap tổng thể

```
Tuần này — Embedding (1 ngày)
├── Đổi sang paraphrase-multilingual-MiniLM-L12-v2
├── Re-embed toàn bộ KB hiện có
└── Nâng score_threshold từ 0.2 lên 0.35

Tuần 1–2 — TTL KB hoàn thiện
├── Viết services/query_router.py
├── Tích hợp Query Router vào chat endpoint
├── Verify/fix TTL trong services/cache.py
├── Thêm /realtime/invalidate endpoint
└── Test edge case không có realtime chunk hợp lệ

Tuần 3 — KB Ingestion polish
├── Thêm skip re-ingest nếu file hash không đổi
└── Thêm source_page metadata cho PDF

Tuần 4–6 — Zero-Upload RAG (khi có doanh nghiệp cần)
├── Sensitivity Classifier
├── MCP Gateway on-premise
├── PII Sanitizer
└── Integration test toàn flow
```

---

## Ghi chú kỹ thuật

**Score threshold sau khi đổi embedding model:** Nâng từ `0.2` lên `0.35`–`0.4`. Threshold `0.2` hiện tại thấp bất thường — dấu hiệu model đang embed kém, không phải data kém.

**Re-embed bắt buộc sau khi đổi model:** Vector space của hai model khác nhau hoàn toàn. Không re-embed sẽ ra kết quả sai hoàn toàn.

**Sensitivity Classifier phải chạy on-premise:** Nếu chạy cloud, câu hỏi user đã leak ra trước khi được phân loại — mất hết ý nghĩa của Zero-Upload RAG.

**`SanitizerSession` dispose ngay sau request:** Mapping `[PHONE_001] → 0901234567` chỉ tồn tại trong memory suốt 1 request. Không cache, không lưu DB.

**MCP Gateway không cần outbound internet:** Block hoàn toàn. Nếu bị scan/exploit, attacker cũng không exfiltrate data ra ngoài được.
