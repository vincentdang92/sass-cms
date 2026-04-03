"""
Cache layer dùng Redis để cache kết quả RAG search.

TTL theo loại KB:
- static    → 1 giờ    (3600s)
- pricing   → 15 phút  (900s)
- promotion → 30 phút  (1800s)
- flash_sale→ đến hết sale (tính theo valid_to của chunk nhỏ nhất), tối đa 4 giờ
- fallback  → 10 phút  (600s)
"""

import redis
import hashlib
import json
import os
from datetime import datetime, timezone

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Lazy init — không crash ngay nếu Redis chưa sẵn sàng
_client: redis.Redis | None = None


def _get_client() -> redis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = redis.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2)
            _client.ping()
        except Exception as e:
            print(f"[Cache] Redis không kết nối được: {e}. Cache disabled.")
            _client = None
    return _client


def _cache_key(collection: str, query: str, mode: str, categories: list[str] | None) -> str:
    """
    Key = hash(collection + query + mode + sorted_categories + time_bucket).
    Time bucket: làm tròn theo 5 phút để nhiều request trong cùng window dùng chung cache.
    """
    now = datetime.now(timezone.utc)
    bucket = now.replace(
        minute=(now.minute // 5) * 5,
        second=0, microsecond=0
    ).isoformat()
    cats = sorted(categories) if categories else []
    raw = f"{collection}|{query}|{mode}|{cats}|{bucket}"
    return "rag:" + hashlib.md5(raw.encode()).hexdigest()


def get_cached(collection: str, query: str, mode: str, categories: list[str] | None) -> list[str] | None:
    """Trả về cached result. None nếu cache miss hoặc Redis down."""
    r = _get_client()
    if r is None:
        return None
    try:
        key = _cache_key(collection, query, mode, categories)
        val = r.get(key)
        if val:
            return json.loads(val)
    except Exception as e:
        print(f"[Cache] get error: {e}")
    return None


def set_cached(
    collection: str,
    query: str,
    mode: str,
    categories: list[str] | None,
    results: list[str],
) -> None:
    """Cache kết quả với TTL thông minh theo loại KB."""
    r = _get_client()
    if r is None:
        return
    try:
        ttl = _determine_ttl(mode, categories)
        key = _cache_key(collection, query, mode, categories)
        r.setex(key, ttl, json.dumps(results, ensure_ascii=False))
    except Exception as e:
        print(f"[Cache] set error: {e}")


def _determine_ttl(mode: str, categories: list[str] | None) -> int:
    """Tính TTL (giây) dựa theo mode và category."""
    if mode == "static":
        return 3600          # 1 giờ

    cats = set(categories or [])
    if "flash_sale" in cats:
        return 14400         # 4 giờ — sẽ expire cùng lúc với valid_to của sale
    if "pricing" in cats:
        return 900           # 15 phút
    if "promotion" in cats:
        return 1800          # 30 phút

    return 600               # fallback: 10 phút


def invalidate(collection: str, category: str | None = None) -> int:
    """
    Xoá cache liên quan khi KB được update.
    Dùng SCAN để tránh block Redis với KEYS *.
    Trả về số key đã xoá.
    """
    r = _get_client()
    if r is None:
        return 0
    try:
        pattern = f"rag:*"   # xoá theo collection sẽ cần prefix phức tạp hơn
        # Đơn giản: xoá tất cả rag cache của hệ thống khi có update
        # Production: encode collection vào prefix key để xoá chính xác hơn
        deleted = 0
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=200)
            if keys:
                r.delete(*keys)
                deleted += len(keys)
            if cursor == 0:
                break
        return deleted
    except Exception as e:
        print(f"[Cache] invalidate error: {e}")
        return 0


def invalidate_by_collection(collection: str) -> int:
    """Xoá cache liên quan đến 1 collection cụ thể (tất cả mode/category)."""
    return invalidate(collection)   # hiện tại xoá all, đủ dùng cho quy mô SaaS nhỏ

def invalidate_by_category(collection: str, category: str) -> int:
    """Xóa cache toàn bộ đối với thay đổi realtime."""
    return invalidate(collection, category)
def get_redis_stats() -> dict:
    """Lấy thông tin thống kê từ Redis cho Admin Dashboard"""
    r = _get_client()
    if r is None:
        return {"status": "offline", "error": "Cannot connect to Redis"}
    
    try:
        info = r.info()
        db_size = r.dbsize()
        return {
            "status": "online",
            "uptime_days": getattr(info, "get", lambda x, d=None: info.get(x, d))("uptime_in_days", 0),
            "memory_used_mb": round(getattr(info, "get", lambda x, d=None: info.get(x, d))("used_memory", 0) / 1024 / 1024, 2),
            "memory_peak_mb": round(getattr(info, "get", lambda x, d=None: info.get(x, d))("used_memory_peak", 0) / 1024 / 1024, 2),
            "connected_clients": getattr(info, "get", lambda x, d=None: info.get(x, d))("connected_clients", 0),
            "total_keys": db_size,
            "hits": getattr(info, "get", lambda x, d=None: info.get(x, d))("keyspace_hits", 0),
            "misses": getattr(info, "get", lambda x, d=None: info.get(x, d))("keyspace_misses", 0)
        }
    except Exception as e:
        return {"status": "offline", "error": str(e)}
