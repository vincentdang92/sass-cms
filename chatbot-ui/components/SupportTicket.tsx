'use client'
import { useState } from 'react'

interface Props {
    suggestedTitle?: string
    apiKey: string
}

export function SupportTicket({ suggestedTitle, apiKey }: Props) {
    const [form, setForm] = useState({
        title: suggestedTitle || '',
        description: '',
        email: '',
    })
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://localhost:8000'

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setStatus('loading')
        const res = await fetch(`${apiUrl}/crm/tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify(form),
        })
        setStatus(res.ok ? 'success' : 'error')
    }

    if (status === 'success') {
        return (
            <div className="component-card success-card">
                <div className="success-icon">🎫</div>
                <div className="success-title">Ticket đã được gửi!</div>
                <div className="success-msg">Chúng tôi sẽ phản hồi tới <strong>{form.email}</strong> trong vòng 4 giờ.</div>
            </div>
        )
    }

    return (
        <div className="component-card">
            <div className="component-header">
                <span>🎫 Gửi yêu cầu hỗ trợ</span>
            </div>

            <form onSubmit={submit} className="crm-form">
                <div className="form-group">
                    <label>Tiêu đề <span className="required">*</span></label>
                    <input
                        type="text"
                        placeholder="Mô tả ngắn vấn đề..."
                        value={form.title}
                        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                        required
                        disabled={status === 'loading'}
                    />
                </div>

                <div className="form-group">
                    <label>Mô tả chi tiết <span className="required">*</span></label>
                    <textarea
                        placeholder="Hãy mô tả chi tiết vấn đề bạn gặp phải..."
                        value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        required
                        rows={3}
                        disabled={status === 'loading'}
                    />
                </div>

                <div className="form-group">
                    <label>Email liên hệ <span className="required">*</span></label>
                    <input
                        type="email"
                        placeholder="email@example.com"
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        required
                        disabled={status === 'loading'}
                    />
                </div>

                {status === 'error' && <p className="form-error">Có lỗi, vui lòng thử lại.</p>}

                <button type="submit" className="action-btn primary" disabled={status === 'loading'}>
                    {status === 'loading' ? 'Đang gửi...' : 'Gửi yêu cầu hỗ trợ'}
                </button>
            </form>
        </div>
    )
}
