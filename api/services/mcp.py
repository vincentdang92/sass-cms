import httpx
import logging

logger = logging.getLogger(__name__)

async def get_mcp_tools(mcp_url: str, mcp_token: str) -> list:
    """Gọi GET /tools tới MCP Server của KH để lấy danh sách tools"""
    if not mcp_url:
        return []

    headers = {}
    if mcp_token:
        headers["Authorization"] = f"Bearer {mcp_token}"

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            url = mcp_url.rstrip("/") + "/tools"
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            data = res.json()
            # Expecting { "tools": [ { "type": "function", "function": {...} } ] }
            return data.get("tools", [])
        except Exception as e:
            logger.error(f"Lỗi khi gọi {mcp_url}/tools: {str(e)}")
            return []

async def execute_mcp_tool(mcp_url: str, mcp_token: str, tool_name: str, args: dict) -> str:
    """Gọi POST /execute tới MCP Server để thực thi tool"""
    if not mcp_url:
        return "Tenant chưa cấu hình MCP Server URL."

    headers = {"Content-Type": "application/json"}
    if mcp_token:
        headers["Authorization"] = f"Bearer {mcp_token}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            url = mcp_url.rstrip("/") + "/execute"
            payload = {"tool": tool_name, "arguments": args}
            res = await client.post(url, json=payload, headers=headers)
            res.raise_for_status()
            data = res.json()
            
            # MCP có thể trả về { "status": "success", "result": "..." }
            return str(data.get("result", data))
        except httpx.HTTPError as e:
            logger.error(f"Lỗi HTTP khi gọi {tool_name} từ {mcp_url}: {str(e)}")
            return f"❌ Server của tenant trả về lỗi HTTP: {str(e)}"
        except Exception as e:
            logger.error(f"Lỗi không xác định khi execute tool {tool_name}: {str(e)}")
            return f"❌ Lỗi nội bộ chatbot khi gọi tool: {str(e)}"