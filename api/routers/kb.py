from fastapi import APIRouter, Header, UploadFile, File, HTTPException
from models.tenant import get_customer_by_key
from services.rag import ingest
import json
import io

router = APIRouter(prefix="/kb", tags=["Knowledge Base"])

def chunk_text(text: str, size: int = 150) -> list[str]:
    words = text.split()
    return [" ".join(words[i:i+size]) for i in range(0, len(words), size)]

def extract_text(file_bytes: bytes, filename: str) -> str:
    """Extract text from various file types."""
    name_lower = filename.lower()

    # PDF
    if name_lower.endswith(".pdf"):
        try:
            import pdfplumber
            text_parts = []
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)
            return "\n\n".join(text_parts)
        except Exception as e:
            raise HTTPException(500, f"Failed to parse PDF: {e}")

    # XLSX / Excel
    elif name_lower.endswith(".xlsx") or name_lower.endswith(".xls"):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            rows_text = []
            for sheet in wb.worksheets:
                headers = None
                for i, row in enumerate(sheet.iter_rows(values_only=True)):
                    row_vals = [str(c) if c is not None else "" for c in row]
                    if i == 0:
                        headers = row_vals
                    else:
                        if headers:
                            # Format as "Header: Value, ..." for semantic rich chunks
                            row_text = ", ".join(f"{h}: {v}" for h, v in zip(headers, row_vals) if v)
                        else:
                            row_text = ", ".join(v for v in row_vals if v)
                        if row_text.strip():
                            rows_text.append(row_text)
            return "\n".join(rows_text)
        except Exception as e:
            raise HTTPException(500, f"Failed to parse XLSX: {e}")

    # CSV
    elif name_lower.endswith(".csv"):
        try:
            import pandas as pd
            df = pd.read_csv(io.BytesIO(file_bytes))
            rows_text = []
            for _, row in df.iterrows():
                row_text = ", ".join(f"{col}: {val}" for col, val in row.items() if str(val).strip())
                rows_text.append(row_text)
            return "\n".join(rows_text)
        except Exception as e:
            raise HTTPException(500, f"Failed to parse CSV: {e}")

    # JSON
    elif name_lower.endswith(".json"):
        try:
            data = json.loads(file_bytes.decode("utf-8"))
            return json.dumps(data, ensure_ascii=False, indent=2)
        except Exception as e:
            raise HTTPException(500, f"Failed to parse JSON: {e}")

    # Plain text, Markdown
    else:
        return file_bytes.decode("utf-8", errors="ignore")


@router.post("/upload")
async def upload_kb(
    files: list[UploadFile] = File(...),
    x_api_key: str = Header(...)
):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    total = 0
    results = []
    for file in files:
        content = await file.read()
        text = extract_text(content, file.filename)

        # Tag kyai metadata based on filename
        kb_type = "general"
        name_lower = file.filename.lower()
        if any(x in name_lower for x in ["price", "gia", "bảng giá", "pricing"]):
            kb_type = "pricing"
        elif any(x in name_lower for x in ["faq", "support"]):
            kb_type = "faq"
        elif any(x in name_lower for x in ["policy", "terms", "điều khoản"]):
            kb_type = "policy"

        chunks = chunk_text(text)
        docs = [{
            "content": c,
            "metadata": {
                "filename": file.filename,
                "type": kb_type,
                "customer_id": customer.id
            }
        } for c in chunks]

        count = ingest(customer.qdrant_collection, docs)
        total += count
        results.append({"file": file.filename, "chunks": count, "type": kb_type})

    return {"uploaded_chunks": total, "files": len(files), "details": results}


@router.post("/upload/json")
async def upload_json_kb(data: dict, x_api_key: str = Header(...)):
    """Upload KB dạng JSON — tiện cho bảng giá có cấu trúc"""
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)

    items = data.get("items", [])
    docs = [{
        "content": json.dumps(item, ensure_ascii=False),
        "metadata": {"type": data.get("type", "product"), "customer_id": customer.id}
    } for item in items]

    total = ingest(customer.qdrant_collection, docs)
    return {"uploaded_chunks": total}
