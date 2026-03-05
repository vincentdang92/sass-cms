import { streamText, tool, jsonSchema } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

const apiUrl = process.env.CHATBOT_API_URL || 'http://localhost:8000'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { messages, apiKey, id } = await req.json()

  // 1. Lấy customer config
  const configRes = await fetch(`${apiUrl}/admin/customers/me`, {
    headers: { 'x-api-key': apiKey },
  })
  if (!configRes.ok) {
    return Response.json({ error: 'Invalid API key' }, { status: 401 })
  }
  const config = await configRes.json()

  // 2. Lấy KB context
  const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user')
  let kbContext = ''
  if (lastUserMsg) {
    const ragRes = await fetch(
      `${apiUrl}/rag/search?q=${encodeURIComponent(lastUserMsg.content)}&top_k=5`,
      { headers: { 'x-api-key': apiKey } }
    )
    if (ragRes.ok) {
      const ragData = await ragRes.json()
      kbContext = ragData.context?.join('\n\n') || ''
    }
  }

  // 3. Setup DeepSeek
  const deepseek = createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseURL: 'https://api.deepseek.com/v1',
  })

  const systemPrompt = `${config.system_prompt}

=== Thông tin từ Knowledge Base ===
${kbContext || 'Không có thông tin liên quan trong KB.'}
===================================

Khi khách hỏi giá → gọi tool showPricing.
Khi khách mua/đặt hàng → gọi tool showBuyForm.
Khi cần hỗ trợ nội bộ → gọi tool showSupportTicket.
Khi cuộc trò chuyện kết thúc hoặc đã giải quyết xong → gọi tool showRating.
Nếu khách có yêu cầu chức năng khác, kiểm tra các tool được cung cấp bởi hệ thống mở rộng (Nếu có).
Trả lời bằng tiếng Việt, ngắn gọn, thân thiện.`

  // 3.5 Lấy Dynamic Tools từ MCP Server của khách hàng (Nếu có cấu hình)
  const mcpTools: Record<string, any> = {}
  if (config.mcp_server_url) {
    try {
      const headers: Record<string, string> = {}
      if (config.mcp_auth_token) {
        // Assume bearer token if not explicitly formatted
        const isBearer = config.mcp_auth_token.toLowerCase().startsWith('bearer')
        headers['Authorization'] = isBearer ? config.mcp_auth_token : `Bearer ${config.mcp_auth_token}`
      }

      const toolsRes = await fetch(`${config.mcp_server_url}/tools`, { headers })
      if (toolsRes.ok) {
        const data = await toolsRes.json()
        if (data.tools && Array.isArray(data.tools)) {
          for (const t of data.tools) {
            const funcDef = t.function || t // Handle both raw schemas and OpenAI schemas
            const name = funcDef.name

            mcpTools[name] = tool({
              description: funcDef.description || `Dynamic tool: ${name}`,
              parameters: jsonSchema(funcDef.parameters),
              execute: async (args) => {
                try {
                  const exRes = await fetch(`${config.mcp_server_url}/execute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({ tool: name, arguments: args })
                  })
                  if (!exRes.ok) return { error: `MCP Server Error: ${exRes.statusText}` }
                  return await exRes.json()
                } catch (e: any) {
                  return { error: 'Failed to execute MCP tool', detail: e.message }
                }
              }
            })
          }
        }
      } else {
        console.error('Failed to fetch MCP tools:', toolsRes.status, toolsRes.statusText)
      }
    } catch (e) {
      console.error('Failed to connect to MCP server:', e)
    }
  }

  // 4. streamText với tools (Client-side rendering)
  const result = await streamText({
    model: deepseek(config.llm_model || 'deepseek-chat') as any,
    system: systemPrompt,
    messages,
    tools: {
      ...mcpTools, // Inject các MCP tools từ tenant
      showPricing: tool({
        description: 'Hiển thị bảng giá sản phẩm',
        parameters: z.object({
          category: z.enum(['domain', 'hosting', 'vps']).describe('Loại sản phẩm'),
          items: z.array(z.object({
            name: z.string(),
            price: z.number(),
            unit: z.string().default('năm'),
            highlight: z.boolean().optional(),
          })),
        }),
        execute: async (args) => args,
      }),
      showBuyForm: tool({
        description: 'Form mua hàng',
        parameters: z.object({
          product: z.string(),
          amount: z.number(),
        }),
        execute: async (args) => args,
      }),
      showSupportTicket: tool({
        description: 'Form hỗ trợ kỹ thuật',
        parameters: z.object({
          suggestedTitle: z.string().optional(),
        }),
        execute: async (args) => args,
      }),
      showRating: tool({
        description: 'Widget đánh giá',
        parameters: z.object({
          message: z.string().optional(),
        }),
        execute: async (args) => args,
      }),
    },
    onFinish: async ({ text, toolCalls, toolResults }) => {
      try {
        const sessionId = id || crypto.randomUUID()
        // Save only the new exchange: last user message + new assistant reply
        const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')
        const newMessages: any[] = []

        if (lastUser) {
          newMessages.push({ id: lastUser.id || crypto.randomUUID(), role: 'user', content: lastUser.content })
        }
        newMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: text,
          tool_calls: (toolCalls || []).length > 0 ? toolCalls : undefined,
        })
        if (toolResults && toolResults.length > 0) {
          for (const tr of toolResults) {
            newMessages.push({ id: crypto.randomUUID(), role: 'tool', content: JSON.stringify(tr.result), tool_call_id: tr.toolCallId })
          }
        }

        const saveRes = await fetch(`${apiUrl}/chat/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ session_id: sessionId, messages: newMessages }),
        })
        if (!saveRes.ok) {
          const err = await saveRes.text()
          console.error('[chat history save failed]', saveRes.status, err)
        }
      } catch (err) {
        console.error('Failed to save chat history', err)
      }
    },
  })

  return result.toDataStreamResponse()
}