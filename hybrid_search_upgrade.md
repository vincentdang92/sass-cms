# Nâng cấp RAG lên Hybrid Search (BM25 + Embedding + Contextual Retrieval)

> Dựa trên kỹ thuật Contextual Retrieval của Anthropic  
> Mục tiêu: giảm retrieval miss rate từ ~5.7% xuống ~1.9%

---

## Tổng quan kiến trúc

```
Ingestion pipeline (nâng cấp):
  Document
    → Chunk (RecursiveTextSplitter, overlap=100)
    → Generate context (Claude Haiku + prompt caching)
    → Contextualized chunk = [context prefix] + [original chunk]
    → Embed → Qdrant (dense vector)
    → BM25 index (sparse / lexical)

Query pipeline (nâng cấp):
  User query
    → Dense search  (Qdrant)   → top-20
    → BM25 search   (rank-bm25) → top-20
    → RRF merge                 → top-20 unified
    → Reranker (optional)       → top-5
    → LLM answer
```

**Kết quả theo Anthropic benchmark:**

| Phương pháp | Miss rate | Giảm so với baseline |
|---|---|---|
| Embedding only (baseline) | 5.70% | — |
| + Contextual Embeddings | 3.70% | -35% |
| + Contextual Embeddings + BM25 | 2.90% | -49% |
| + tất cả + Reranking | 1.90% | -67% |

---

## Cài đặt dependencies

```bash
pip install rank-bm25 anthropic qdrant-client langchain-text-splitters
# Reranker (optional nhưng recommended)
pip install sentence-transformers
```

---

## Phần 1 — Contextual chunk generation

### 1.1 Hàm tạo context cho từng chunk

Dùng Claude Haiku (rẻ nhất) + **prompt caching** để cache toàn bộ document — chỉ tính phí 1 lần dù có 100 chunk.

```python
import anthropic

client = anthropic.Anthropic()

CONTEXT_SYSTEM = (
    "Bạn là trợ lý giúp tạo context ngắn gọn cho các đoạn văn bản "
    "trong hệ thống RAG. Chỉ trả lời phần context, không giải thích thêm."
)

def generate_chunk_context(full_document: str, chunk: str) -> str:
    """
    Gọi Claude Haiku để tạo 1-2 câu context cho chunk.
    full_document được cache → chỉ tốn token 1 lần dù có nhiều chunk.
    """
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        system=CONTEXT_SYSTEM,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"<document>\n{full_document}\n</document>",
                    "cache_control": {"type": "ephemeral"},  # cache document
                },
                {
                    "type": "text",
                    "text": (
                        f"<chunk>\n{chunk}\n</chunk>\n\n"
                        "Viết 1-2 câu đặt chunk này vào ngữ cảnh của toàn bộ tài liệu. "
                        "Giúp việc tìm kiếm sau này chính xác hơn."
                    ),
                },
            ],
        }],
    )
    return response.content[0].text.strip()


def contextualize_chunks(full_text: str, chunks: list[str]) -> list[str]:
    """
    Contextualize toàn bộ danh sách chunk từ 1 document.
    Document được cache nên chỉ tính phí input 1 lần.
    """
    result = []
    for chunk in chunks:
        context = generate_chunk_context(full_text, chunk)
        # Prepend context vào chunk → embedding sẽ mang cả 2 thông tin
        result.append(f"{context}\n\n{chunk}")
    return result
```

### 1.2 Chi phí ước tính

```
Giả sử: document 8.000 token, chunk 800 token, context output 100 token

Không có caching:
  Mỗi chunk = 8.000 (doc) + 800 (chunk) + 100 (output) = 8.900 token
  100 chunk × 8.900 = 890.000 token → $0.089

Với prompt caching (claude-haiku):
  Lần 1: 8.000 token input (cache write) + 800 chunk + 100 output
  Lần 2-100: 8.000 token cache hit (rẻ hơn 90%) + 800 + 100
  → Tiết kiệm ~85% chi phí so với không cache
```

---

## Phần 2 — BM25 Index

### 2.1 Lớp BM25Store

```python
import json
import pickle
from pathlib import Path
from rank_bm25 import BM25Okapi


def tokenize_vi(text: str) -> list[str]:
    """
    Tokenize đơn giản cho tiếng Việt.
    Nếu cần chính xác hơn, dùng underthesea: pip install underthesea
    """
    import re
    text = text.lower()
    # Giữ lại chữ, số, dấu tiếng Việt
    tokens = re.findall(r'[a-záàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ0-9]+', text)
    return tokens


class BM25Store:
    """
    Lưu BM25 index song song với Qdrant.
    Key = qdrant point ID, value = document text.
    """

    def __init__(self):
        self.corpus: list[str] = []
        self.doc_ids: list[str] = []  # qdrant point IDs tương ứng
        self.bm25: BM25Okapi | None = None

    def add_documents(self, docs: list[dict]) -> None:
        """
        docs: [{"id": "qdrant-point-id", "content": "..."}]
        """
        for doc in docs:
            self.corpus.append(doc["content"])
            self.doc_ids.append(doc["id"])
        # Rebuild index
        tokenized = [tokenize_vi(text) for text in self.corpus]
        self.bm25 = BM25Okapi(tokenized)

    def search(self, query: str, top_k: int = 20) -> list[tuple[str, float]]:
        """Trả về [(doc_id, score), ...]"""
        if not self.bm25:
            return []
        tokens = tokenize_vi(query)
        scores = self.bm25.get_scores(tokens)
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
        return [(self.doc_ids[i], float(scores[i])) for i in top_indices]

    def save(self, path: str) -> None:
        with open(path, "wb") as f:
            pickle.dump({"corpus": self.corpus, "doc_ids": self.doc_ids}, f)

    def load(self, path: str) -> None:
        with open(path, "rb") as f:
            data = pickle.load(f)
        self.corpus = data["corpus"]
        self.doc_ids = data["doc_ids"]
        tokenized = [tokenize_vi(text) for text in self.corpus]
        self.bm25 = BM25Okapi(tokenized)
```

### 2.2 Lưu BM25 index theo collection

```python
import os

BM25_INDEX_DIR = "/data/bm25_indexes"  # hoặc S3, Redis, etc.

def get_bm25_store(collection: str) -> BM25Store:
    store = BM25Store()
    path = f"{BM25_INDEX_DIR}/{collection}.pkl"
    if os.path.exists(path):
        store.load(path)
    return store

def save_bm25_store(store: BM25Store, collection: str) -> None:
    os.makedirs(BM25_INDEX_DIR, exist_ok=True)
    store.save(f"{BM25_INDEX_DIR}/{collection}.pkl")
```

---

## Phần 3 — Hybrid Retriever (RRF)

### 3.1 Reciprocal Rank Fusion

```python
from qdrant_client import QdrantClient

def reciprocal_rank_fusion(
    rankings: list[list[tuple[str, float]]],
    k: int = 60,
    top_k: int = 20,
) -> list[tuple[str, float]]:
    """
    Merge nhiều ranked list thành 1 list duy nhất.
    k=60 là giá trị mặc định trong paper RRF gốc.

    rankings: [[("id1", score), ("id2", score), ...], ...]
    """
    rrf_scores: dict[str, float] = {}
    for ranked_list in rankings:
        for rank, (doc_id, _) in enumerate(ranked_list):
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)

    sorted_ids = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return sorted_ids[:top_k]


class HybridRetriever:
    def __init__(
        self,
        qdrant_client: QdrantClient,
        collection: str,
        embed_fn,           # hàm embed query → vector
        bm25_store: BM25Store,
        top_k: int = 20,
    ):
        self.qdrant = qdrant_client
        self.collection = collection
        self.embed = embed_fn
        self.bm25 = bm25_store
        self.top_k = top_k

    def search(self, query: str) -> list[dict]:
        # 1. Dense vector search
        query_vector = self.embed(query)
        qdrant_results = self.qdrant.search(
            collection_name=self.collection,
            query_vector=query_vector,
            limit=self.top_k,
        )
        dense_ranking = [(str(r.id), r.score) for r in qdrant_results]

        # 2. BM25 keyword search
        bm25_ranking = self.bm25.search(query, top_k=self.top_k)

        # 3. RRF merge
        merged = reciprocal_rank_fusion(
            [dense_ranking, bm25_ranking],
            top_k=self.top_k,
        )

        # 4. Fetch payload từ Qdrant cho các ID đã merge
        merged_ids = [doc_id for doc_id, _ in merged]
        points = self.qdrant.retrieve(
            collection_name=self.collection,
            ids=merged_ids,
            with_payload=True,
        )
        id_to_point = {str(p.id): p for p in points}

        return [
            {
                "id": doc_id,
                "rrf_score": score,
                "content": id_to_point[doc_id].payload.get("content", "") if doc_id in id_to_point else "",
                "metadata": id_to_point[doc_id].payload if doc_id in id_to_point else {},
            }
            for doc_id, score in merged
            if doc_id in id_to_point
        ]
```

---

## Phần 4 — Tích hợp vào `kb.py`

### 4.1 Cập nhật `process_kb_ingestion`

```python
# services/bm25_store.py  ← tạo file mới chứa BM25Store class

# routers/kb.py — thay thế hàm process_kb_ingestion

async def process_kb_ingestion(job_id: str, collection: str, files_data: list[dict]):
    db = SessionLocal()
    job = None
    try:
        job = db.query(KBJob).filter_by(id=job_id).first()
        if not job:
            return

        job.status = "processing"
        db.commit()

        # Load BM25 store hiện tại của collection này
        bm25_store = get_bm25_store(collection)
        new_bm25_docs = []
        total_uploaded = 0

        for data in files_data:
            filename = data["filename"]
            content = data["content"]

            # 1. Extract text
            text = extract_text(content, filename)

            # 2. Detect KB type
            kb_type = detect_kb_type(filename)

            # 3. Chunk (với overlap)
            chunks = chunk_text(text)
            job.total_chunks += len(chunks)
            db.commit()

            # 4. Contextualize (Anthropic Contextual Retrieval)
            # Bỏ qua nếu file nhỏ < 500 token hoặc kb_type = "pricing" (1 row = 1 doc)
            if kb_type != "pricing" and len(text.split()) > 500:
                contextualized = contextualize_chunks(text, chunks)
            else:
                contextualized = chunks  # pricing: không cần context

            # 5. Build docs cho Qdrant
            docs = []
            for i, c in enumerate(contextualized):
                point_id = str(uuid.uuid4())
                docs.append({
                    "id": point_id,
                    "content": c,
                    "metadata": {
                        "filename": filename,
                        "type": kb_type,
                        "customer_id": job.customer_id,
                        "chunk_index": i,
                        "total_chunks": len(chunks),
                        "original_chunk": chunks[i],  # giữ chunk gốc
                        "job_id": job_id,
                    },
                })
                # Chuẩn bị cho BM25 (dùng chunk gốc, không phải contextualized)
                new_bm25_docs.append({"id": point_id, "content": chunks[i]})

            # 6. Ingest vào Qdrant
            count = ingest(collection, docs)
            total_uploaded += count
            job.processed_chunks += count
            db.commit()

        # 7. Cập nhật BM25 index
        bm25_store.add_documents(new_bm25_docs)
        save_bm25_store(bm25_store, collection)

        job.status = "completed"
        db.commit()

    except Exception as e:
        if job:
            job.status = "failed"
            job.error_message = str(e)[:500]
            db.commit()
        logger.error("Ingestion failed | job=%s error=%s", job_id, str(e), exc_info=True)

    finally:
        db.close()


def detect_kb_type(filename: str) -> str:
    name_lower = filename.lower()
    if any(x in name_lower for x in ["price", "gia", "bảng giá", "pricing"]):
        return "pricing"
    elif any(x in name_lower for x in ["faq", "support"]):
        return "faq"
    elif any(x in name_lower for x in ["policy", "terms", "điều khoản"]):
        return "policy"
    return "general"
```

### 4.2 Cập nhật endpoint `/chat` (phía retrieval)

```python
# services/retriever.py  ← tạo file mới

from services.bm25_store import get_bm25_store, HybridRetriever

def get_hybrid_retriever(collection: str, qdrant_client, embed_fn) -> HybridRetriever:
    bm25_store = get_bm25_store(collection)
    return HybridRetriever(
        qdrant_client=qdrant_client,
        collection=collection,
        embed_fn=embed_fn,
        bm25_store=bm25_store,
        top_k=20,
    )

# Trong chat endpoint:
retriever = get_hybrid_retriever(customer.qdrant_collection, qdrant_client, embed_fn)
results = retriever.search(user_query)
context_chunks = [r["content"] for r in results[:5]]  # top-5 cho LLM
```

---

## Phần 5 — Reranker (optional, +18% thêm)

Nếu muốn đạt mức miss rate 1.9%, thêm reranker sau bước RRF:

```python
# pip install sentence-transformers
from sentence_transformers import CrossEncoder

# Dùng model đa ngôn ngữ, hỗ trợ tiếng Việt tốt
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
# Hoặc model tốt hơn cho tiếng Việt:
# reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")

def rerank(query: str, candidates: list[dict], top_k: int = 5) -> list[dict]:
    """
    candidates: list từ HybridRetriever.search()
    Trả về top_k kết quả sau khi rerank.
    """
    pairs = [(query, c["content"]) for c in candidates]
    scores = reranker.predict(pairs)

    for i, c in enumerate(candidates):
        c["rerank_score"] = float(scores[i])

    reranked = sorted(candidates, key=lambda x: x["rerank_score"], reverse=True)
    return reranked[:top_k]
```

---

## Phần 6 — Xử lý đặc biệt cho pricing / bảng giá

Với file CSV/XLSX chứa bảng giá, **không chunk** — mỗi row là 1 document:

```python
def extract_pricing_docs(file_bytes: bytes, filename: str, customer_id: str) -> list[dict]:
    """
    Mỗi row = 1 document, không cần contextualize.
    BM25 sẽ match chính xác tên sản phẩm, mã SKU.
    """
    import pandas as pd
    import io

    df = pd.read_csv(io.BytesIO(file_bytes)) if filename.endswith(".csv") \
        else pd.read_excel(io.BytesIO(file_bytes))

    docs = []
    for i, row in df.iterrows():
        row_text = ", ".join(
            f"{col}: {val}" for col, val in row.items()
            if str(val).strip() and str(val) != "nan"
        )
        if row_text.strip():
            docs.append({
                "id": str(uuid.uuid4()),
                "content": row_text,
                "metadata": {
                    "filename": filename,
                    "type": "pricing",
                    "customer_id": customer_id,
                    "row_index": i,
                },
            })
    return docs
```

---

## Checklist triển khai

```
Bước 1 — Setup (30 phút)
  [ ] pip install rank-bm25 anthropic sentence-transformers
  [ ] Tạo file services/bm25_store.py
  [ ] Tạo thư mục lưu BM25 index (/data/bm25_indexes hoặc S3)

Bước 2 — Ingestion (2-3 giờ)
  [ ] Thêm hàm generate_chunk_context() và contextualize_chunks()
  [ ] Cập nhật process_kb_ingestion() — thêm bước contextualize + BM25
  [ ] Test với 1 file nhỏ, kiểm tra BM25 index được tạo đúng

Bước 3 — Retrieval (1-2 giờ)
  [ ] Tạo HybridRetriever class
  [ ] Cập nhật chat endpoint dùng HybridRetriever thay vì Qdrant trực tiếp
  [ ] Test với query exact match (tên sản phẩm) và semantic query

Bước 4 — Reranker (1 giờ, optional)
  [ ] Thêm CrossEncoder reranker
  [ ] So sánh kết quả trước/sau rerank trên bộ test
```

---

## Lưu ý quan trọng

**Prompt caching tiết kiệm ~85% chi phí** — nhưng cache chỉ có hiệu lực khi `full_document` giống nhau. Nếu document thay đổi (re-upload), cache sẽ bị invalidate và tính phí lại từ đầu. Đây là lý do tại sao deduplication bằng file hash quan trọng.

**BM25 index cần rebuild khi xóa document** — khi dùng `/kb/realtime/expire`, nhớ xóa document khỏi BM25 store tương ứng. Nếu không, BM25 vẫn có thể trả về ID không còn tồn tại trong Qdrant.

**Reranker tốn latency** — CrossEncoder chạy inference cho mỗi (query, doc) pair. Với top-20 candidates × latency ~5ms/pair = ~100ms thêm. Dùng model nhỏ (MiniLM-L6) hoặc host riêng nếu cần production latency thấp.

**Tiếng Việt và BM25** — tokenizer mặc định (split by space) hoạt động được vì tiếng Việt là ngôn ngữ tách từ bằng dấu cách. Để chính xác hơn với từ ghép ("điện thoại", "bảng giá"), dùng `underthesea` để word segmentation trước khi index.
