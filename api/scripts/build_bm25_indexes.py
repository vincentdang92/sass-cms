"""
Build BM25 indexes cho tất cả tenant collections từ dữ liệu Qdrant hiện có.

Chạy script này một lần sau khi deploy Hybrid Search để backfill BM25 index
cho các tenant đã có data trong Qdrant từ trước.

Usage:
    python scripts/build_bm25_indexes.py
    python scripts/build_bm25_indexes.py --collection kb_tenant_abc123
    python scripts/build_bm25_indexes.py --dry-run

Notes:
    - Script đọc từ Qdrant → rebuild BM25 → lưu vào /data/bm25_indexes/{collection}.pkl
    - Không ảnh hưởng production (read-only từ Qdrant, write vào /data)
    - Có thể chạy song song với production đang hoạt động
"""
import os
import sys
import argparse
import logging

# Thêm API root vào path để import services
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)


def build_index_for_collection(collection: str, qdrant_client, dry_run: bool = False):
    """Rebuild BM25 index cho một collection từ Qdrant scroll."""
    from services.bm25_store import BM25Store, save_bm25_store, _index_path

    logger.info("Processing collection: %s", collection)

    # Scroll toàn bộ points từ Qdrant
    all_docs = []
    offset = None
    page = 0

    while True:
        try:
            results, next_offset = qdrant_client.scroll(
                collection_name=collection,
                offset=offset,
                limit=200,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as e:
            logger.error("Error scrolling collection %s: %s", collection, e)
            break

        for point in results:
            content = point.payload.get("content", "")
            if content.strip():
                all_docs.append({"id": str(point.id), "content": content})

        page += 1
        offset = next_offset
        if not results or next_offset is None:
            break

    logger.info("  Scrolled %d docs (pages=%d)", len(all_docs), page)

    if not all_docs:
        logger.info("  No docs found, skipping.")
        return 0

    if dry_run:
        logger.info("  [DRY RUN] Would write %d docs to %s", len(all_docs), _index_path(collection))
        return len(all_docs)

    # Build BM25 store
    store = BM25Store()
    store.add_documents(all_docs)
    save_bm25_store(store, collection)

    logger.info("  ✅ Saved BM25 index: %d docs → %s", len(store), _index_path(collection))
    return len(all_docs)


def main():
    parser = argparse.ArgumentParser(description="Build BM25 indexes from Qdrant collections")
    parser.add_argument("--collection", help="Specific collection to rebuild (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Don't write files, just count docs")
    args = parser.parse_args()

    from qdrant_client import QdrantClient
    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
    client = QdrantClient(url=qdrant_url)

    if args.collection:
        collections = [args.collection]
    else:
        # Lấy danh sách tất cả collections
        all_collections = client.get_collections().collections
        collections = [c.name for c in all_collections]
        logger.info("Found %d collections: %s", len(collections), collections)

    total_docs = 0
    for coll in collections:
        count = build_index_for_collection(coll, client, dry_run=args.dry_run)
        total_docs += count

    logger.info("Done! Total docs indexed: %d across %d collections", total_docs, len(collections))


if __name__ == "__main__":
    main()
