import os
import sys

# Thêm parent dir vào sys.path để import từ api
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.rag import qdrant, embed, VECTOR_SIZE
from qdrant_client.models import PointStruct

def re_embed_all_collections():
    """Script để fetch toàn bộ points, sinh vector mới từ Model Multilingual và ghi đè."""
    try:
        collections_resp = qdrant.get_collections()
        collections = [c.name for c in collections_resp.collections]
        
        if not collections:
            print("No collections found in Qdrant.")
            return

        print(f"Found {len(collections)} collections. Starting re-embedding with new Multilingual model...")

        for collection in collections:
            print(f"--- Processing collection: {collection} ---")
            
            # Scroll to get all points (Qdrant Python client)
            has_next = True
            next_offset = None
            total_points = 0
            
            while has_next:
                points_batch, next_offset = qdrant.scroll(
                    collection_name=collection,
                    limit=1000,
                    offset=next_offset,
                    with_payload=True,
                    with_vectors=False
                )
                
                if not points_batch:
                    break
                    
                total_points += len(points_batch)
                
                # Re-embed each point
                new_points = []
                for p in points_batch:
                    content = p.payload.get("content", "")
                    if content:
                        new_vec = embed(content)
                        new_points.append(
                            PointStruct(id=p.id, vector=new_vec, payload=p.payload)
                        )
                
                if new_points:
                    qdrant.upsert(collection_name=collection, points=new_points)
                    print(f"  Upserted batch of {len(new_points)} points.")
                
                if next_offset is None:
                    has_next = False
                    
            print(f"Finished {collection}. Total points re-embedded: {total_points}")
            
    except Exception as e:
        print(f"Error during re-embedding: {e}")

if __name__ == "__main__":
    re_embed_all_collections()
