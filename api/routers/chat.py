from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from models.tenant import get_customer_by_key, SessionLocal, Customer
from services.rag import search
from services.llm import get_client
from services.mcp import tools, execute_tool
import json

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
        # 2. Gọi LLM với tools (MCP)
        response = client.chat.completions.create(
            model=customer.llm_model or default_model,
            messages=[{"role": "system", "content": system_prompt}, *messages],
            tools=tools,
            stream=False,   # cần check tool_calls trước khi stream
            max_tokens=800
        )

        msg = response.choices[0].message

        # 3. Nếu LLM muốn gọi tool
        if msg.tool_calls:
            tool_results = []
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                result = await execute_tool(tc.function.name, args, customer.id)
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