from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer
import os, uuid

qdrant = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))

# Local embedding model — miễn phí, 384 dims, ~50MB
_model = SentenceTransformer("paraphrase-MiniLM-L3-v2")

VECTOR_SIZE = 384


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


def ingest(collection: str, chunks: list[dict]):
    """chunks = [{"content": "...", "metadata": {...}}]"""
    ensure_collection(collection)
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embed(c["content"]),
            payload={"content": c["content"], **c.get("metadata", {})}
        )
        for c in chunks
    ]
    qdrant.upsert(collection_name=collection, points=points)
    return len(points)


def search(collection: str, query: str, top_k: int = 5) -> list[str]:
    try:
        results = qdrant.search(
            collection_name=collection,
            query_vector=embed(query),
            limit=top_k,
            score_threshold=0.55  # MiniLM score thấp hơn OpenAI một chút
        )
        return [r.payload["content"] for r in results]
    except Exception:
        return []


def delete_collection(collection: str):
    qdrant.delete_collection(collection)


def list_points(collection: str) -> list[dict]:
    """Liệt kê documents trong KB"""
    try:
        result = qdrant.scroll(collection_name=collection, limit=100)
        return [{"id": str(p.id), **p.payload} for p in result[0]]
    except Exception:
        return []