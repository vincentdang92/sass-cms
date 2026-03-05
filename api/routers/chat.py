from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from models.tenant import get_customer_by_key, SessionLocal, Customer, ChatSession, ChatMessage
from services.rag import search
from services.llm import get_client
from services.mcp import get_mcp_tools, execute_mcp_tool
from pydantic import BaseModel
from typing import List, Optional, Any
import json
import uuid
from datetime import datetime

class MessageSchema(BaseModel):
    id: str
    role: str
    content: str
    tool_calls: Optional[Any] = None
    tool_call_id: Optional[str] = None

class ChatHistorySchema(BaseModel):
    session_id: Optional[str] = None
    messages: List[MessageSchema]


router = APIRouter(prefix="/chat", tags=["Chat"])

@router.post("/")
async def chat(request: dict, x_api_key: str = Header(...)):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    # Rate limit check
    if customer.requests_today >= customer.max_requests_day:
        raise HTTPException(429, "Daily limit reached. Please upgrade your plan.")

    user_message = request.get("message", "")
    history      = request.get("history", [])[-10:]

    # 1. RAG — lấy context từ KB của customer này
    kb_context = search(customer.qdrant_collection, user_message)
    context_text = "\n\n".join(kb_context) if kb_context else "Không có thông tin liên quan."

    system_prompt = f"""{customer.system_prompt}

=== Thông tin từ Knowledge Base ===
{context_text}
===================================

Nếu không có thông tin trong KB, hãy dùng tools để tra cứu thêm.
Trả lời bằng tiếng Việt, ngắn gọn và thân thiện.
"""

    messages = [*history, {"role": "user", "content": user_message}]
    client, default_model = get_client(customer.llm_provider)

    async def generate():
        tenant_tools = await get_mcp_tools(customer.mcp_server_url, customer.mcp_auth_token)

        # 2. Gọi LLM với tools (MCP)
        params = {
            "model": customer.llm_model or default_model,
            "messages": [{"role": "system", "content": system_prompt}, *messages],
            "stream": False,   # cần check tool_calls trước khi stream
            "max_tokens": 800
        }
        if tenant_tools:
            params["tools"] = tenant_tools

        response = client.chat.completions.create(**params)

        msg = response.choices[0].message

        # 3. Nếu LLM muốn gọi tool
        if msg.tool_calls:
            tool_results = []
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                result = await execute_mcp_tool(
                    customer.mcp_server_url, 
                    customer.mcp_auth_token, 
                    tc.function.name, 
                    args
                )
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result
                })

            # Gọi lại LLM với kết quả tool, lần này stream
            final_messages = [
                {"role": "system", "content": system_prompt},
                *messages,
                msg,
                *tool_results
            ]
            stream = client.chat.completions.create(
                model=customer.llm_model or default_model,
                messages=final_messages,
                stream=True,
                max_tokens=800
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'text': delta})}\n\n"
        else:
            # Không có tool call — stream thẳng text
            for chunk in client.chat.completions.create(
                model=customer.llm_model or default_model,
                messages=[{"role": "system", "content": system_prompt}, *messages],
                stream=True,
                max_tokens=800
            ):
                delta = chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'text': delta})}\n\n"

        # 4. Tăng counter usage
        db = SessionLocal()
        db.query(Customer).filter_by(id=customer.id).update(
            {"requests_today": Customer.requests_today + 1}
        )
        db.commit()
        db.close()

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/history")
async def save_chat_history(data: ChatHistorySchema, x_api_key: str = Header(...)):
    customer = get_customer_by_key(x_api_key)
    if not customer:
        raise HTTPException(401, "Invalid API key")

    db = SessionLocal()
    try:
        session_id = data.session_id
        if not session_id:
            session_id = str(uuid.uuid4())
            new_session = ChatSession(
                id=session_id,
                customer_id=customer.id,
                title=f"Chat {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            )
            db.add(new_session)
        else:
            # Update updated_at if session exists
            session = db.query(ChatSession).filter_by(id=session_id, customer_id=customer.id).first()
            if session:
                session.updated_at = datetime.now()
            else:
                # If trying to save to a non-existent session, recreate it
                new_session = ChatSession(
                    id=session_id,
                    customer_id=customer.id,
                    title=f"Chat {datetime.now().strftime('%Y-%m-%d %H:%M')}"
                )
                db.add(new_session)
        
        # Insert messages
        for msg in data.messages:
            tool_calls_str = json.dumps(msg.tool_calls) if msg.tool_calls else None
            
            chat_msg = ChatMessage(
                session_id=session_id,
                role=msg.role,
                content=msg.content,
                tool_calls=tool_calls_str,
                tool_call_id=msg.tool_call_id
            )
            db.add(chat_msg)
            
        db.commit()
        return {"status": "success", "session_id": session_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Error saving chat history: {str(e)}")
    finally:
        db.close()
