import { createDataStreamResponse, streamText } from 'ai'

export async function POST(req: Request) {
  const { message, history, apiKey } = await req.json()

  const upstream = await fetch(`${process.env.API_URL}/chat/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({ message, history })
  })

  if (!upstream.ok) {
    const err = await upstream.json()
    return Response.json({ error: err.detail }, { status: upstream.status })
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  })
}