'use client'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useChat } from '@ai-sdk/react'
import { useEffect, useRef, useState, useMemo } from 'react'

// Render tools ở Client
import { PricingCard } from '@/components/PricingCard'
import { BuyForm } from '@/components/BuyForm'
import { DomainResult } from '@/components/DomainResult'
import { SupportTicket } from '@/components/SupportTicket'
import { RatingWidget } from '@/components/RatingWidget'
import { LoadingCard } from '@/components/LoadingCard'

export default function Widget() {
  const [apiKey, setApiKey] = useState('')
  const [botName, setBotName] = useState('AI Tư Vấn')
  const [botAvatar, setBotAvatar] = useState('')
  const [greeting, setGreeting] = useState('Xin chào! Tôi có thể giúp gì cho bạn?')
  const [quickQuestions, setQuickQuestions] = useState<string[]>([])
  const [sessionId] = useState(() => crypto.randomUUID())
  const bottomRef = useRef<HTMLDivElement>(null)

  // Use a ref so the latest apiKey is always available to DefaultChatTransport body
  const apiKeyRef = useRef('')
  const apiBaseUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://localhost:8001'

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const key = params.get('key') || ''
    apiKeyRef.current = key
    setApiKey(key)
    setBotName(params.get('name') || 'AI Tư Vấn')

    if (key) {
      fetch(`/api/config?apiKey=${key}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            if (data.bot_name) setBotName(data.bot_name)
            if (data.bot_avatar) {
              // bot_avatar from API is typically a relative path like /avatars/xxx.jpg
              const av = data.bot_avatar
              setBotAvatar(av.startsWith('http') ? av : `${apiBaseUrl}${av}`)
            }
            if (data.quick_questions && Array.isArray(data.quick_questions)) {
              setQuickQuestions(data.quick_questions)
            }
            if (data.greeting_message) {
              setGreeting(data.greeting_message)
            }
          }
        })
        .catch(() => {})
    }

    // Avatar from URL param
    const avatarParam = params.get('avatar')
    if (avatarParam) {
      setBotAvatar(avatarParam.startsWith('http') ? avatarParam : `${apiBaseUrl}${avatarParam}`)
    }
  }, [])

  // Transport is stable — body is a function so it always reads latest apiKey from ref
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: () => ({ apiKey: apiKeyRef.current, id: sessionId })
  }), [sessionId])

  const { messages, sendMessage, status, setMessages } = useChat({
    id: sessionId,
    transport
  })

  // Set initial welcome message if empty
  useEffect(() => {
    if (messages.length === 0 && status === 'ready' && greeting) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        parts: [{ type: 'text', text: greeting }]
      }])
    }
  }, [messages.length, status, setMessages, greeting])

  const [input, setInput] = useState('')
  const isLoading = status === 'submitted' || status === 'streaming'

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput('')
  }

  const append = (msg: { role: string, content: string }) => {
    sendMessage({ text: msg.content })
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="widget-root">
      <div className="widget-header">
        <div className="bot-avatar" style={{ overflow: 'hidden', padding: botAvatar ? 0 : undefined }}>
          {botAvatar ? <img src={botAvatar} alt="Bot" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🤖'}
        </div>
        <div>
          <div className="bot-name">{botName}</div>
          <div className="bot-status">
            <span className="status-dot" />
            Trực tuyến
          </div>
        </div>
      </div>

      <div className="messages-area">
        {messages.map((m: UIMessage) => (
          <div key={m.id} className={`message-row ${m.role}`}>
            {m.role === 'assistant' && (
              <div className="avatar-sm" style={{ overflow: 'hidden', padding: botAvatar ? 0 : undefined, background: botAvatar ? 'transparent' : undefined }}>
                {botAvatar ? <img src={botAvatar} alt="Bot" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : '🤖'}
              </div>
            )}

            <div className="bubble-wrapper">
              {/* Text Parts */}
              {m.parts?.filter((p: any) => p.type === 'text').map((p: any, i: number) => (
                <div key={`txt-${i}`} className={`bubble ${m.role}`}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.text}</p>
                </div>
              ))}

              {/* Tool Parts */}
              {m.parts?.filter((p: any) => p.type?.startsWith('tool-') || p.type === 'dynamic-tool').map((part: any, idx: number) => {
                const toolName = part.type === 'dynamic-tool' ? part.toolName : part.type.replace('tool-', '');
                const args = part.input || part.args || {};
                const toolCallId = part.toolCallId || `tc-${idx}`;

                return (
                  <div key={toolCallId} className="tool-component">
                    {toolName === 'showPricing' && <PricingCard {...args} apiKey={apiKey} />}
                    {toolName === 'showBuyForm' && <BuyForm {...args} apiKey={apiKey} />}
                    {toolName === 'showDomainResult' && <DomainResult {...args} apiKey={apiKey} />}
                    {toolName === 'showSupportTicket' && <SupportTicket {...args} apiKey={apiKey} />}
                    {toolName === 'showRating' && <RatingWidget {...args} apiKey={apiKey} />}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="message-row assistant">
            <div className="avatar-sm" style={{ overflow: 'hidden', padding: botAvatar ? 0 : undefined, background: botAvatar ? 'transparent' : undefined }}>
              {botAvatar ? <img src={botAvatar} alt="Bot" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : '🤖'}
            </div>
            <div className="bubble assistant">
              <span className="typing-dots"><span /><span /><span /></span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {quickQuestions.length > 0 && messages.length <= 1 && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', overflowX: 'auto', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {quickQuestions.map((q, idx) => (
            <button 
              key={idx}
              onClick={(e) => { e.preventDefault(); append({ role: 'user', content: q }) }}
              style={{ padding: '6px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 16, fontSize: 13, color: '#334155', whiteSpace: 'nowrap', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
              onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
              onMouseOut={e => e.currentTarget.style.background = '#fff'}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="input-area">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Hỏi gì đó..."
          disabled={isLoading}
          className="chat-input"
        />
        <button type="submit" disabled={isLoading || !input.trim()} className="send-btn">
          {isLoading ? (
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
      </form>
    </div>
  )
}