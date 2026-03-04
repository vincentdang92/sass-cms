'use client'
import { useState, useEffect, useRef } from 'react'

interface Message { role: 'user' | 'assistant'; content: string }

export default function Widget() {
  const [apiKey, setApiKey] = useState('')
  const [botName, setBotName] = useState('AI Tư Vấn')
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Xin chào! Tôi có thể giúp gì cho bạn về domain và hosting hôm nay?' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Đọc params phía client (tránh SSR error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setApiKey(params.get('key') || '')
    setBotName(params.get('name') || 'AI Tư Vấn')
  }, [])

  // Auto scroll xuống cuối
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input, history: messages, apiKey })
    })

    if (!res.ok) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Có lỗi xảy ra, vui lòng thử lại sau.' }])
      setLoading(false)
      return
    }

    const reader = res.body!.getReader()
    let text = ''
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = new TextDecoder().decode(value).split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') break
        try { text += JSON.parse(data).text } catch { }
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: text }])
      }
    }
    setLoading(false)
  }

  return (
    <div className="widget-root">
      {/* Header */}
      <div className="widget-header">
        <div className="bot-avatar">🤖</div>
        <div>
          <div className="bot-name">{botName}</div>
          <div className="bot-status">
            <span className="status-dot" />
            Trực tuyến
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.map((m, i) => (
          <div key={i} className={`message-row ${m.role}`}>
            {m.role === 'assistant' && <div className="avatar-sm">🤖</div>}
            <div className={`bubble ${m.role}`}>
              {m.content || <span className="typing-dots"><span /><span /><span /></span>}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.content === '' && null}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="input-area">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Hỏi về domain, hosting, VPS..."
          disabled={loading}
          className="chat-input"
        />
        <button onClick={send} disabled={loading || !input.trim()} className="send-btn">
          {loading ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}