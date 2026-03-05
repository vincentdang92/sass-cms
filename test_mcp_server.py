from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import uvicorn
import httpx
import os
from typing import Optional

app = FastAPI(title="Mock Tenant MCP Server")

# Giả lập token bảo mật của tenant này
VALID_TOKEN = "secret-tenant-token-123"

def verify_token(authorization: Optional[str] = Header(None)):
    if not authorization or authorization != f"Bearer {VALID_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized MCP access")

class ExecuteRequest(BaseModel):
    tool: str
    arguments: dict

@app.get("/tools")
def get_tools(authorization: Optional[str] = Header(None)):
    verify_token(authorization)
    return {
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "check_whois",
                    "description": "Tra cứu thông tin tên miền (tên nhà đăng ký, ngày hết hạn)",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {"type": "string", "description": "Tên miền cần tra cứu (vd: vnexpress.net)"}
                        },
                        "required": ["domain"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "create_support_ticket",
                    "description": "Tạo ticket hỗ trợ kỹ thuật khi khách hàng báo lỗi hệ thống, rớt mạng, sự cố",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "customer_email": {"type": "string", "description": "Email liên hệ của khách"},
                            "issue_title": {"type": "string", "description": "Tiêu đề ngắn gọn của sự cố"},
                            "description": {"type": "string", "description": "Mô tả chi tiết sự cố theo lời khách kể"}
                        },
                        "required": ["issue_title", "description"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "check_product_stock",
                    "description": "Kiểm tra kho hàng xem một sản phẩm còn hàng không",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "product_name": {"type": "string", "description": "Tên sản phẩm khách hỏi"}
                        },
                        "required": ["product_name"]
                    }
                }
            }
        ]
    }

@app.post("/execute")
async def execute_tool(req: ExecuteRequest, authorization: Optional[str] = Header(None)):
    verify_token(authorization)
    tool = req.tool
    args = req.arguments

    if tool == "check_whois":
        domain = args.get("domain")
        # Gọi thử whois thật (sandbox) hoặc mock
        # Ở đây mock kết quả cho nhanh:
        if "google" in domain.lower():
            return {"status": "success", "result": f"Domain {domain} đã được Oracle đăng ký. Hết hạn 2028-09-09."}
        return {"status": "success", "result": f"Domain {domain} chưa ai đăng ký! Có thể mua với giá 300,000đ/năm."}

    elif tool == "create_support_ticket":
        title = args.get("issue_title")
        email = args.get("customer_email", "khach-vang-lai@email.com")
        ticket_id = f"T100{len(title)}"
        return {
            "status": "success", 
            "result": f"Đã tạo Ticket mã #{ticket_id}. Bộ phận kỹ thuật sẽ liên hệ qua email {email} trong vòng 30 phút."
        }

    elif tool == "check_product_stock":
        prod = args.get("product_name").lower()
        if "iphone" in prod:
            return {"status": "success", "result": "Còn 5 máy iPhone tại kho Quận 1."}
        return {"status": "success", "result": f"Sản phẩm '{prod}' hiện đang hết hàng, dự kiến 7 ngày nữa dọn kho."}

    return {"status": "error", "result": f"Tool '{tool}' không được hỗ trợ bởi Server này."}

if __name__ == "__main__":
    print("Khởi động Mock MCP Server cho Tenant tại cổng 8002...")
    print(f"URL: http://127.0.0.1:8002")
    print(f"Token: Bearer {VALID_TOKEN}")
    uvicorn.run(app, host="0.0.0.0", port=8002)
