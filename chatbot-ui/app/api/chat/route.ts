import { streamText, tool } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

const apiUrl = process.env.CHATBOT_API_URL || 'http://localhost:8000'

export const runtime = 'edge'

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
Khi hỏi domain cụ thể → gọi tool showDomainResult.
Khi cần hỗ trợ/ticket → gọi tool showSupportTicket.
Khi cuộc trò chuyện kết thúc hoặc đã giải quyết xong → gọi tool showRating.
Trả lời bằng tiếng Việt, ngắn gọn, thân thiện.`

  // 4. streamText với tools (Client-side rendering)
  const result = await streamText({
    model: deepseek(config.llm_model || 'deepseek-chat') as any,
    system: systemPrompt,
    messages,
    tools: {
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
      showDomainResult: tool({
        description: 'Kết quả kiểm tra domain',
        parameters: z.object({
          domain: z.string(),
          available: z.boolean(),
          price: z.number().optional(),
          registrar: z.string().optional(),
          expires: z.string().optional(),
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
        // Prepare the new messages payload for the history endpoint
        const fullMessages = [
          ...messages, // Previous messages + latest user message
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: text,
            tool_calls: (toolCalls || []).length > 0 ? toolCalls : undefined
          }
        ]

        // Add tool results if any
        if (toolResults && toolResults.length > 0) {
          for (const tr of toolResults) {
            fullMessages.push({
              id: crypto.randomUUID(),
              role: 'tool',
              content: JSON.stringify(tr.result),
              tool_call_id: tr.toolCallId
            })
          }
        }

        // Send to FastAPI to save
        await fetch(`${apiUrl}/chat/history`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            session_id: id, // The chat session ID from useChat
            messages: fullMessages,
          }),
        })
      } catch (err) {
        console.error('Failed to save chat history', err)
      }
    },
  })

  return result.toDataStreamResponse()
}