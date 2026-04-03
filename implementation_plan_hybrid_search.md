# Hybrid Search Upgrade — Kế hoạch nâng cấp RAG

> **Mục tiêu:** Giảm retrieval miss rate từ ~5.7% (pure embedding) xuống ~1.9% (hybrid + reranker)  
> **Phương pháp:** Contextual Embeddings + BM25 + RRF Merge + CrossEncoder Reranker  
> **Nguồn tham chiếu:** [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval), [hybrid_search_upgrade.md](file:///d:/AI-WORKING/sass-cms/hybrid_search_upgrade.md)

---

## Baseline hiện tại

| Thành phần | Trạng thái |
|---|---|
| Embedding | `paraphrase-multilingual-MiniLM-L12-v2` (384 dims), local, tiếng Việt ổn |
| Search | **Pure dense vector search** — Qdrant `query_points`, `score_threshold=0.35` |
| BM25 / Lexical | ❌ Không có — miss hoàn toàn với exact-match (tên SP, SKU, mã code) |
| Contextual Chunking | ❌ Không có — chunk bị tách khỏi ngữ cảnh document |
| Reranker | ❌ Không có |
| Retrieval path | `rag_search.py` → [query_router.py](file:///d:/AI-WORKING/sass-cms/api/services/query_router.py) → `rag.search()` → Qdrant |

**Điểm yếu chính:** Khi khách hỏi tên sản phẩm chính xác, giá cụ thể hoặc SKU → pure vector search không match tốt → miss rate cao.

---

## Kết quả kỳ vọng

| Phương pháp | Miss rate | Giảm |
|---|---|---|
| Embedding only (hiện tại) | 5.70% | — |
| + Contextual Embeddings | 3.70% | -35% |
| + BM25 Hybrid | 2.90% | -49% |
| + Reranker | **1.90%** | **-67%** |

---

## 🔴 Đánh giá ảnh hưởng hệ thống (System Impact)

### Các file/component bị ảnh hưởng

| Thành phần | Mức độ thay đổi | Ghi chú |
|---|---|---|
| [api/services/rag.py](file:///d:/AI-WORKING/sass-cms/api/services/rag.py) | **Cao** — refactor hàm [search()](file:///d:/AI-WORKING/sass-cms/api/services/rag.py#147-201) | Thêm hybrid path, vẫn giữ backward compat |
| [api/routers/kb.py](file:///d:/AI-WORKING/sass-cms/api/routers/kb.py) | **Cao** — [process_kb_ingestion()](file:///d:/AI-WORKING/sass-cms/api/routers/kb.py#192-412) | Thêm BM25 index build + contextualize step |
| `api/services/bm25_store.py` | **Mới** — tạo mới | BM25Store class, tokenizer tiếng Việt |
| `api/services/contextual.py` | **Mới** — tạo mới | Claude Haiku prompt caching wrapper |
| `app/api/chat/route.ts` | **Thấp** — chỉ thêm param | Chuyển call sang hybrid search endpoint |
| [api/services/cache.py](file:///d:/AI-WORKING/sass-cms/api/services/cache.py) | **Không đổi** | Cache key vẫn dùng [(collection, query, mode)](file:///d:/AI-WORKING/sass-cms/chatbot-ui/app/admin/tenants/%5BtenantId%5D/page.tsx#15-16) |
| [api/services/query_router.py](file:///d:/AI-WORKING/sass-cms/api/services/query_router.py) | **Không đổi** | Vẫn route đúng, harvest category |
| [api/main.py](file:///d:/AI-WORKING/sass-cms/api/main.py) | **Không đổi** | Router đã include |
| Docker / `docker-compose.yml` | **Thấp** | Thêm volume mount `/data/bm25_indexes` |
| `.env` | **Thấp** | Thêm `ANTHROPIC_API_KEY` (optional) |

### Rủi ro & Giảm thiểu

> [!WARNING]
> **BM25 index không đồng bộ với Qdrant** — Nếu xóa KB qua `/admin/customers/{id}/kb` hoặc `/kb/realtime/expire`, Qdrant mất chunk nhưng BM25 index vẫn giữ ID cũ → BM25 trả về ghost ID → `qdrant.retrieve()` không tìm thấy → **content rỗng nhưng không crash**.  
> **Mitigiation:** Thêm `bm25_store.remove_by_ids()` vào [delete_by_filename()](file:///d:/AI-WORKING/sass-cms/api/services/rag.py#311-326) và xóa file `.pkl` khi clearKB.

> [!IMPORTANT]
> **Latency tăng** — Contextual chunking gọi Claude Haiku per-chunk trong ingestion → thêm 1-3s/file. Reranker inference thêm ~100ms/query.  
> **Mitigiation:** Contextual generation là **async, background task** → không ảnh hưởng response time upload. Reranker có thể cắt xuống top-10 → ~50ms.

> [!CAUTION]
> **Chi phí API** — Claude Haiku ~$0.0001/document chunk. File 10MB PDF với 200 chunk ≈ $0.02/upload (với prompt caching). **Không ảnh hưởng chat cost, chỉ ingestion.**  
> **Mitigiation:** Skip contextualize với: file nhỏ <500 words, file pricing/tabular, file đã dedup (hash match).

> [!NOTE]
> **Disk space BM25 index** — mỗi collection `.pkl` ~vài MB tùy corpus size. Với 100 tenants × avg 5MB = 500MB. Cần volume mount hay bind mount ra host.

---

## Proposed Changes

---

### Phase 1 — BM25 Core (Không cần Claude API — triển khai trước)

#### [NEW] [bm25_store.py](file:///d:/AI-WORKING/sass-cms/api/services/bm25_store.py)

```python
# BM25Store class với tokenizer tiếng Việt
# - tokenize_vi(): regex-based, giữ dấu tiếng Việt
# - add_documents(docs): add và rebuild index
# - search(query, top_k): trả về [(id, score)]
# - remove_by_ids(ids): sync khi xóa KB
# - save/load: pickle per-collection file
```

Path lưu: `/data/bm25_indexes/{collection}.pkl` (mount volume trong Docker)

---

#### [MODIFY] [rag.py](file:///d:/AI-WORKING/sass-cms/api/services/rag.py)

Thêm `search_hybrid()` song song với [search()](file:///d:/AI-WORKING/sass-cms/api/services/rag.py#147-201) hiện tại:

```python
def search_hybrid(collection, query, top_k=5, mode="hybrid", categories=None):
    # 1. Dense: qdrant.query_points (top_k=20, threshold thấp hơn: 0.25)
    # 2. BM25: bm25_store.search(query, top_k=20)
    # 3. RRF merge → top_k=20
    # 4. Rerank (nếu có model) → top_k
    # 5. Apply kb_type filter (static/realtime) trên merged results
    # 6. Cache kết quả
```

> Giữ [search()](file:///d:/AI-WORKING/sass-cms/api/services/rag.py#147-201) cũ không đổi — `search_hybrid()` là opt-in. Dễ rollback.

---

#### [MODIFY] [kb.py](file:///d:/AI-WORKING/sass-cms/api/routers/kb.py)

Trong [process_kb_ingestion()](file:///d:/AI-WORKING/sass-cms/api/routers/kb.py#192-412): sau khi ingest Qdrant, thêm:
```python
# Cập nhật BM25 index với các point IDs vừa ingest
bm25_store = get_bm25_store(collection)
bm25_store.add_documents([{"id": pt_id, "content": original_chunk}])
save_bm25_store(bm25_store, collection)
```

Cũng cập nhật [delete_by_filename()](file:///d:/AI-WORKING/sass-cms/api/services/rag.py#311-326) và clear KB → gọi `bm25_store.remove_by_ids()` hoặc rebuild từ Qdrant scroll.

---

### Phase 2 — Contextual Chunks (Cần Claude API key)

#### [NEW] [contextual.py](file:///d:/AI-WORKING/sass-cms/api/services/contextual.py)

```python
# generate_chunk_context(full_document, chunk) → str
# contextualize_chunks(full_text, chunks) → list[str]
# Dùng Claude Haiku + prompt caching (ephemeral cache)
# Fallback: nếu không có ANTHROPIC_API_KEY → return chunks gốc
```

**Graceful fallback:** Nếu không có `ANTHROPIC_API_KEY` hoặc Claude call fail → dùng chunk gốc, ingestion vẫn chạy bình thường.

---

#### [MODIFY] [kb.py](file:///d:/AI-WORKING/sass-cms/api/routers/kb.py)

Trong [process_kb_ingestion()](file:///d:/AI-WORKING/sass-cms/api/routers/kb.py#192-412), sau bước chunking:
```python
# Skip contextual cho: pricing, tabular, file < 500 words, hoặc không có API key
if should_contextualize(kb_type, text):
    chunks = contextualize_chunks(full_text, chunks)
```

---

### Phase 3 — Reranker (Optional, cần GPU hoặc chạy chậm hơn)

#### [NEW] [reranker.py](file:///d:/AI-WORKING/sass-cms/api/services/reranker.py)

```python
# CrossEncoder("BAAI/bge-reranker-v2-m3")  ← tốt cho tiếng Việt
# rerank(query, candidates, top_k=5) → list[dict]
# Lazy load model, singleton instance
# Fallback: nếu reranker không available → return RRF results trực tiếp
```

---

### Integrate vào `rag_search.py`

#### [MODIFY] [rag_search.py](file:///d:/AI-WORKING/sass-cms/api/routers/rag_search.py)

Thêm query param `?hybrid=true` (default `true` sau khi deploy ổn):
```python
@router.get("/search")
def rag_search(q: str, hybrid: bool = False, ...):
    if hybrid:
        results = search_hybrid(collection, q, ...)
    else:
        results = search(collection, q, ...)  # backward compat
```

---

## Migration Strategy

### Dữ liệu hiện có (Existing Tenants)

> [!IMPORTANT]
> BM25 index chỉ có với **file upload MỚI** sau khi deploy. Tenant cũ không có BM25 → RRF chỉ dùng dense search (bằng hiện tại).  
> **Không cần migration script** — BM25 tự build dần theo time hay có thể trigger rebuild từ Qdrant scroll.

Thêm script **`scripts/build_bm25_indexes.py`** để rebuild BM25 từ Qdrant data sẵn có (chạy offline, không ảnh hưởng production):

```bash
python scripts/build_bm25_indexes.py --collection kb_tenant_xyz
```

---

## Verification Plan

### Phase 1 (BM25) — Test ngay sau khi deploy

1. Upload 1 file CSV bảng giá cho 1 test tenant
2. Query: *"iPhone 16 Pro"* → kiểm tra BM25 trả về đúng row
3. Query: *"Điện thoại flagship mới nhất"* → Dense search vẫn hoạt động
4. Xóa file → kiểm tra BM25 index không còn ghost IDs
5. Kiểm tra BM25 `.pkl` được tạo trong `/data/bm25_indexes/`

### Phase 2 (Contextual) — Test với file policy/general

1. Upload file tài liệu dài (>500 words)
2. Kiểm tra Claude API được gọi (log `[Contextual]`)
3. Upload cùng file hash → kiểm tra **skip** contextual (dedup hoạt động)
4. Kiểm tra fallback khi không có `ANTHROPIC_API_KEY`

### Phase 3 (Reranker) — A/B test

1. So sánh kết quả top-5 hybrid vs hybrid+reranker với 10 câu hỏi test
2. Đo latency: đảm bảo `<200ms` thêm

---

## Thứ tự triển khai đề nghị

```
Phase 1: BM25 (0 external deps, 0 API cost)
  → Deploy → test 1 tuần → đánh giá improvement
      ↓
Phase 2: Contextual Embeddings (cần ANTHROPIC_API_KEY)  
  → Thêm vào ingestion → test với new uploads
      ↓
Phase 3: Reranker (cần resource thêm)
  → Optional, thêm vào nếu Phase 1+2 chưa đủ
```

> **Khuyến nghị:** Phase 1 thôi đã giảm Miss rate ~49% và không có thêm chi phí API. Nên triển khai Phase 1 trước, đánh giá thực tế trên production trước khi quyết định Phase 2.
