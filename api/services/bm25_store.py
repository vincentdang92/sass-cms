"""
BM25 Store — Lexical search index per-tenant collection.

Lưu BM25 index (rank-bm25) theo từng Qdrant collection vào /data/bm25_indexes/{collection}.pkl.
Được dùng kết hợp với dense vector search để tạo Hybrid Search theo RRF (Reciprocal Rank Fusion).
"""
import re
import os
import pickle
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Thư mục lưu BM25 index trên disk — mount volume trong docker-compose
BM25_INDEX_DIR = os.getenv("BM25_INDEX_DIR", "/data/bm25_indexes")


# ── Vietnamese Tokenizer ───────────────────────────────────────────────────

def tokenize_vi(text: str) -> list[str]:
    """
    Tokenize đơn giản cho tiếng Việt.
    Regex giữ lại chữ (kể cả dấu tiếng Việt), số và ký tự từng cụm.
    Nếu cần chính xác hơn với từ ghép: pip install underthesea.
    """
    text = text.lower()
    tokens = re.findall(
        r'[a-záàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ0-9]+',
        text
    )
    return [t for t in tokens if len(t) > 1]  # Bỏ ký tự 1 chữ không có nghĩa


# ── RRF Helper ─────────────────────────────────────────────────────────────

def reciprocal_rank_fusion(
    rankings: list[list[tuple[str, float]]],
    k: int = 60,
    top_k: int = 20,
) -> list[tuple[str, float]]:
    """
    Merge nhiều ranked list bằng Reciprocal Rank Fusion.
    k=60 là giá trị mặc định trong paper RRF gốc.

    rankings: [[(doc_id, score), ...], ...]
    Returns: [(doc_id, rrf_score), ...] sorted descending
    """
    rrf_scores: dict[str, float] = {}
    for ranked_list in rankings:
        for rank, (doc_id, _) in enumerate(ranked_list):
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)

    sorted_ids = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return sorted_ids[:top_k]


# ── BM25Store ──────────────────────────────────────────────────────────────

class BM25Store:
    """
    Lưu BM25 index song song với Qdrant.
    Key = qdrant point ID, value = document text.

    Cách dùng:
        store = get_bm25_store("kb_tenant_abc")
        store.add_documents([{"id": "uuid-...", "content": "nội dung chunk"}])
        save_bm25_store(store, "kb_tenant_abc")
        results = store.search("tên sản phẩm", top_k=20)
    """

    def __init__(self):
        self.corpus: list[str] = []
        self.doc_ids: list[str] = []
        self._bm25 = None  # lazy build

    def _rebuild(self):
        """Rebuild BM25 index từ corpus hiện tại."""
        try:
            from rank_bm25 import BM25Okapi
            if self.corpus:
                tokenized = [tokenize_vi(text) for text in self.corpus]
                self._bm25 = BM25Okapi(tokenized)
            else:
                self._bm25 = None
        except ImportError:
            logger.warning("[BM25] rank-bm25 chưa được cài — pip install rank-bm25")
            self._bm25 = None

    def add_documents(self, docs: list[dict]) -> None:
        """
        Thêm documents vào store và rebuild index.
        docs: [{"id": "qdrant-point-id", "content": "..."}]
        """
        for doc in docs:
            doc_id = doc["id"]
            content = doc.get("content", "")
            if not content.strip():
                continue
            # Tránh duplicate
            if doc_id not in self.doc_ids:
                self.corpus.append(content)
                self.doc_ids.append(doc_id)
        self._rebuild()

    def remove_by_ids(self, ids: list[str]) -> int:
        """
        Xóa documents khỏi store theo Qdrant point ID list.
        Cần gọi sau khi delete KB để tránh ghost IDs.
        Returns: số doc đã xóa.
        """
        ids_set = set(ids)
        new_corpus = []
        new_ids = []
        removed = 0
        for i, did in enumerate(self.doc_ids):
            if did in ids_set:
                removed += 1
            else:
                new_corpus.append(self.corpus[i])
                new_ids.append(did)
        self.corpus = new_corpus
        self.doc_ids = new_ids
        if removed > 0:
            self._rebuild()
        return removed

    def search(self, query: str, top_k: int = 20) -> list[tuple[str, float]]:
        """
        BM25 lexical search.
        Returns: [(doc_id, score), ...] sorted by score desc
        """
        if not self._bm25:
            return []
        tokens = tokenize_vi(query)
        if not tokens:
            return []
        try:
            scores = self._bm25.get_scores(tokens)
            # Chỉ trả về docs có score > 0
            indexed = [(self.doc_ids[i], float(scores[i])) for i in range(len(scores)) if scores[i] > 0]
            indexed.sort(key=lambda x: x[1], reverse=True)
            return indexed[:top_k]
        except Exception as e:
            logger.error("[BM25] search error: %s", e)
            return []

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump({"corpus": self.corpus, "doc_ids": self.doc_ids}, f)

    def load(self, path: str) -> None:
        with open(path, "rb") as f:
            data = pickle.load(f)
        self.corpus = data.get("corpus", [])
        self.doc_ids = data.get("doc_ids", [])
        self._rebuild()

    def __len__(self) -> int:
        return len(self.doc_ids)


# ── Persistence Helpers ────────────────────────────────────────────────────

def _index_path(collection: str) -> str:
    return os.path.join(BM25_INDEX_DIR, f"{collection}.pkl")


def get_bm25_store(collection: str) -> BM25Store:
    """Load BM25 store từ disk nếu có, ngược lại trả về store rỗng."""
    store = BM25Store()
    path = _index_path(collection)
    if os.path.exists(path):
        try:
            store.load(path)
            logger.debug("[BM25] Loaded store for collection=%s docs=%d", collection, len(store))
        except Exception as e:
            logger.warning("[BM25] Failed to load store for %s: %s — returning empty", collection, e)
    return store


def save_bm25_store(store: BM25Store, collection: str) -> None:
    """Lưu BM25 store ra disk."""
    try:
        path = _index_path(collection)
        store.save(path)
        logger.debug("[BM25] Saved store for collection=%s docs=%d", collection, len(store))
    except Exception as e:
        logger.error("[BM25] Failed to save store for %s: %s", collection, e)


def delete_bm25_store(collection: str) -> None:
    """Xóa toàn bộ BM25 index của 1 collection (khi clear KB)."""
    path = _index_path(collection)
    if os.path.exists(path):
        try:
            os.unlink(path)
            logger.info("[BM25] Deleted store for collection=%s", collection)
        except Exception as e:
            logger.warning("[BM25] Failed to delete store for %s: %s", collection, e)
