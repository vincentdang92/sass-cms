# Zero-Upload RAG — Thiết kế chi tiết

> Kiến trúc cho phép doanh nghiệp dùng chatbot RAG mà **không cần upload dữ liệu nhạy cảm lên bên thứ 3**. Dữ liệu nhạy cảm ở lại hạ tầng nội bộ, chatbot chỉ đọc qua MCP Gateway khi cần, với PII được mask trước khi chạm tới LLM cloud.

---

## Mục lục

1. [Tổng quan flow](#1-tổng-quan-flow)
2. [Sensitivity Classifier](#2-sensitivity-classifier)
3. [MCP Gateway](#3-mcp-gateway)
4. [PII Sanitizer](#4-pii-sanitizer)
5. [Kết nối 3 lớp: Full request lifecycle](#5-kết-nối-3-lớp-full-request-lifecycle)
6. [Deployment topology](#6-deployment-topology)
7. [Checklist triển khai](#7-checklist-triển-khai)

---

## 1. Tổng quan flow

```
User gửi câu hỏi
        │
        ▼
[1. Sensitivity Classifier]  ◄── Chạy on-premise hoặc rule-based
        │
        ├── PUBLIC   ──────────────────────────► Cloud Vector Store
        │                                              │
        ├── MIXED    ──► MCP Gateway (on-prem)         │
        │                     +                        │
        │             Cloud Vector Store               │
        │                     │                        │
        └── SENSITIVE ──► MCP Gateway only             │
                                │                      │
                                └──────────┬───────────┘
                                           ▼
                                 [Context Assembler]
                                           │
                                           ▼
                                 [2. PII Sanitizer]  ◄── Mask trước khi ra cloud
                                           │
                                           ▼
                                  [LLM: Cloud / On-prem]
                                           │
                                           ▼
                                 [PII De-masker]  ◄── Swap placeholder → giá trị thật
                                           │
                                           ▼
                                    Response → User
```

**Nguyên tắc cốt lõi:**
- Dữ liệu nhạy cảm không bao giờ rời khỏi on-premise trước khi được mask.
- LLM cloud chỉ nhìn thấy placeholder như `[TÊN_KH_001]`, không bao giờ thấy "Nguyễn Văn A".
- MCP Gateway là tầng duy nhất có quyền đọc hệ thống nội bộ, và chỉ expose đúng những field được cấu hình.

---

## 2. Sensitivity Classifier

### Mục đích

Phân loại câu hỏi của user vào 3 mức trước khi quyết định retrieve từ đâu. Đây là lớp quyết định **data nào có thể ra cloud, data nào phải ở lại on-premise**.

### 3 mức phân loại

| Mức | Tên | Ý nghĩa | Retrieve từ |
|---|---|---|---|
| 0 | `PUBLIC` | Thông tin hoàn toàn công khai | Cloud Vector Store only |
| 1 | `MIXED` | Cần data thật nhưng không cá nhân hóa | MCP Gateway + Cloud Vector Store |
| 2 | `SENSITIVE` | Liên quan đến khách hàng cụ thể, hợp đồng, tài chính | MCP Gateway only |

### Triển khai — 3 tầng, dùng tầng nào tùy độ phức tạp

#### Tầng 1: Rule-based (nhanh, không cần model)

```python
from dataclasses import dataclass
from enum import IntEnum

class SensitivityLevel(IntEnum):
    PUBLIC = 0
    MIXED = 1
    SENSITIVE = 2

@dataclass
class ClassifyResult:
    level: SensitivityLevel
    reason: str
    matched_signals: list[str]

# Từ khóa định nghĩa signal nhạy cảm
SENSITIVE_SIGNALS = {
    "identity":    ["cmnd", "cccd", "passport", "tên tôi", "tài khoản của tôi"],
    "financial":   ["giá của tôi", "hợp đồng", "nợ", "công nợ", "thanh toán của tôi"],
    "order":       ["đơn hàng", "order", "mã đơn", "trạng thái đơn"],
    "personal":    ["số điện thoại", "địa chỉ của tôi", "email của tôi"],
}

MIXED_SIGNALS = {
    "pricing":     ["giá", "bảng giá", "price", "phí", "cost"],
    "inventory":   ["còn hàng", "tồn kho", "stock", "available"],
    "promotion":   ["flash sale", "ưu đãi hôm nay", "khuyến mãi đang chạy"],
}

def classify_rule_based(question: str) -> ClassifyResult:
    q = question.lower()
    matched = []

    for category, keywords in SENSITIVE_SIGNALS.items():
        hits = [kw for kw in keywords if kw in q]
        if hits:
            matched.extend(hits)

    if matched:
        return ClassifyResult(
            level=SensitivityLevel.SENSITIVE,
            reason="Phát hiện signal nhạy cảm",
            matched_signals=matched
        )

    for category, keywords in MIXED_SIGNALS.items():
        hits = [kw for kw in keywords if kw in q]
        if hits:
            matched.extend(hits)

    if matched:
        return ClassifyResult(
            level=SensitivityLevel.MIXED,
            reason="Cần data thật, không cá nhân hóa",
            matched_signals=matched
        )

    return ClassifyResult(
        level=SensitivityLevel.PUBLIC,
        reason="Không có signal nhạy cảm",
        matched_signals=[]
    )
```

#### Tầng 2: ML Classifier (chính xác hơn)

```python
# Fine-tune một model nhỏ (BERT, PhoBERT cho tiếng Việt)
# hoặc dùng zero-shot classification với model on-premise

from transformers import pipeline

# Chạy on-premise, không gửi câu hỏi ra ngoài
classifier = pipeline(
    "zero-shot-classification",
    model="facebook/bart-large-mnli",  # hoặc model tiếng Việt
    device="cpu"  # on-premise không cần GPU mạnh
)

CANDIDATE_LABELS = [
    "thông tin cá nhân khách hàng",     # → SENSITIVE
    "thông tin đơn hàng cụ thể",        # → SENSITIVE
    "giá cả và chương trình ưu đãi",    # → MIXED
    "câu hỏi chung về sản phẩm",        # → PUBLIC
    "hướng dẫn sử dụng",                # → PUBLIC
]

def classify_ml(question: str) -> ClassifyResult:
    result = classifier(question, CANDIDATE_LABELS, multi_label=False)
    top_label = result["labels"][0]
    score = result["scores"][0]

    if "cá nhân" in top_label or "đơn hàng cụ thể" in top_label:
        level = SensitivityLevel.SENSITIVE
    elif "giá cả" in top_label or "ưu đãi" in top_label:
        level = SensitivityLevel.MIXED
    else:
        level = SensitivityLevel.PUBLIC

    return ClassifyResult(level=level, reason=top_label, matched_signals=[f"score={score:.2f}"])
```

#### Tầng 3: Hybrid (production-ready)

```python
def classify(question: str, user_context: dict = None) -> ClassifyResult:
    # Bước 1: Rule-based nhanh
    rule_result = classify_rule_based(question)

    # Nếu rule đã chắc chắn SENSITIVE → không cần ML
    if rule_result.level == SensitivityLevel.SENSITIVE and len(rule_result.matched_signals) >= 2:
        return rule_result

    # Bước 2: Kiểm tra user context (user đã login? có customer_id không?)
    if user_context and user_context.get("customer_id"):
        # User đang hỏi với context cá nhân → nâng mức lên MIXED tối thiểu
        if rule_result.level == SensitivityLevel.PUBLIC:
            return ClassifyResult(
                level=SensitivityLevel.MIXED,
                reason="User có customer_id, nâng mức",
                matched_signals=["user_context"]
            )

    # Bước 3: ML classifier cho trường hợp mơ hồ
    if rule_result.level == SensitivityLevel.PUBLIC:
        ml_result = classify_ml(question)
        # Lấy mức cao hơn giữa rule và ML
        if ml_result.level > rule_result.level:
            return ml_result

    return rule_result
```

---

## 3. MCP Gateway

### Mục đích

MCP Gateway là một server chạy **hoàn toàn trong hạ tầng của doanh nghiệp**. Chatbot cloud gọi vào qua HTTPS + mTLS. Gateway chỉ expose đúng những tool được cấu hình — không bao giờ có full DB access.

### Kiến trúc MCP Gateway

```
[Chatbot Cloud]
      │
      │  HTTPS + mTLS
      │  Header: Authorization: Bearer <token>
      │  Header: X-Request-Id: <uuid>
      │
      ▼
[MCP Gateway — On-premise]
      │
      ├── Auth Middleware      ← Verify JWT, check scopes
      ├── Rate Limiter         ← Giới hạn request/phút
      ├── Audit Logger         ← Log mọi thứ được truy cập
      ├── Tool Router          ← Dispatch đến tool đúng
      │
      ├── Tool: get_product_price(product_id)     → ERP
      ├── Tool: get_order_status(order_id)        → Order DB
      ├── Tool: get_customer_tier(customer_id)    → CRM
      ├── Tool: get_inventory(product_ids)        → Warehouse DB
      └── Tool: get_promotion_for_customer(...)   → Promotion Engine
```

### Triển khai MCP Gateway (FastAPI)

```python
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import jwt, time, logging

app = FastAPI(title="MCP Gateway", docs_url=None)  # Tắt docs ở production

# ─── Auth ────────────────────────────────────────────────────────────

SECRET_KEY = "your-secret-key"  # Dùng env var ở production

def verify_token(authorization: str = Header(...)) -> dict:
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid auth scheme")
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

# ─── Audit Logger ────────────────────────────────────────────────────

audit_logger = logging.getLogger("audit")

def audit_log(request_id: str, tool: str, params: dict, caller: str):
    audit_logger.info({
        "timestamp": time.time(),
        "request_id": request_id,
        "caller": caller,
        "tool": tool,
        "params": params,  # Không log giá trị nhạy cảm nếu có
    })

# ─── Tool Definitions ────────────────────────────────────────────────

class ToolRequest(BaseModel):
    tool: str
    params: dict
    request_id: str

class ToolResponse(BaseModel):
    data: dict
    tool: str
    request_id: str
    latency_ms: int

# Permission map: scope nào được gọi tool nào
TOOL_PERMISSIONS = {
    "get_product_price":           ["read:pricing"],
    "get_order_status":            ["read:orders"],
    "get_customer_tier":           ["read:customers"],
    "get_inventory":               ["read:inventory"],
    "get_promotion_for_customer":  ["read:promotions", "read:customers"],
}

@app.post("/mcp/call", response_model=ToolResponse)
async def call_tool(
    body: ToolRequest,
    token_payload: dict = Depends(verify_token)
):
    start = time.time()
    tool = body.tool

    # Kiểm tra tool có tồn tại không
    if tool not in TOOL_PERMISSIONS:
        raise HTTPException(status_code=404, detail=f"Tool '{tool}' not found")

    # Kiểm tra scope
    required_scopes = TOOL_PERMISSIONS[tool]
    caller_scopes = token_payload.get("scopes", [])
    if not all(s in caller_scopes for s in required_scopes):
        raise HTTPException(status_code=403, detail="Insufficient scopes")

    # Audit log
    audit_log(body.request_id, tool, body.params, token_payload.get("sub"))

    # Dispatch đến tool implementation
    result = await dispatch_tool(tool, body.params)

    return ToolResponse(
        data=result,
        tool=tool,
        request_id=body.request_id,
        latency_ms=int((time.time() - start) * 1000)
    )

# ─── Tool Implementations ────────────────────────────────────────────

async def dispatch_tool(tool: str, params: dict) -> dict:
    handlers = {
        "get_product_price":          get_product_price,
        "get_order_status":           get_order_status,
        "get_customer_tier":          get_customer_tier,
        "get_inventory":              get_inventory,
        "get_promotion_for_customer": get_promotion_for_customer,
    }
    handler = handlers.get(tool)
    if not handler:
        raise HTTPException(status_code=404)
    return await handler(**params)

async def get_product_price(product_id: str) -> dict:
    # Chỉ trả về field được whitelist — không expose toàn bộ row DB
    row = await erp_db.query(
        "SELECT product_id, name, price, currency, updated_at FROM prices WHERE product_id = $1",
        product_id
    )
    if not row:
        return {"error": "Product not found"}
    return {
        "product_id": row["product_id"],
        "name":        row["name"],
        "price":       row["price"],
        "currency":    row["currency"],
        "as_of":       row["updated_at"].isoformat(),
    }

async def get_order_status(order_id: str, customer_id: str) -> dict:
    # Bắt buộc truyền customer_id để tránh order enumeration attack
    row = await order_db.query(
        "SELECT order_id, status, items_count, total, created_at FROM orders "
        "WHERE order_id = $1 AND customer_id = $2",
        order_id, customer_id
    )
    if not row:
        return {"error": "Order not found or access denied"}
    return {
        "order_id":    row["order_id"],
        "status":      row["status"],
        "items_count": row["items_count"],
        "total":       row["total"],   # Số tiền — sẽ bị PII sanitizer mask nếu cần
        "created_at":  row["created_at"].isoformat(),
    }

async def get_customer_tier(customer_id: str) -> dict:
    # Chỉ trả về tier, không expose PII
    row = await crm_db.query(
        "SELECT tier, points, member_since FROM customers WHERE customer_id = $1",
        customer_id
    )
    return {
        "customer_id": customer_id,
        "tier":        row["tier"],        # "Gold", "Silver"...
        "points":      row["points"],
        "member_since": row["member_since"].isoformat(),
        # Không trả: name, phone, email, address
    }
```

### Rate limiting & Circuit breaker

```python
from slowapi import Limiter
from slowapi.util import get_remote_address
import asyncio

limiter = Limiter(key_func=get_remote_address)

# Giới hạn: 60 request/phút per IP
@app.post("/mcp/call")
@limiter.limit("60/minute")
async def call_tool(request: Request, ...):
    ...

# Circuit breaker đơn giản cho kết nối DB nội bộ
class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout=60):
        self.failures = 0
        self.threshold = failure_threshold
        self.timeout = timeout
        self.last_failure_time = None
        self.state = "CLOSED"  # CLOSED | OPEN | HALF_OPEN

    async def call(self, func, *args, **kwargs):
        if self.state == "OPEN":
            if time.time() - self.last_failure_time > self.timeout:
                self.state = "HALF_OPEN"
            else:
                raise Exception("Circuit breaker OPEN — DB unavailable")
        try:
            result = await func(*args, **kwargs)
            if self.state == "HALF_OPEN":
                self.state = "CLOSED"
                self.failures = 0
            return result
        except Exception as e:
            self.failures += 1
            self.last_failure_time = time.time()
            if self.failures >= self.threshold:
                self.state = "OPEN"
            raise e

erp_breaker = CircuitBreaker()
```

### Docker Compose — tự host on-premise

```yaml
# docker-compose.yml — chạy trong mạng nội bộ doanh nghiệp
version: "3.9"
services:
  mcp-gateway:
    build: ./mcp-gateway
    ports:
      - "8443:8443"    # Chỉ expose HTTPS, không expose HTTP
    environment:
      - SECRET_KEY=${SECRET_KEY}
      - ERP_DB_URL=${ERP_DB_URL}
      - CRM_DB_URL=${CRM_DB_URL}
      - ORDER_DB_URL=${ORDER_DB_URL}
      - LOG_LEVEL=INFO
    volumes:
      - ./certs:/certs:ro    # Mount TLS certs
      - ./audit-logs:/logs   # Audit logs ra ngoài container
    networks:
      - internal             # Không kết nối internet trực tiếp
    restart: unless-stopped

  audit-log-shipper:
    image: fluent/fluentd
    volumes:
      - ./audit-logs:/logs:ro
    networks:
      - internal

networks:
  internal:
    driver: bridge
    internal: true   # Không có outbound internet
```

---

## 4. PII Sanitizer

### Mục đích

Trước khi context từ MCP Gateway được ghép vào prompt gửi cho LLM cloud, **tất cả thông tin cá nhân phải được mask thành placeholder**. Response từ LLM trả về placeholder, de-masker swap lại trước khi hiển thị cho user.

### Các loại PII cần mask

| Loại | Ví dụ | Regex / Pattern |
|---|---|---|
| Số điện thoại VN | 0901234567, +84901234567 | `(0\|84\|\\+84)[0-9]{9}` |
| CMND/CCCD | 001234567890 | `[0-9]{9,12}` (trong ngữ cảnh) |
| Email | user@example.com | RFC 5322 |
| Họ tên | Nguyễn Văn A | NER model |
| Số thẻ ngân hàng | 1234 5678 9012 3456 | `[0-9]{4}[ -]?[0-9]{4}...` |
| Địa chỉ | 123 Nguyễn Huệ, Q1 | NER model |
| Ngày sinh | 01/01/1990 | Date pattern trong ngữ cảnh |

### Triển khai PII Sanitizer

```python
import re
from dataclasses import dataclass, field

@dataclass
class SanitizerSession:
    """
    Lưu mapping placeholder ↔ giá trị thật cho 1 request.
    Dispose ngay sau khi de-mask xong.
    """
    mappings: dict[str, str] = field(default_factory=dict)
    counter: dict[str, int] = field(default_factory=dict)

    def add(self, pii_type: str, value: str) -> str:
        # Nếu cùng giá trị xuất hiện lại → trả về cùng placeholder
        for placeholder, original in self.mappings.items():
            if original == value:
                return placeholder
        # Tạo placeholder mới
        idx = self.counter.get(pii_type, 0) + 1
        self.counter[pii_type] = idx
        placeholder = f"[{pii_type.upper()}_{idx:03d}]"
        self.mappings[placeholder] = value
        return placeholder

    def demask(self, text: str) -> str:
        for placeholder, original in self.mappings.items():
            text = text.replace(placeholder, original)
        return text


class PIISanitizer:
    # Patterns regex cho dạng có cấu trúc
    PATTERNS = [
        ("PHONE",    r'(?:0|\+84|84)(?:[35789][0-9]{8}|1[2-9][0-9]{8})'),
        ("EMAIL",    r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'),
        ("CARD",     r'\b(?:\d{4}[ \-]?){3}\d{4}\b'),
        ("CCCD",     r'\b(?:CCCD|CMND|số|id)[\s:]+([0-9]{9,12})\b'),
        ("DATE_DOB", r'\b(?:sinh ngày|ngày sinh|DOB)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{4})\b'),
        ("AMOUNT",   r'\b([0-9]{1,3}(?:[.,][0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:VNĐ|VND|đồng|₫)\b'),
    ]

    def __init__(self, use_ner: bool = False):
        self.use_ner = use_ner
        if use_ner:
            # Model NER cho tiếng Việt — chạy on-premise
            from transformers import pipeline
            self.ner = pipeline("ner", model="vinai/phobert-base", device=-1)

    def mask(self, text: str, session: SanitizerSession) -> str:
        # Bước 1: Regex patterns
        for pii_type, pattern in self.PATTERNS:
            def replace_fn(m, t=pii_type):
                value = m.group(0)
                return session.add(t, value)
            text = re.sub(pattern, replace_fn, text, flags=re.IGNORECASE)

        # Bước 2: NER cho tên người, địa chỉ (nếu enabled)
        if self.use_ner:
            text = self._mask_ner(text, session)

        return text

    def _mask_ner(self, text: str, session: SanitizerSession) -> str:
        entities = self.ner(text)
        # Xử lý từ cuối về đầu để offset không bị lệch
        for ent in sorted(entities, key=lambda e: e["start"], reverse=True):
            if ent["entity"] in ("B-PER", "I-PER"):
                value = text[ent["start"]:ent["end"]]
                placeholder = session.add("NAME", value)
                text = text[:ent["start"]] + placeholder + text[ent["end"]:]
            elif ent["entity"] in ("B-LOC", "I-LOC"):
                value = text[ent["start"]:ent["end"]]
                placeholder = session.add("ADDRESS", value)
                text = text[:ent["start"]] + placeholder + text[ent["end"]:]
        return text

    def mask_context_chunks(self, chunks: list[dict], session: SanitizerSession) -> list[dict]:
        """Mask toàn bộ list chunks trước khi ghép vào prompt."""
        masked = []
        for chunk in chunks:
            masked.append({
                **chunk,
                "text": self.mask(chunk["text"], session)
            })
        return masked
```

### Ví dụ đầy đủ — mask và de-mask

```python
sanitizer = PIISanitizer(use_ner=True)
session = SanitizerSession()

# Context từ MCP Gateway
raw_context = """
Khách hàng Nguyễn Văn A, số điện thoại 0901234567,
email nguyenvana@gmail.com, đơn hàng #ORD-2025-001
có tổng giá trị 2.500.000 VND, đang ở trạng thái đang giao.
"""

# Mask trước khi đưa vào prompt LLM
masked_context = sanitizer.mask(raw_context, session)
# "Khách hàng [NAME_001], số điện thoại [PHONE_001],
#  email [EMAIL_001], đơn hàng #ORD-2025-001
#  có tổng giá trị [AMOUNT_001], đang ở trạng thái đang giao."

# Gửi masked_context vào LLM prompt
prompt = f"""
Dựa trên thông tin sau, trả lời câu hỏi của khách hàng:

{masked_context}

Câu hỏi: Đơn hàng của tôi đang ở đâu?
"""

llm_response = await call_llm(prompt)
# "Đơn hàng của [NAME_001] với email [EMAIL_001] đang ở trạng thái đang giao."

# De-mask trước khi trả về cho user
final_response = session.demask(llm_response)
# "Đơn hàng của Nguyễn Văn A với email nguyenvana@gmail.com đang ở trạng thái đang giao."

# Dispose session — không giữ mapping PII trong memory
del session
```

### Cấu hình mức mask theo Sensitivity Level

```python
MASK_CONFIG = {
    SensitivityLevel.PUBLIC:    [],                             # Không mask gì
    SensitivityLevel.MIXED:     ["PHONE", "EMAIL", "CARD"],     # Mask liên lạc
    SensitivityLevel.SENSITIVE: ["PHONE", "EMAIL", "CARD",
                                  "NAME", "ADDRESS", "CCCD",
                                  "DATE_DOB", "AMOUNT"],        # Mask toàn bộ
}

def get_masks_for_level(level: SensitivityLevel) -> list[str]:
    return MASK_CONFIG.get(level, [])
```

---

## 5. Kết nối 3 lớp: Full request lifecycle

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class ChatRequest(BaseModel):
    question: str
    user_context: dict = {}

@app.post("/chat")
async def chat(req: ChatRequest):
    question = req.question
    user_ctx  = req.user_context
    session   = SanitizerSession()

    # ── Bước 1: Classify sensitivity ──────────────────────────────
    classify_result = classify(question, user_ctx)
    level = classify_result.level

    # ── Bước 2: Retrieve theo level ───────────────────────────────
    mcp_chunks   = []
    cloud_chunks = []

    if level in (SensitivityLevel.SENSITIVE, SensitivityLevel.MIXED):
        # Gọi MCP Gateway on-premise
        mcp_response = await mcp_gateway_client.call_tool(
            tool=select_tool(question, level),
            params=extract_params(question, user_ctx),
            scopes=get_required_scopes(level)
        )
        mcp_chunks = mcp_response.get("chunks", [])

    if level in (SensitivityLevel.PUBLIC, SensitivityLevel.MIXED):
        # Query Cloud Vector Store
        cloud_chunks = await cloud_vector_store.query(
            vector=embed(question),
            filter={"type": "public"},
            top_k=5
        )

    # ── Bước 3: Assemble context ──────────────────────────────────
    all_chunks = rerank(mcp_chunks + cloud_chunks, question)

    # ── Bước 4: PII Sanitize (chỉ với MIXED và SENSITIVE) ─────────
    if level != SensitivityLevel.PUBLIC:
        mask_types = get_masks_for_level(level)
        sanitizer = PIISanitizer(use_ner=(level == SensitivityLevel.SENSITIVE))
        all_chunks = sanitizer.mask_context_chunks(all_chunks, session)

    # ── Bước 5: Gọi LLM ───────────────────────────────────────────
    context_text = "\n\n".join(c["text"] for c in all_chunks)
    prompt = build_prompt(question, context_text)

    # Chọn LLM: on-premise nếu SENSITIVE, cloud nếu PUBLIC/MIXED
    if level == SensitivityLevel.SENSITIVE:
        raw_response = await onprem_llm.generate(prompt)
    else:
        raw_response = await cloud_llm.generate(prompt)

    # ── Bước 6: De-mask và trả về ─────────────────────────────────
    final_response = session.demask(raw_response)
    del session  # Dispose ngay

    return {
        "answer":            final_response,
        "sensitivity_level": level.name,
        "sources_used":      ["mcp" if mcp_chunks else None,
                               "cloud" if cloud_chunks else None],
    }
```

---

## 6. Deployment topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLOUD (Chatbot provider)                                           │
│                                                                     │
│   [API Gateway] → [Sensitivity Classifier] → [Chatbot App]         │
│                          │                         │               │
│                          │                         ├── Cloud VS    │
│                          │                         └── Cloud LLM   │
└──────────────────────────┼─────────────────────────────────────────┘
                           │  HTTPS + mTLS (port 8443)
                           │  IP Whitelist (chỉ cloud app IP)
┌──────────────────────────┼─────────────────────────────────────────┐
│  ON-PREMISE (Doanh nghiệp)                                          │
│                          ▼                                          │
│            [MCP Gateway]                                            │
│                  │                                                  │
│    ┌─────────────┼──────────────────┐                              │
│    ▼             ▼                  ▼                               │
│  [ERP]         [CRM]           [Order DB]                           │
│                                                                     │
│  [Audit Log Store]  ← ghi lại toàn bộ MCP call                     │
│  [On-prem LLM]      ← optional, dùng cho câu hỏi SENSITIVE         │
└─────────────────────────────────────────────────────────────────────┘
```

### Network security

```yaml
# Chỉ cho phép IP của Chatbot Cloud gọi vào MCP Gateway
firewall:
  inbound:
    - port: 8443
      protocol: tcp
      source: 203.0.113.0/24    # IP range của Chatbot cloud
      action: ALLOW
    - port: 8443
      protocol: tcp
      source: 0.0.0.0/0
      action: DENY
  outbound:
    - destination: 0.0.0.0/0    # MCP Gateway không cần outbound internet
      action: DENY
```

### mTLS setup

```bash
# Sinh cert cho MCP Gateway (on-premise)
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt \
  -days 365 -subj "/CN=mcp-gateway.internal"

# Sinh cert cho Chatbot Cloud (client cert)
openssl req -x509 -newkey rsa:4096 -keyout client.key -out client.crt \
  -days 365 -subj "/CN=chatbot-cloud"

# Chatbot Cloud dùng client.crt + client.key khi gọi MCP Gateway
# MCP Gateway verify bằng client.crt đã trust sẵn
```

---

## 7. Checklist triển khai

### Phase 1 — Sensitivity Classifier

- [ ] Định nghĩa từ điển `SENSITIVE_SIGNALS` và `MIXED_SIGNALS` theo domain
- [ ] Implement rule-based classifier, test với 50 câu hỏi mẫu
- [ ] (Optional) Fine-tune ML classifier nếu rule-based không đủ chính xác
- [ ] Thiết lập threshold: false negative (PUBLIC nhầm thành SENSITIVE) hay false positive (SENSITIVE nhầm thành PUBLIC) nguy hiểm hơn?
- [ ] Unit test coverage ≥ 90% cho classifier
- [ ] Log kết quả classification để review và cải thiện

### Phase 2 — MCP Gateway

- [ ] Thiết kế danh sách tool và field whitelist cho từng tool
- [ ] Thiết lập JWT auth với scope-based permission
- [ ] Implement rate limiter (60 req/phút per token)
- [ ] Implement circuit breaker cho mỗi DB connection
- [ ] Cấu hình mTLS giữa Chatbot Cloud và MCP Gateway
- [ ] Thiết lập audit log (lưu tối thiểu 90 ngày)
- [ ] Firewall rules: chỉ whitelist IP của Chatbot Cloud
- [ ] Load test: target latency P95 < 500ms cho mỗi tool call
- [ ] Penetration test trước khi production

### Phase 3 — PII Sanitizer

- [ ] Xác định danh sách PII type cần mask cho từng domain
- [ ] Test regex patterns với bộ dữ liệu thật (anonymized)
- [ ] Quyết định có cần NER hay không (NER chính xác hơn nhưng chậm hơn ~50ms)
- [ ] Implement và test `SanitizerSession` — đảm bảo dispose đúng sau mỗi request
- [ ] Test de-masker: response từ LLM phải giữ đúng placeholder
- [ ] Đo overhead của PII sanitizer: target < 30ms cho đoạn text ≤ 2000 ký tự

### Phase 4 — Integration & Security Audit

- [ ] Integration test toàn bộ flow: câu hỏi PUBLIC / MIXED / SENSITIVE
- [ ] Kiểm tra: PII có bao giờ xuất hiện trong prompt gửi cloud LLM không?
- [ ] Kiểm tra: MCP Gateway có trả về field ngoài whitelist không?
- [ ] Kiểm tra: SanitizerSession có bị leak giữa các request không?
- [ ] Security audit bởi bên thứ 3 trước khi go-live với dữ liệu thật

---

## Ghi chú quan trọng

**Sensitivity Classifier phải chạy on-premise** — nếu chạy trên cloud, câu hỏi của user đã leak ra trước khi được phân loại. Dùng rule-based hoặc model nhỏ như DistilBERT chạy cục bộ.

**MCP Gateway không nên có outbound internet** — tool chỉ đọc DB nội bộ, không có lý do gì cần gọi ra ngoài. Firewall block outbound là lớp bảo vệ cuối cùng.

**SanitizerSession phải dispose ngay sau request** — không cache, không lưu vào DB. Mapping `[PHONE_001] → 0901234567` chỉ tồn tại trong memory trong vòng đời của 1 request.

**Audit log là bắt buộc** — mọi MCP call phải được log với `request_id`, `tool`, `caller`, `timestamp`. Log này là bằng chứng duy nhất để audit khi có incident.
