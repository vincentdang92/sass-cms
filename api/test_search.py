import sys
from services.rag import qdrant, _now_iso, embed
from qdrant_client.models import Filter, FieldCondition, MatchValue, DatetimeRange

f = Filter(must=[FieldCondition(key="category", match=MatchValue(value="flash_sale"))])

test_res = qdrant.query_points(
    collection_name="kb_test-tenant",
    query=embed("có chương trình flash sale nào không"),
    query_filter=f,
    limit=5
)
print("Points found with filter:", len(test_res.points))
for pt in test_res.points:
    print(f"Score: {pt.score}, Text: {pt.payload.get('content', '')[:100]}")
