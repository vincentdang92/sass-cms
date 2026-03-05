'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewTenantPage() {
    const router = useRouter()
    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://127.0.0.1:8001'
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [error, setError] = useState('')
    const [form, setForm] = useState({
        id: '',
        name: '',
        email: '',
        bot_name: 'AI Tư Vấn',
        system_prompt: 'Bạn là trợ lý tư vấn khách hàng. Trả lời ngắn gọn, thân thiện bằng tiếng Việt.',
        llm_provider: 'deepseek',
        llm_model: 'deepseek-chat',
        plan: 'free',
        max_requests_day: 100,
    })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        const secret = localStorage.getItem('admin_secret')
        try {
            const res = await fetch(`${apiUrl}/admin/customers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-secret': secret || '',
                },
                body: JSON.stringify({ ...form, admin_secret: secret }),
            })
            const data = await res.json()
            if (res.ok) {
                setResult(data)
            } else {
                setError(data.detail || 'Có lỗi khi tạo Tenant')
            }
        } catch {
            setError('Không thể kết nối tới API.')
        } finally {
            setLoading(false)
        }
    }

    if (result) {
        return (
            <>
                <div className="admin-topbar">
                    <div>
                        <h1 className="admin-page-title">✅ Tạo Tenant thành công!</h1>
                        <p className="admin-page-sub">Lưu API Key ngay bây giờ — sẽ không hiển thị lại!</p>
                    </div>
                </div>
                <div className="admin-card">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                            <div className="admin-label">Customer ID</div>
                            <code style={{ color: 'var(--admin-primary)', fontSize: 14 }}>{result.customer_id}</code>
                        </div>
                        <div>
                            <div className="admin-label">🔑 API Key (lưu lại ngay!)</div>
                            <div style={{
                                background: 'var(--admin-bg)',
                                border: '1px solid var(--admin-border)',
                                borderRadius: 8,
                                padding: '12px 16px',
                                fontFamily: 'monospace',
                                fontSize: 14,
                                wordBreak: 'break-all',
                                color: 'var(--admin-success)'
                            }}>
                                {result.api_key}
                            </div>
                        </div>
                        <div>
                            <div className="admin-label">Embed Snippet</div>
                            <div style={{
                                background: 'var(--admin-bg)',
                                border: '1px solid var(--admin-border)',
                                borderRadius: 8,
                                padding: '12px 16px',
                                fontFamily: 'monospace',
                                fontSize: 12,
                                wordBreak: 'break-all',
                                color: 'var(--admin-text-muted)'
                            }}>
                                {result.embed_snippet}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                            <a href={`/admin/tenants/${result.customer_id}`} className="admin-btn admin-btn-primary">
                                📁 Mở trang quản lý Tenant
                            </a>
                            <a href="/admin/tenants" className="admin-btn admin-btn-ghost">
                                ← Về danh sách
                            </a>
                        </div>
                    </div>
                </div>
            </>
        )
    }

    return (
        <>
            <div className="admin-topbar">
                <div>
                    <h1 className="admin-page-title">➕ Tạo Tenant mới</h1>
                    <p className="admin-page-sub">Đăng ký một khách hàng mới trên hệ thống</p>
                </div>
            </div>

            <div className="admin-card" style={{ maxWidth: 700 }}>
                <form onSubmit={handleSubmit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                        <div className="admin-form-group">
                            <label className="admin-label">ID Tenant *</label>
                            <input className="admin-input" placeholder="vd: acme-shop" value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))} required />
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Tên khách hàng *</label>
                            <input className="admin-input" placeholder="vd: Acme Shop" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Email *</label>
                            <input className="admin-input" type="email" placeholder="admin@acme.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Tên Bot</label>
                            <input className="admin-input" placeholder="AI Tư Vấn" value={form.bot_name} onChange={e => setForm(f => ({ ...f, bot_name: e.target.value }))} />
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">LLM Provider</label>
                            <select className="admin-select" value={form.llm_provider} onChange={e => setForm(f => ({ ...f, llm_provider: e.target.value }))}>
                                <option value="deepseek">DeepSeek</option>
                                <option value="openai">OpenAI</option>
                            </select>
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">LLM Model</label>
                            <select className="admin-select" value={form.llm_model} onChange={e => setForm(f => ({ ...f, llm_model: e.target.value }))}>
                                <option value="deepseek-chat">deepseek-chat</option>
                                <option value="deepseek-reasoner">deepseek-reasoner</option>
                                <option value="gpt-4o-mini">gpt-4o-mini</option>
                                <option value="gpt-4o">gpt-4o</option>
                            </select>
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Plan</label>
                            <select className="admin-select" value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
                                <option value="free">Free (100 req/ngày)</option>
                                <option value="pro">Pro (1000 req/ngày)</option>
                                <option value="enterprise">Enterprise (Không giới hạn)</option>
                            </select>
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Giới hạn requests/ngày</label>
                            <input className="admin-input" type="number" value={form.max_requests_day} onChange={e => setForm(f => ({ ...f, max_requests_day: Number(e.target.value) }))} />
                        </div>
                    </div>

                    <div className="admin-form-group">
                        <label className="admin-label">System Prompt</label>
                        <textarea
                            className="admin-textarea"
                            rows={4}
                            value={form.system_prompt}
                            onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
                        />
                    </div>

                    {error && (
                        <div style={{ background: 'var(--admin-danger-bg)', color: 'var(--admin-danger)', padding: '12px 16px', borderRadius: 8, marginBottom: 20, fontSize: 14 }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12 }}>
                        <button type="submit" className="admin-btn admin-btn-primary" disabled={loading}>
                            {loading ? 'Đang tạo...' : '✅ Tạo Tenant'}
                        </button>
                        <a href="/admin/tenants" className="admin-btn admin-btn-ghost">Huỷ</a>
                    </div>
                </form>
            </div>
        </>
    )
}
