import httpx, os
from sqlalchemy import create_engine, text

engine = create_engine(os.getenv("DATABASE_URL"))

tools = [
    {
        "type": "function",
        "function": {
            "name": "check_domain_availability",
            "description": "Kiểm tra domain có available không và giá",
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "tên domain, vd: example.com"}
                },
                "required": ["domain"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_pricing",
            "description": "Lấy bảng giá domain, hosting, VPS",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_type": {
                        "type": "string",
                        "enum": ["domain", "hosting", "vps"]
                    }
                },
                "required": ["product_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "whois_lookup",
            "description": "Tra cứu thông tin whois của domain",
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string"}
                },
                "required": ["domain"]
            }
        }
    }
]

async def execute_tool(name: str, args: dict, tenant_id: str) -> str:
    if name == "check_domain_availability":
        # Query DomainDB
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT available, price FROM domains WHERE name = :d"),
                {"d": args["domain"]}
            ).fetchone()
        if result:
            status = "available ✅" if result.available else "đã có người đăng ký ❌"
            return f"Domain {args['domain']}: {status}, giá: {result.price:,}đ/năm"
        return f"Không tìm thấy thông tin cho {args['domain']}"

    elif name == "get_pricing":
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT name, price, description FROM pricing WHERE type = :t AND tenant_id = :tid"),
                {"t": args["product_type"], "tid": tenant_id}
            ).fetchall()
        if rows:
            return "\n".join([f"• {r.name}: {r.price:,}đ — {r.description}" for r in rows])
        return "Không có dữ liệu giá"

    elif name == "whois_lookup":
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"https://api.whoisfreaks.com/v1.0/whois",
                params={"apiKey": os.getenv("WHOIS_API_KEY"), "whois": "live", "domainName": args["domain"]}
            )
        data = res.json()
        return f"Registrar: {data.get('registrar_name', 'N/A')}, Expires: {data.get('expiry_date', 'N/A')}"

    return "Tool không tồn tại"