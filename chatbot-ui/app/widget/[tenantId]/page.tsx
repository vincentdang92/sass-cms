'use client'
import { useChat } from 'ai/react'
import type { Message, ToolInvocation } from 'ai'
import { useEffect, useRef, useState } from 'react'

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
  const [sessionId] = useState(() => crypto.randomUUID())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setApiKey(params.get('key') || '')
    setBotName(params.get('name') || 'AI Tư Vấn')

    // Config avatar from URL param, defaulting to api URL prefix if relative path
    const avatarParam = params.get('avatar')
    if (avatarParam) {
      if (avatarParam.startsWith('/')) {
        const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://localhost:8001'
        setBotAvatar(`${apiUrl}${avatarParam}`)
      } else {
        setBotAvatar(avatarParam)
      }
    }
  }, [])

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
    id: sessionId,
    body: { apiKey, id: sessionId },
    initialMessages: [{
      id: 'welcome',
      role: 'assistant',
      content: 'Xin chào! Tôi có thể giúp gì cho bạn về domain và hosting hôm nay?',
    }] as Message[],
  })

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
        {messages.map((m: Message) => (
          <div key={m.id} className={`message-row ${m.role}`}>
            {m.role === 'assistant' && (
              <div className="avatar-sm" style={{ overflow: 'hidden', padding: botAvatar ? 0 : undefined, background: botAvatar ? 'transparent' : undefined }}>
                {botAvatar ? <img src={botAvatar} alt="Bot" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : '🤖'}
              </div>
            )}

            <div className="bubble-wrapper">
              {m.content && (
                <div className={`bubble ${m.role}`}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                </div>
              )}

              {/* Client-side Tool Rendering */}
              {m.toolInvocations?.map((tool: ToolInvocation) => {
                if (!('result' in tool)) {
                  return <LoadingCard key={tool.toolCallId} />
                }

                // Khi server execute xong, `result` sẽ chứa args
                const args = tool.result

                return (
                  <div key={tool.toolCallId} className="tool-component">
                    {tool.toolName === 'showPricing' && <PricingCard {...args} apiKey={apiKey} />}
                    {tool.toolName === 'showBuyForm' && <BuyForm {...args} apiKey={apiKey} />}
                    {tool.toolName === 'showDomainResult' && <DomainResult {...args} apiKey={apiKey} />}
                    {tool.toolName === 'showSupportTicket' && <SupportTicket {...args} apiKey={apiKey} />}
                    {tool.toolName === 'showRating' && <RatingWidget {...args} apiKey={apiKey} />}
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

      <form onSubmit={handleSubmit} className="input-area">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Hỏi về domain, hosting, VPS..."
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