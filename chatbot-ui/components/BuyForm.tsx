'use client'
import { useState } from 'react'

interface Props {
    product: string
    amount: number
    apiKey: string
}

export function BuyForm({ product, amount, apiKey }: Props) {
    const [form, setForm] = useState({ name: '', email: '', phone: '' })
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [error, setError] = useState('')

    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://localhost:8000'

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.name || !form.email) return
        setStatus('loading')

        const res = await fetch(`${apiUrl}/crm/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({
                product,
                amount,
                buyer_name: form.name,
                buyer_email: form.email,
                buyer_phone: form.phone,
            }),
        })

        if (res.ok) {
            setStatus('success')
        } else {
            setStatus('error')
            setError('Có lỗi xảy ra, vui lòng thử lại.')
        }
    }

    if (status === 'success') {
        return (
            <div className="component-card success-card">
                <div className="success-icon">✅</div>
                <div className="success-title">Đặt hàng thành công!</div>
                <div className="success-msg">
                    Chúng tôi sẽ liên hệ với <strong>{form.email}</strong> để xác nhận đơn <strong>{product}</strong>.
                </div>
            </div>
        )
    }

    return (
        <div className="component-card">
            <div className="component-header">
                <span>🛒 Đặt mua</span>
                <span className="component-badge">{amount.toLocaleString('vi-VN')}đ</span>
            </div>
            <div className="product-name-tag">{product}</div>

            <form onSubmit={submit} className="crm-form">
                <div className="form-group">
                    <label>Họ tên <span className="required">*</span></label>
                    <input
                        type="text"
                        placeholder="Nguyễn Văn A"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        required
                        disabled={status === 'loading'}
                    />
                </div>

                <div className="form-group">
                    <label>Email <span className="required">*</span></label>
                    <input
                        type="email"
                        placeholder="email@example.com"
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        required
                        disabled={status === 'loading'}
                    />
                </div>

                <div className="form-group">
                    <label>Số điện thoại</label>
                    <input
                        type="tel"
                        placeholder="0901 234 567"
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        disabled={status === 'loading'}
                    />
                </div>

                {error && <p className="form-error">{error}</p>}

                <button type="submit" className="action-btn primary" disabled={status === 'loading'}>
                    {status === 'loading' ? 'Đang xử lý...' : 'Xác nhận đặt hàng'}
                </button>
            </form>
        </div>
    )
}
