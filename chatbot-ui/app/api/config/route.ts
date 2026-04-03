import { NextResponse } from 'next/server'

const apiUrl = process.env.CHATBOT_API_URL || 'http://localhost:8000'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const apiKey = searchParams.get('apiKey')

  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API Key' }, { status: 400 })
  }

  try {
    const res = await fetch(`${apiUrl}/admin/customers/me`, {
      headers: { 'x-api-key': apiKey },
      // Optional: Add cache if config doesn't change often, or revalidate
      next: { revalidate: 60 } 
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 })
    }

    const data = await res.json()

    // Parse quick_questions if it's a JSON string
    let quickQuestions = []
    if (data.quick_questions) {
      try {
        quickQuestions = typeof data.quick_questions === 'string' 
          ? JSON.parse(data.quick_questions) 
          : data.quick_questions
      } catch (e) {
        quickQuestions = []
      }
    }

    // Chỉ trả về các trường giao diện Widget cần thiết (Che giấu LLM prompts/models)
    return NextResponse.json({
      bot_name: data.bot_name || 'AI Assistant',
      bot_avatar: data.bot_avatar || '',
      greeting_message: data.greeting_message || 'Xin chào! Mình có thể giúp gì cho bạn?',
      quick_questions: quickQuestions
    })

  } catch (error) {
    console.error('Widget Config Fetch Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
