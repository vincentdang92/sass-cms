from fastapi import APIRouter, Header, UploadFile, File, HTTPException, BackgroundTasks
from models.tenant import get_customer_by_key, SessionLocal, KBJob
from services.rag import ingest, ingest_with_ids, ingest_realtime, delete_by_filename, delete_by_source_id
from services.bm25_store import get_bm25_store, save_bm25_store
from datetime import datetime, timezone
import json
import io
import uuid
import hashlib
import tempfile
import os
import logging
import time

# Phase 2: langchain chunking + langdetect
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    _HAS_LANGCHAIN = True
except ImportError:
    _HAS_LANGCHAIN = False

try:
    from langdetect import detect as _langdetect
    _HAS_LANGDETECT = True
except ImportError:
    _HAS_LANGDETECT = False

# Phase 1: MIME validation
try:
    import magic as _magic
    _HAS_MAGIC = True
except ImportError:
    _HAS_MAGIC = False

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/kb", tags=["Knowledge Base"])


# ── MIME Validation ────────────────────────────────────────────────────────
ALLOWED_MIMES = {
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/json",
    "application/octet-stream",  # fallback for some xlsx
}

def validate_file_mime(content: bytes, filename: str) -> None:
    """Phase 1: Validate thực tế MIME type của file thay vì chỉ kiểm tra extension."""
    if not _HAS_MAGIC:
        return  # Skip nếu chưa cài python-magic
    mime = _magic.from_buffer(content, mime=True)
    if mime not in ALLOWED_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"File type not allowed: {mime} (file: {filename}). Chỉ hỗ trợ: PDF, TXT, CSV, XLSX, JSON"
        )


# ── Helpers ────────────────────────────────────────────────────────────────
def file_hash(content: bytes) -> str:
    """SHA-256 của nội dung file — dùng cho dedup check."""
    return hashlib.sha256(content).hexdigest()


def detect_language(text: str) -> str:
    """Auto-detect ngôn ngữ văn bản (vi/en/...)."""
    if not _HAS_LANGDETECT:
        return "unknown"
    try:
        return _langdetect(text[:500])
    except Exception:
        return "unknown"


def job_to_dict(job: KBJob) -> dict:
    return {
        "id": job.id,
        "filename": job.filename,
        "status": job.status,
        "total_chunks": job.total_chunks,
        "processed_chunks": job.processed_chunks,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }


# ── Chunking Strategy (Phase 2) ────────────────────────────────────────────
def chunk_text(text: str, kb_type: str = "general") -> list[str]:
    """Phase 2: Chunking với overlap theo loại KB.
    - general/policy: RecursiveCharacterTextSplitter với overlap
    - faq: giữ nguyên khối Q&A (split theo 2 newlines)
    - Tabular (pricing): caller xử lý riêng row-by-row, không gọi hàm này
    """
    if not _HAS_LANGCHAIN:
        # Fallback: word-based chunking cũ có partial overlap
        words = text.split()
        size, overlap = 150, 20
        chunks = []
        i = 0
        while i < len(words):
            chunks.append(" ".join(words[i:i + size]))
            i += size - overlap
        return [c for c in chunks if c.strip()]

    if kb_type == "faq":
        # FAQ: split theo Q&A pair (double newline)
        parts = [p.strip() for p in text.split("\n\n") if p.strip()]
        return parts if parts else [text]

    if kb_type == "policy":
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=800, chunk_overlap=150,
            separators=["\n\n", "\n", ".", "!", "?", ",", " "],
        )
    else:  # general, default
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=600, chunk_overlap=100,
            separators=["\n\n", "\n", ".", "!", "?", ",", " "],
        )
    return splitter.split_text(text)


# ── File Extraction (tabular-aware) ───────────────────────────────────────
def extract_text(file_bytes: bytes, filename: str) -> str | list[str]:
    """Extract text từ file. Với tabular data (XLSX/CSV) trả về list[str] để 1 row = 1 doc."""
    name_lower = filename.lower()

    if name_lower.endswith(".pdf"):
        try:
            import pdfplumber
            pages_data = []
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for page_num, page in enumerate(pdf.pages, start=1):
                    page_text = page.extract_text()
                    if page_text:
                        pages_data.append({"text": page_text, "page": page_num})
            # Trả về list dict nếu là pdf, chứa text và page_num
            return pages_data
        except Exception as e:
            raise HTTPException(500, f"Failed to parse PDF: {e}")

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
                            row_text = ", ".join(f"{h}: {v}" for h, v in zip(headers, row_vals) if v)
                        else:
                            row_text = ", ".join(v for v in row_vals if v)
                        if row_text.strip():
                            rows_text.append(row_text)
            return rows_text  # list[str] — 1 row = 1 doc
        except Exception as e:
            raise HTTPException(500, f"Failed to parse XLSX: {e}")

    elif name_lower.endswith(".csv"):
        try:
            import pandas as pd
            df = pd.read_csv(io.BytesIO(file_bytes))
            rows_text = []
            for _, row in df.iterrows():
                row_text = ", ".join(f"{col}: {val}" for col, val in row.items() if str(val).strip())
                if row_text.strip():
                    rows_text.append(row_text)
            return rows_text  # list[str] — 1 row = 1 doc
        except Exception as e:
            raise HTTPException(500, f"Failed to parse CSV: {e}")

    elif name_lower.endswith(".json"):
        try:
            data = json.loads(file_bytes.decode("utf-8"))
            return json.dumps(data, ensure_ascii=False, indent=2)
        except Exception as e:
            raise HTTPException(500, f"Failed to parse JSON: {e}")

    else:
        return file_bytes.decode("utf-8", errors="ignore")


# ── Background Task Logic (ALL phases applied) ─────────────────────────────
async def process_kb_ingestion(job_id: str, collection: str, files_meta: list[dict]):
    """
    Background task với tất cả cải tiến:
    - Phase 1: DB session leak fix — 1 try/finally bao toàn bộ
    - Phase 2: Dedup bằng filename hash, chunking overlap, rich metadata
    - Phase 3: Đọc từ tmp path, structured logging
    """
    start = time.time()
    logger.info("KB ingestion started | job=%s files=%d", job_id, len(files_meta))

    db = SessionLocal()
    job = None
    try:
        # Phase 1: Query bên trong try để session không leak
        job = db.query(KBJob).filter_by(id=job_id).first()
        if not job:
            logger.warning("KB job not found | job=%s", job_id)
            return

        job.status = "processing"
        db.commit()

        total_uploaded = 0
        bm25_new_docs: list[dict] = []  # Collect docs for BM25 index

        for meta in files_meta:
            # Cooperative cancellation: re-read status from DB before each file
            db.refresh(job)
            if job.status == "cancelled":
                logger.info("KB job cancelled by user | job=%s", job_id)
                return

            filename = meta["filename"]
            tmp_path = meta.get("tmp_path")

            # Phase 3: Đọc từ tmp file, không giữ bytes in-memory
            if tmp_path and os.path.exists(tmp_path):
                with open(tmp_path, "rb") as f:
                    content = f.read()
            else:
                content = meta.get("content", b"")

            if not content:
                logger.warning("Empty content for file=%s job=%s", filename, job_id)
                continue

            # Phase 2: Compute file hash để dedup
            f_hash = file_hash(content)

            # Skip unchanged files
            existing = db.query(KBJob).filter_by(
                customer_id=job.customer_id,
                filename=filename,
                status="completed",
                file_hash=f_hash
            ).first()
            if existing:
                logger.info("Skip unchanged file | file=%s hash=%s", filename, f_hash[:8])
                total_uploaded += existing.processed_chunks or 0
                job.total_chunks += existing.total_chunks or 0
                job.processed_chunks += existing.processed_chunks or 0
                db.commit()
                continue

            # Xóa vector cũ cùng filename trước khi ingest lại (dedup)
            try:
                delete_by_filename(collection, filename)
                logger.info("Deleted old vectors | collection=%s filename=%s", collection, filename)
            except Exception:
                pass  # Bỏ qua nếu chưa có vector cũ

            # Xác định loại KB
            kb_type = "general"
            name_lower = filename.lower()
            if any(x in name_lower for x in ["price", "gia", "bảng giá", "pricing", "bang_gia"]):
                kb_type = "pricing"
            elif any(x in name_lower for x in ["faq", "support", "hoi_dap"]):
                kb_type = "faq"
            elif any(x in name_lower for x in ["policy", "terms", "điều khoản", "quy_dinh"]):
                kb_type = "policy"

            # Extract
            extracted = extract_text(content, filename)
            
            # Phân biệt rõ Tabular (list[str]) với PDF (list[dict])
            if isinstance(extracted, list) and (len(extracted) == 0 or isinstance(extracted[0], str)):
                is_tabular = True
            else:
                is_tabular = False

            # Phase 2: Chunking strategy theo loại
            ingested_at = datetime.now(timezone.utc).isoformat()

            if is_tabular:
                # Tabular: 1 row = 1 document, không chunk
                rows: list[str] = extracted
                job.total_chunks += len(rows)
                db.commit()

                docs = [{
                    "content": row,
                    "metadata": {
                        "filename": filename,
                        "type": "pricing" if kb_type == "pricing" else "tabular",
                        "kb_type": "static",
                        "customer_id": job.customer_id,
                        "row_index": i,
                        "total_rows": len(rows),
                        "file_hash": f_hash,
                        "ingested_at": ingested_at,
                        "job_id": job_id,
                        "language": detect_language(row),
                    }
                } for i, row in enumerate(rows)]

            else:
                # Text / PDF: chunk với overlap
                docs = []
                # Handle PDF pages_data (list of dict)
                if isinstance(extracted, list) and len(extracted) > 0 and isinstance(extracted[0], dict):
                    pages_data = extracted
                    total_chunks_in_file = 0
                    
                    for page_data in pages_data:
                        text = page_data["text"]
                        page_num = page_data["page"]
                        chunks = chunk_text(text, kb_type)
                        
                        lang = detect_language(text[:500])
                        for i, chunk in enumerate(chunks):
                            docs.append({
                                "content": chunk,
                                "metadata": {
                                    "filename": filename,
                                    "type": kb_type,
                                    "kb_type": "static",
                                    "customer_id": job.customer_id,
                                    "chunk_index": total_chunks_in_file + i,
                                    "file_hash": f_hash,
                                    "ingested_at": ingested_at,
                                    "job_id": job_id,
                                    "language": lang,
                                    "source_page": page_num,  # Track page
                                }
                            })
                        total_chunks_in_file += len(chunks)
                    
                    # Update total chunks to docs metadata
                    for doc in docs:
                        doc["metadata"]["total_chunks"] = total_chunks_in_file
                        
                    job.total_chunks += total_chunks_in_file
                    db.commit()
                    
                else:
                    # Normal text string
                    text: str = extracted if isinstance(extracted, str) else "\n".join(extracted)
                    chunks = chunk_text(text, kb_type)
                    job.total_chunks += len(chunks)
                    db.commit()

                    lang = detect_language(text[:500])
                    docs = [{
                        "content": chunk,
                        "metadata": {
                            "filename": filename,
                            "type": kb_type,
                            "kb_type": "static",
                            "customer_id": job.customer_id,
                            "chunk_index": i,
                            "total_chunks": len(chunks),
                            "file_hash": f_hash,
                            "ingested_at": ingested_at,
                            "job_id": job_id,
                            "language": lang,
                        }
                    } for i, chunk in enumerate(chunks)]

            # Ingest vào Qdrant — ingest() trả về số point, BM25 track bằng content
            ingested_ids = ingest_with_ids(collection, docs)
            count = len(ingested_ids)
            total_uploaded += count
            job.processed_chunks += count
            db.commit()

            # Collect cho BM25 (dùng chunk gốc, trước contextualize nếu có)
            for doc_entry, pt_id in zip(docs, ingested_ids):
                bm25_new_docs.append({"id": pt_id, "content": doc_entry["content"]})

            logger.info(
                "File ingested | job=%s file=%s chunks=%d type=%s",
                job_id, filename, count, kb_type
            )

        job.status = "completed"
        db.commit()

        # ── Build / update BM25 index sau khi in ingest xong toàn bộ files ─────────
        if bm25_new_docs:
            try:
                bm25_store = get_bm25_store(collection)
                bm25_store.add_documents(bm25_new_docs)
                save_bm25_store(bm25_store, collection)
                logger.info("BM25 index updated | job=%s new_docs=%d total=%d", job_id, len(bm25_new_docs), len(bm25_store))
            except Exception as bm25_err:
                # BM25 lỗi không ảnh hưởng ingestion chính
                logger.warning("BM25 index update failed | job=%s error=%s", job_id, bm25_err)

        elapsed = time.time() - start
        logger.info(
            "KB ingestion completed | job=%s total_chunks=%d elapsed=%.2fs",
            job_id, total_uploaded, elapsed
        )

    except Exception as e:
        if job:
            job.status = "failed"
            job.error_message = str(e)[:500]
            db.commit()
        elapsed = time.time() - start
        logger.error(
            "KB ingestion failed | job=%s error=%s elapsed=%.2fs",
            job_id, str(e), elapsed, exc_info=True
        )

    finally:
        # Phase 1: Đảm bảo session luôn được đóng dù có exception hay không
        db.close()

        # Phase 3: Dọn tmp files
        for meta in files_meta:
            tmp_path = meta.get("tmp_path")
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass


# ── Upload file (Static KB) ────────────────────────────────────────────────
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024   # 10 MB per file
MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB total
MAX_FILES_COUNT = 10

ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf", ".xlsx", ".xls", ".csv", ".json"}

@router.post("/upload", tags=["Knowledge Base (Client)"])
async def upload_kb(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    x_api_key: str = Header(...)
):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    if len(files) > MAX_FILES_COUNT:
        raise HTTPException(400, f"Too many files. Maximum {MAX_FILES_COUNT} files per upload.")

    job_id = str(uuid.uuid4())
    files_meta = []
    total_size = 0

    for file in files:
        # Validate extension
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(400, f"File extension '{ext}' not allowed.")

        content = await file.read()
        file_size = len(content)

        if file_size > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                413,
                f"File '{file.filename}' too large ({file_size // 1024}KB). Maximum 10MB per file."
            )
        total_size += file_size
        if total_size > MAX_TOTAL_SIZE_BYTES:
            raise HTTPException(413, "Total upload size exceeds 50MB limit.")

        # Phase 1: Validate MIME type thật
        validate_file_mime(content, file.filename)

        # Phase 3: Ghi ra /tmp thay vì giữ bytes in-memory
        try:
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            tmp.write(content)
            tmp.close()
            files_meta.append({"filename": file.filename, "tmp_path": tmp.name})
        except Exception:
            # Fallback: dùng content nếu không ghi được tmp
            files_meta.append({"filename": file.filename, "content": content, "tmp_path": None})

    # Create Job entry
    db = SessionLocal()
    new_job = KBJob(
        id=job_id,
        customer_id=customer.id,
        filename=", ".join([m["filename"] for m in files_meta]),
        status="pending"
    )
    db.add(new_job)
    db.commit()
    db.close()

    # Start background task
    background_tasks.add_task(process_kb_ingestion, job_id, customer.qdrant_collection, files_meta)

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Upload started in background",
        "files_count": len(files)
    }


# ── Job Status Endpoints ───────────────────────────────────────────────────
@router.get("/jobs")
def list_jobs(x_api_key: str = Header(...)):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)

    db = SessionLocal()
    jobs = db.query(KBJob).filter_by(customer_id=customer.id).order_by(KBJob.created_at.desc()).limit(20).all()
    result = [job_to_dict(j) for j in jobs]
    db.close()
    return result


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str, x_api_key: str = Header(...)):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)

    db = SessionLocal()
    job = db.query(KBJob).filter_by(id=job_id, customer_id=customer.id).first()
    if not job:
        db.close()
        raise HTTPException(404, "Job not found")
    result = job_to_dict(job)
    db.close()
    return result


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, x_api_key: str = Header(...)):
    """Soft-cancel a pending/processing job. Background task will stop at next file boundary."""
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)

    db = SessionLocal()
    job = db.query(KBJob).filter_by(id=job_id, customer_id=customer.id).first()
    if not job:
        db.close()
        raise HTTPException(404, "Job not found")

    if job.status not in ("pending", "processing"):
        db.close()
        raise HTTPException(400, f"Cannot cancel job with status '{job.status}'")

    job.status = "cancelled"
    db.commit()
    result = job_to_dict(job)
    db.close()
    logger.info("KB job cancel requested | job=%s", job_id)
    return result


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str, x_api_key: str = Header(...)):
    """Delete a KB job record (any status). If still running, marks cancelled first."""
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)

    db = SessionLocal()
    job = db.query(KBJob).filter_by(id=job_id, customer_id=customer.id).first()
    if not job:
        db.close()
        raise HTTPException(404, "Job not found")

    # If still active, mark cancelled so background task can exit cleanly
    if job.status in ("pending", "processing"):
        job.status = "cancelled"
        db.commit()

    db.delete(job)
    db.commit()
    db.close()
    logger.info("KB job deleted | job=%s", job_id)
    return {"status": "deleted", "job_id": job_id}


# ── Upload JSON (Static KB) ────────────────────────────────────────────────
@router.post("/upload/json")
async def upload_json_kb(data: dict, x_api_key: str = Header(...)):
    """Upload KB dạng JSON — tiện cho bảng giá có cấu trúc"""
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401)

    items = data.get("items", [])
    docs = [{
        "content": json.dumps(item, ensure_ascii=False),
        "metadata": {
            "type": data.get("type", "product"),
            "customer_id": customer.id,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }
    } for item in items]

    total = ingest(customer.qdrant_collection, docs)
    return {"uploaded_chunks": total}


# ── Upload Realtime KB (bảng giá, flash sale, ưu đãi) ────────────────────
@router.post("/upload/realtime")
async def upload_realtime_kb(data: dict, x_api_key: str = Header(...)):
    """
    Upload Realtime KB chunks với đầy đủ TTL metadata.
    Body:
    {
        "chunks": [
            {
                "content": "iPhone 16 Pro: 29.990.000đ",
                "source_id": "price_iphone16_pro",
                "category": "pricing",
                "valid_from": "2025-01-01T00:00:00Z",
                "valid_to": "2025-12-31T23:59:59Z",
                "ttl_minutes": 15
            }
        ]
    }
    """
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    raw_chunks = data.get("chunks", [])
    if not raw_chunks:
        raise HTTPException(400, "No chunks provided")

    now_iso = datetime.now(timezone.utc).isoformat()
    prepared = []
    for c in raw_chunks:
        if not c.get("content") or not c.get("source_id"):
            raise HTTPException(400, "Each chunk must have 'content' and 'source_id'")
        prepared.append({
            "content": c["content"],
            "metadata": {
                "source_id": c["source_id"],
                "category": c.get("category", "general"),
                "valid_from": c.get("valid_from") or now_iso,
                "valid_to": c.get("valid_to"),
                "ttl_minutes": c.get("ttl_minutes", 60),
                "version": c.get("version", 1),
                "customer_id": customer.id,
            }
        })

    count = ingest_realtime(customer.qdrant_collection, prepared)
    return {"uploaded_chunks": count, "mode": "realtime"}


# ── Expire realtime chunk ─────────────────────────────────────────────────
@router.delete("/realtime/{source_id}")
async def expire_realtime_kb(
    source_id: str,
    x_api_key: str = Header(...)
):
    """(Cân nhắc dùng API riêng) Soft delete một TTL chunk"""
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    try:
        from services.rag import soft_delete_point
        success = soft_delete_point(customer.qdrant_collection, source_id)
        if not success:
            raise HTTPException(404, "Source ID not found")
        return {"status": "success", "source_id": source_id}
    except Exception as e:
        logger.error("Expire realtime KB error: %s", e)
        raise HTTPException(500, "Internal Server Error")


@router.post("/realtime/invalidate")
async def invalidate_realtime(
    data: dict, 
    x_api_key: str = Header(...)
):
    """
    Xoá cache Redis của 1 Category cụ thể (vd: pricing, promotion) để LLM lấy lại data mới từ vector DB.
    Ví dụ payload: {"category": "pricing"}
    """
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")
    
    category = data.get("category")
    if not category:
        raise HTTPException(400, "Missing 'category' in payload")

    from services.cache import invalidate_by_category
    try:
        invalidate_by_category(customer.qdrant_collection, category)
        return {"status": "invalidated", "category": category}
    except Exception as e:
        logger.error("Invalidate category cache error: %s", e)
        raise HTTPException(500, str(e))
