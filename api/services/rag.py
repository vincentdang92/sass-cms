from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue, MatchAny, Range, FilterSelector, IsNullCondition, PayloadField, DatetimeRange
)
from sentence_transformers import SentenceTransformer
from datetime import datetime, timezone
import os, uuid, logging
from services.cache import get_cached, set_cached, invalidate_by_collection
from services.bm25_store import (
    get_bm25_store, save_bm25_store, delete_bm25_store,
    reciprocal_rank_fusion, BM25Store
)

logger = logging.getLogger(__name__)

qdrant = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))

# Multilingual embedding model — free, tiếng việt tốt, 384 dims
_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
VECTOR_SIZE = 384


# ── Helpers ────────────────────────────────────────────────
def ensure_collection(name: str):
    existing = [c.name for c in qdrant.get_collections().collections]
    if name not in existing:
        qdrant.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE)
        )


def embed(text: str) -> list[float]:
    """Tạo embedding vector bằng sentence-transformers (local, free)"""
    return _model.encode(text[:2000]).tolist()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Ingest các loại KB ─────────────────────────────────────

def ingest(collection: str, chunks: list[dict]) -> int:
    """Ingest static KB — không có TTL.
    chunks = [{"content": "...", "metadata": {...}}]
    """
    ensure_collection(collection)
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embed(c["content"]),
            payload={
                "content": c["content"],
                "kb_type": "static",   # Đánh dấu static cho Query Router
                **c.get("metadata", {})
            }
        )
        for c in chunks
    ]
    qdrant.upsert(collection_name=collection, points=points)
    invalidate_by_collection(collection)
    return len(points)


def ingest_with_ids(collection: str, chunks: list[dict]) -> list[str]:
    """Ingest static KB — như ingest() nhưng trả về list[point_id] để BM25 tracking."""
    ensure_collection(collection)
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embed(c["content"]),
            payload={
                "content": c["content"],
                "kb_type": "static",
                **c.get("metadata", {})
            }
        )
        for c in chunks
    ]
    qdrant.upsert(collection_name=collection, points=points)
    invalidate_by_collection(collection)
    return [str(p.id) for p in points]


def upsert_by_source_id(collection: str, source_id: str, content: str, metadata: dict) -> str:
    """Upsert (dedup) 1 chunk theo source_id — dùng cho bảng giá, realtime KB.
    Nếu đã tồn tại chunk cùng source_id sẽ cập nhật lại, không tạo mới.
    Returns: point_id đã upsert.
    """
    ensure_collection(collection)

    # Tìm chunk cũ cùng source_id
    existing_id = None
    try:
        results = qdrant.scroll(
            collection_name=collection,
            scroll_filter=Filter(
                must=[FieldCondition(key="source_id", match=MatchValue(value=source_id))]
            ),
            limit=1
        )
        if results[0]:
            existing_id = str(results[0][0].id)
    except Exception:
        pass

    point_id = existing_id or str(uuid.uuid4())
    payload = {
        "content": content,
        "kb_type": "realtime",       # Đánh dấu realtime cho Query Router
        "source_id": source_id,
        "last_updated": _now_iso(),
        **metadata
    }
    qdrant.upsert(
        collection_name=collection,
        points=[PointStruct(id=point_id, vector=embed(content), payload=payload)]
    )
    invalidate_by_collection(collection)
    return point_id


def ingest_realtime(collection: str, chunks: list[dict]) -> int:
    """Ingest nhiều realtime chunk cùng lúc (flash sale, campaign).
    Mỗi chunk phải có source_id trong metadata để dedup.
    chunks = [{"content": "...", "metadata": {"source_id": "...", "valid_from": "...", "valid_to": "...", ...}}]
    """
    count = 0
    for c in chunks:
        meta = c.get("metadata", {})
        src_id = meta.get("source_id") or str(uuid.uuid4())
        upsert_by_source_id(collection, src_id, c["content"], meta)
        count += 1
    return count


# ── Search ─────────────────────────────────────────────────

def _valid_realtime_filter(categories: list[str] | None = None) -> Filter:
    """Tạo filter Qdrant cho realtime chunk còn hiệu lực theo thời gian hiện tại."""
    now = _now_iso()
    must = [
        FieldCondition(key="kb_type", match=MatchValue(value="realtime")),
    ]
    if categories:
        must.append(FieldCondition(key="category", match=MatchAny(any=categories)))

    # valid_from <= now OR valid_from is null (missing)
    must.append(
        Filter(
            should=[
                FieldCondition(key="valid_from", range=DatetimeRange(lte=now)),
                IsNullCondition(is_null=PayloadField(key="valid_from"))
            ]
        )
    )

    # valid_to >= now OR valid_to is null (missing)
    must.append(
        Filter(
            should=[
                FieldCondition(key="valid_to", range=DatetimeRange(gte=now)),
                IsNullCondition(is_null=PayloadField(key="valid_to"))
            ]
        )
    )

    return Filter(must=must)


def search(collection: str, query: str, top_k: int = 5, mode: str = "hybrid", categories: list[str] | None = None, return_dicts: bool = False) -> list:
    """Search KB với Query Router mode và Redis Cache.
    mode = 'static' | 'realtime' | 'hybrid'
    """
    try:
        # 1. Thử lấy từ cache trước
        cache_key_suffix = "_dicts" if return_dicts else ""
        cached = get_cached(collection, query, mode + cache_key_suffix, categories)
        if cached is not None:
            return cached

        now = _now_iso()

        if mode == "static":
            qfilter = Filter(must=[FieldCondition(key="kb_type", match=MatchValue(value="static"))])
        elif mode == "realtime":
            qfilter = _valid_realtime_filter(categories)
        else:
            # hybrid: static + realtime còn hiệu lực
            qfilter = Filter(
                should=[
                    Filter(must=[FieldCondition(key="kb_type", match=MatchValue(value="static"))]),
                    _valid_realtime_filter(categories)
                ]
            )

        results = qdrant.query_points(
            collection_name=collection,
            query=embed(query),
            query_filter=qfilter,
            limit=top_k,
            score_threshold=0.35  # Tăng threshold: model multilingual score cao và sát hơn
        ).points
        
        if return_dicts:
            final_results = [{
                "id": str(r.id),
                "score": float(r.score),
                "content": r.payload.get("content", ""),
                "type": r.payload.get("type", ""),
                "kb_type": r.payload.get("kb_type", "")
            } for r in results]
        else:
            final_results = [r.payload.get("content", "") for r in results]
            
        print(f"[RAG] collection={collection} query='{query[:60]}' hits={len(final_results)}")
        
        # 2. Lưu vào cache
        set_cached(collection, query, mode + cache_key_suffix, categories, final_results)
        
        return final_results

    except Exception as e:
        print(f"[RAG search error] {e}")
        # Fallback: search không filter nếu lỗi (đảm bảo bot không chết)
        try:
            results = qdrant.query_points(
                collection_name=collection,
                query=embed(query),
                limit=top_k,
                score_threshold=0.3  # Threshold dự phòng
            ).points
            if return_dicts:
                return [{
                    "id": str(r.id), "score": float(r.score), 
                    "content": r.payload.get("content", ""), 
                    "type": r.payload.get("type", ""), 
                    "kb_type": r.payload.get("kb_type", "")
                } for r in results]
            return [r.payload.get("content", "") for r in results]
        except Exception:
            return []


def search_hybrid(
    collection: str,
    query: str,
    top_k: int = 5,
    mode: str = "hybrid",
    categories: list[str] | None = None,
    return_dicts: bool = False
) -> list:
    """
    Hybrid Search = Dense (Qdrant) + BM25 lexical merged bằng RRF.
    
    Nếu BM25 store trống (collection mới) → fallback về pure dense search.
    mode = 'static' | 'realtime' | 'hybrid'
    """
    try:
        cache_key_suffix = "_dicts" if return_dicts else ""
        cached = get_cached(collection, query, f"hybrid_{mode}" + cache_key_suffix, categories)
        if cached is not None:
            return cached

        # ── 1. Dense search — threshold thấp hơn để pool lớn hơn cho RRF ───
        if mode == "static":
            qfilter = Filter(must=[FieldCondition(key="kb_type", match=MatchValue(value="static"))])
        elif mode == "realtime":
            qfilter = _valid_realtime_filter(categories)
        else:
            qfilter = Filter(
                should=[
                    Filter(must=[FieldCondition(key="kb_type", match=MatchValue(value="static"))]),
                    _valid_realtime_filter(categories)
                ]
            )

        POOL = max(top_k * 4, 20)  # Lấy pool lớn để RRF có đủ candidates
        dense_hits = qdrant.query_points(
            collection_name=collection,
            query=embed(query),
            query_filter=qfilter,
            limit=POOL,
            score_threshold=0.25,  # Thấp hơn 0.35 vì RRF sẽ rerank lại
        ).points
        dense_ranking = [(str(r.id), r.score) for r in dense_hits]

        logger.debug(
            "[Hybrid] dense hits=%d collection=%s query=%s",
            len(dense_hits), collection, query[:50]
        )

        # ── 2. BM25 lexical search ───────────────────────────────────────
        bm25_store = get_bm25_store(collection)
        bm25_ranking = bm25_store.search(query, top_k=POOL)

        logger.debug(
            "[Hybrid] bm25 hits=%d store_size=%d",
            len(bm25_ranking), len(bm25_store)
        )

        # ── 3. RRF merge ─────────────────────────────────────────────────
        if bm25_ranking:
            merged = reciprocal_rank_fusion([dense_ranking, bm25_ranking], top_k=POOL)
        else:
            # BM25 trống → dùng dense only (backward compat với tenant cũ)
            merged = dense_ranking[:POOL]
            logger.debug("[Hybrid] BM25 empty, using dense-only for collection=%s", collection)

        # ── 4. Fetch payload từ Qdrant cho merged IDs ────────────────────
        merged_ids = [doc_id for doc_id, _ in merged]
        if not merged_ids:
            set_cached(collection, query, f"hybrid_{mode}" + cache_key_suffix, categories, [])
            return []

        points = qdrant.retrieve(
            collection_name=collection,
            ids=merged_ids,
            with_payload=True,
        )
        id_to_payload = {str(p.id): p.payload for p in points}

        # ── 5. Build kết quả cuối — giữ thứ tự RRF ──────────────────────
        results = []
        for doc_id, score in merged:
            payload = id_to_payload.get(doc_id)
            if payload and payload.get("content"):
                if return_dicts:
                    results.append({
                        "id": str(doc_id),
                        "score": float(score),
                        "content": payload.get("content", ""),
                        "type": payload.get("type", ""),
                        "kb_type": payload.get("kb_type", "")
                    })
                else:
                    results.append(payload["content"])
            if len(results) >= top_k:
                break

        logger.info(
            "[Hybrid] collection=%s query=%s mode=%s dense=%d bm25=%d final=%d",
            collection, query[:60], mode, len(dense_hits), len(bm25_ranking), len(results)
        )

        set_cached(collection, query, f"hybrid_{mode}" + cache_key_suffix, categories, results)
        return results

    except Exception as e:
        logger.error("[Hybrid search error] %s", e, exc_info=True)
        # Fallback về pure dense search
        return search(collection, query, top_k=top_k, mode=mode, categories=categories, return_dicts=return_dicts)


def search_with_scores(collection: str, query: str, top_k: int = 10) -> list[dict]:
    """Semantic search trả về chunks kèm điểm liên quan và metadata, dùng cho admin KB search"""
    try:
        results = qdrant.query_points(
            collection_name=collection,
            query=embed(query),
            limit=top_k,
            score_threshold=0.2
        ).points
        return [
            {
                "id": str(r.id),
                "score": round(r.score, 4),
                "content": r.payload.get("content", ""),
                "filename": r.payload.get("filename", ""),
                "type": r.payload.get("type", ""),
                "kb_type": r.payload.get("kb_type", "static"),
                "category": r.payload.get("category", ""),
                "valid_from": r.payload.get("valid_from"),
                "valid_to": r.payload.get("valid_to"),
            }
            for r in results
        ]
    except Exception as e:
        print(f"[RAG search_with_scores error] {e}")
        return []


# ── Collection management ──────────────────────────────────

def delete_collection(collection: str):
    qdrant.delete_collection(collection)
    invalidate_by_collection(collection)
    delete_bm25_store(collection)  # Sync: xóa BM25 index khi xóa toàn bộ collection


def list_points(collection: str, limit: int = 20, offset: int = 0, kb_type: str = None) -> tuple[list[dict], int]:
    """Liệt kê documents trong KB với phân trang"""
    try:
        q_filter = None
        if kb_type:
            q_filter = Filter(must=[FieldCondition(key="kb_type", match=MatchValue(value=kb_type))])
            
        result, _next_offset = qdrant.scroll(
            collection_name=collection,
            scroll_filter=q_filter,
            limit=limit,
            offset=offset,
            with_payload=True,
            with_vectors=False
        )
        
        total = qdrant.count(
            collection_name=collection,
            count_filter=q_filter,
            exact=True
        ).count
        
        return [{"id": str(p.id), **p.payload} for p in result], total
    except Exception as e:
        print(f"[RAG list_points error] {e}")
        return [], 0


def update_point(collection: str, point_id: str, content: str):
    """Cập nhật nội dung của 1 chunk (point)"""
    ensure_collection(collection)
    try:
        results = qdrant.retrieve(collection_name=collection, ids=[point_id])
        old_payload = results[0].payload if results else {}
    except Exception:
        old_payload = {}

    old_payload["content"] = content
    old_payload["last_updated"] = _now_iso()
    pt = PointStruct(id=point_id, vector=embed(content), payload=old_payload)
    qdrant.upsert(collection_name=collection, points=[pt])
    invalidate_by_collection(collection)
    return True


def delete_point(collection: str, point_id: str):
    """Xóa 1 chunk"""
    try:
        qdrant.delete(collection_name=collection, points_selector=[point_id])
        invalidate_by_collection(collection)
    except Exception:
        pass
    return True


def soft_delete_point(collection: str, point_id: str):
    """Soft delete — set valid_to = now(), chunk vẫn còn nhưng bị filter ra khi search"""
    try:
        results = qdrant.retrieve(collection_name=collection, ids=[point_id])
        if results:
            payload = results[0].payload or {}
            payload["valid_to"] = _now_iso()
            payload["last_updated"] = _now_iso()
            qdrant.upsert(
                collection_name=collection,
                points=[PointStruct(id=point_id, vector=results[0].vector or embed(payload.get("content", "")), payload=payload)]
            )
            invalidate_by_collection(collection)
    except Exception:
        pass
    return True


def delete_by_filename(collection: str, filename: str):
    """Xóa toàn bộ chunk của một file — sync BM25 index."""
    try:
        # Thu thập IDs trước khi xóa để sync BM25
        try:
            scroll_result, _ = qdrant.scroll(
                collection_name=collection,
                scroll_filter=Filter(
                    must=[FieldCondition(key="filename", match=MatchValue(value=filename))]
                ),
                limit=10000,
                with_vectors=False,
            )
            ids_to_remove = [str(p.id) for p in scroll_result]
        except Exception:
            ids_to_remove = []

        # Xóa khỏi Qdrant
        qdrant.delete(
            collection_name=collection,
            points_selector=FilterSelector(
                filter=Filter(
                    must=[FieldCondition(key="filename", match=MatchValue(value=filename))]
                )
            )
        )
        invalidate_by_collection(collection)

        # Sync BM25
        if ids_to_remove:
            bm25_store = get_bm25_store(collection)
            removed = bm25_store.remove_by_ids(ids_to_remove)
            if removed > 0:
                save_bm25_store(bm25_store, collection)
                logger.info("[BM25] Synced delete filename=%s removed=%d", filename, removed)

    except Exception as e:
        logger.error("[delete_by_filename] error: %s", e)
    return True


def delete_by_source_id(collection: str, source_id: str):
    """Xóa chunk theo source_id (realtime KB)"""
    try:
        qdrant.delete(
            collection_name=collection,
            points_selector=FilterSelector(
                filter=Filter(
                    must=[FieldCondition(key="source_id", match=MatchValue(value=source_id))]
                )
            )
        )
        invalidate_by_collection(collection)
    except Exception:
        pass
    return True