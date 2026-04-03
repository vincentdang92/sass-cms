from enum import Enum

class IntentMode(str, Enum):
    STATIC = "static"
    REALTIME = "realtime"
    HYBRID = "hybrid"

# Định nghĩa các keywords map với danh mục Realtime và Static
REALTIME_KEYWORDS = {
    "pricing":   ["giá", "bao nhiêu", "tiền", "price", "cost", "phí", "bảng giá"],
    "promotion": ["ưu đãi", "khuyến mãi", "giảm giá", "voucher", "discount", "sale"],
    "flash_sale":["flash sale", "sale sốc", "hôm nay sale", "rẻ nhất"],
}
STATIC_KEYWORDS = ["thông số", "tính năng", "cấu hình", "hướng dẫn", "bảo hành", "quy định", "chính sách", "điều khoản", "là gì", "cách"]

def route_query(question: str) -> tuple[str, list[str]]:
    """Phân tích keyword câu hỏi để trả về Intent (mode) và Category gợi ý.
    Returns:
        tuple (mode: str, categories: list[str])
    """
    q = question.lower()
    matched_categories = []
    
    # 1. Quét tìm Realtime Topics
    for cat, kws in REALTIME_KEYWORDS.items():
        if any(kw in q for kw in kws):
            matched_categories.append(cat)

    # 2. Quét tìm Static Topics
    has_static = any(kw in q for kw in STATIC_KEYWORDS)

    # 3. Decision Logic
    if matched_categories and not has_static:
        return IntentMode.REALTIME.value, matched_categories
    elif has_static and not matched_categories:
        return IntentMode.STATIC.value, []
    elif matched_categories and has_static:
        return IntentMode.HYBRID.value, matched_categories
        
    # Default fallback nếu không match từ nào
    return IntentMode.HYBRID.value, []
