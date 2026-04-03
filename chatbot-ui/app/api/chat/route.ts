import { streamText, tool, jsonSchema, convertToModelMessages, type UIMessage } from 'ai'
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
  const lastUserMsg = [...messages].reverse().find((m: UIMessage) => m.role === 'user')
  let kbContext = ''
  let kbFound = false
  if (lastUserMsg) {
    const userText = lastUserMsg.parts
      ?.filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join(' ') || ''
    if (userText) {
      try {
        const ragRes = await fetch(
          `${apiUrl}/rag/search?q=${encodeURIComponent(userText)}&top_k=8`,
          { headers: { 'x-api-key': apiKey } }
        )
        if (ragRes.ok) {
          const ragData = await ragRes.json()
          const chunks: string[] = ragData.context || []
          if (chunks.length > 0) {
            kbContext = chunks.join('\n\n---\n\n')
            kbFound = true
            console.log(`[RAG] Found ${chunks.length} KB chunks for query:`, userText.slice(0, 80))
          } else {
            console.log('[RAG] No KB chunks found for query:', userText.slice(0, 80))
          }
        } else {
          console.error('[RAG] Search failed:', ragRes.status)
        }
      } catch (e) {
        console.error('[RAG] Fetch error:', e)
      }
    }
  }

  // 3. Setup DeepSeek
  const deepseek = createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseURL: 'https://api.deepseek.com/v1',
  })

  // system_prompt là ngữ cảnh chính của tenant. Ta chỉ append format rule và KB context.
  const systemPrompt = `${config.system_prompt || 'Bạn là trợ lý AI thông minh hỗ trợ khách hàng.'}
(Lĩnh vực hoạt động của doanh nghiệp này: ${config.industry || 'Tổng hợp'})

=== KNOWLEDGE BASE (Nội dung do doanh nghiệp cung cấp) ===
${kbFound
  ? kbContext
  : '[KB TRỐNG] Không tìm thấy thông tin nào trong Knowledge Base liên quan đến câu hỏi này.'
}
================================================

[QUY TẮc BẮt BUỘC DÀNH CHO AI - KHAI BÁO NGHIEM KHẮc]:
1. Đọc kỹ nội dung trong phần KNOWLEDGE BASE ở trên trước khi trả lời.
2. CHỈ trả lời những thông tin được ghi rõ trong Knowledge Base. KHÔNG TỰ SUY DIỄN, KHÔNG ĐOÁN MÒ.
3. Nếu Knowledge Base trống hoặc không có thông tin liên quan: Hãy nói thẳng "Xin lỗi, mình chưa có thông tin về vấn đề này trong cơ sở kiến thức. Bạn có thể liên hệ trực tiếp để được hỗ trợ không?".
4. Có thể sử dụng các "Tools" UI được cung cấp (showPricing, showBuyForm, showSupportTicket...) khi có dữ liệu tương ứng trong KB.
5. Trả lời bằng tiếng Việt, ngắn gọn, thân thiện, lịch sự.`


  // 3.5 Lấy Dynamic Tools từ MCP Server của khách hàng (Nếu có cấu hình)
  const MCP_TIMEOUT_MS = 10_000          // 10 seconds hard timeout
  const MCP_MAX_RESPONSE_BYTES = 512_000 // 512 KB response limit

  const mcpTools: Record<string, any> = {}
  if (config.mcp_server_url) {
    try {
      const headers: Record<string, string> = {}
      if (config.mcp_auth_token) {
        const isBearer = config.mcp_auth_token.toLowerCase().startsWith('bearer')
        headers['Authorization'] = isBearer ? config.mcp_auth_token : `Bearer ${config.mcp_auth_token}`
      }

      // Fetch /tools with timeout
      const toolsController = new AbortController()
      const toolsTimer = setTimeout(() => toolsController.abort(), MCP_TIMEOUT_MS)
      const toolsRes = await fetch(`${config.mcp_server_url}/tools`, {
        headers,
        signal: toolsController.signal,
      }).finally(() => clearTimeout(toolsTimer))

      if (toolsRes.ok) {
        const data = await toolsRes.json()
        if (data.tools && Array.isArray(data.tools)) {
          for (const t of data.tools) {
            const funcDef = t.function || t
            const name = funcDef.name

            mcpTools[name] = tool({
              description: funcDef.description || `Dynamic tool: ${name}`,
              inputSchema: jsonSchema(funcDef.parameters),
              execute: async (args: any): Promise<any> => {
                try {
                  const exController = new AbortController()
                  const exTimer = setTimeout(() => exController.abort(), MCP_TIMEOUT_MS)
                  const exRes = await fetch(`${config.mcp_server_url}/execute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({ tool: name, arguments: args }),
                    signal: exController.signal,
                  }).finally(() => clearTimeout(exTimer))

                  if (!exRes.ok) return { error: `MCP Server Error: ${exRes.statusText}` }

                  // Cap response size to prevent DoS via huge payload
                  const contentLength = Number(exRes.headers.get('content-length') || 0)
                  if (contentLength > MCP_MAX_RESPONSE_BYTES) {
                    return { error: 'MCP response too large (>512KB)' }
                  }
                  const text = await exRes.text()
                  if (text.length > MCP_MAX_RESPONSE_BYTES) {
                    return { error: 'MCP response too large (>512KB)' }
                  }
                  return JSON.parse(text)
                } catch (e: any) {
                  if (e.name === 'AbortError') return { error: 'MCP tool timed out (>10s)' }
                  return { error: 'Failed to execute MCP tool', detail: e.message }
                }
              }
            })
          }
        }
      } else {
        console.error('Failed to fetch MCP tools:', toolsRes.status, toolsRes.statusText)
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.error('MCP /tools request timed out (>10s) — skipping MCP tools')
      } else {
        console.error('Failed to connect to MCP server:', e)
      }
      // Graceful degradation: continue chat without MCP tools
    }
  }

  // 4. streamText với tools (Client-side rendering)
  // AI SDK 6.x: frontend gửi UIMessage[] (có parts[]) nhưng streamText yêu cầu ModelMessage[]
  // Dùng ignoreIncompleteToolCalls: true để bỏ qua các client-side tools không có result gửi về
  const modelMessages = await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true })

  // AI SDK 6.x: deepseek('model') dùng Responses API → 404 với DeepSeek
  // Dùng deepseek.chat('model') để force /v1/chat/completions
  const result = await streamText({
    model: deepseek.chat(config.llm_model || 'deepseek-chat'),
    system: systemPrompt,
    messages: modelMessages,
    tools: {
      ...mcpTools, // Inject các MCP tools từ tenant
      showPricing: tool({
        description: 'Hiển thị bảng giá sản phẩm',
        inputSchema: z.object({
          category: z.string().describe('Tên danh mục sản phẩm/dịch vụ (VD: Dịch vụ Nail, Mỹ phẩm, Tên miền...)'),
          items: z.array(z.object({
            name: z.string(),
            price: z.number(),
            unit: z.string().default('năm'),
            highlight: z.boolean().optional(),
          })),
        }),
      }),
      showBuyForm: tool({
        description: 'Form mua hàng',
        inputSchema: z.object({
          product: z.string(),
          amount: z.number(),
        }),
      }),
      showSupportTicket: tool({
        description: 'Form hỗ trợ kỹ thuật',
        inputSchema: z.object({
          suggestedTitle: z.string().optional(),
        }),
      }),
      showRating: tool({
        description: 'Widget đánh giá',
        inputSchema: z.object({
          message: z.string().optional(),
        }),
      }),
    },
    onFinish: async ({ text, toolCalls, toolResults }) => {
      try {
        const sessionId = id || crypto.randomUUID()
        // Save only the new exchange: last user message + new assistant reply
        const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')
        const newMessages: any[] = []

        if (lastUser) {
          const userContent = lastUser.parts
            ?.filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join(' ') || lastUser.content || ''
            
          newMessages.push({ id: lastUser.id || crypto.randomUUID(), role: 'user', content: userContent })
        }
        newMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: text,
          tool_calls: (toolCalls || []).length > 0 ? toolCalls : undefined,
        })
        if (toolResults && toolResults.length > 0) {
          for (const tr of toolResults) {
            newMessages.push({ id: crypto.randomUUID(), role: 'tool', content: JSON.stringify(tr.output), tool_call_id: tr.toolCallId })
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

  return result.toUIMessageStreamResponse()
}