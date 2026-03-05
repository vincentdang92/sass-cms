'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'

interface Tenant {
    id: string; name: string; email: string; bot_name: string
    system_prompt: string; llm_provider: string; llm_model: string
    plan: string; max_requests_day: number; api_key: string
    active: boolean; requests_today: number; qdrant_collection: string
    mcp_server_url?: string; mcp_auth_token?: string; bot_avatar?: string
}

interface KBDoc { id: string; content: string; metadata: Record<string, any> }
interface ChatSession {
    id: string; title: string; preview: string
    created_at: string; updated_at: string; message_count: number
}
interface ChatMessage { id: number; role: string; content: string; created_at: string }
interface ChatStats {
    total_sessions: number; total_messages: number; user_messages: number
    requests_today: number; max_requests_day: number
    recent_queries: { content: string; at: string }[]
}
interface QuotaStats {
    plan: string; requests_today: number; max_requests_day: number
    remaining: number; used_pct: number; topups_this_month: number
    plan_default: number; last_reset_date: string | null
}
interface TopupRecord {
    id: number; amount: number; reason: string; note: string
    balance_before: number; balance_after: number; created_at: string
}

const ALLOWED_TYPES = ['.txt', '.md', '.pdf', '.xlsx', '.xls', '.csv', '.json']
const PLANS = [
    { value: 'free', label: '🆓 Free', limit: 100, badge: 'badge-yellow', desc: '100 req/ngày' },
    { value: 'pro', label: '⭐ Pro', limit: 1000, badge: 'badge-blue', desc: '1,000 req/ngày' },
    { value: 'enterprise', label: '🚀 Enterprise', limit: 99999, badge: 'badge-green', desc: 'Không giới hạn' },
]

export default function TenantDetailPage() {
    const params = useParams()
    const tenantId = params.tenantId as string
    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [loading, setLoading] = useState(true)
    const [tab, setTab] = useState<'settings' | 'kb' | 'chat' | 'quota'>('settings')
    const [activeCodeTab, setActiveCodeTab] = useState<'php' | 'node' | 'python'>('php')

    // Settings
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState('')
    const [regenLoading, setRegenLoading] = useState(false)
    const [regenKey, setRegenKey] = useState('')
    const [uploadingAvatar, setUploadingAvatar] = useState(false)
    const avatarInputRef = useRef<HTMLInputElement>(null)

    // KB
    const [kbDocs, setKbDocs] = useState<KBDoc[]>([])
    const [kbLoading, setKbLoading] = useState(false)
    const [uploadFiles, setUploadFiles] = useState<File[]>([])
    const [uploading, setUploading] = useState(false)
    const [uploadMsg, setUploadMsg] = useState('')
    const [dragover, setDragover] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    // Chat History
    const [chatStats, setChatStats] = useState<ChatStats | null>(null)
    const [sessions, setSessions] = useState<ChatSession[]>([])
    const [sessionsTotal, setSessionsTotal] = useState(0)
    const [sessionsPage, setSessionsPage] = useState(1)
    const [sessionsLoading, setSessionsLoading] = useState(false)
    const [activeSession, setActiveSession] = useState<{ id: string; messages: ChatMessage[] } | null>(null)
    const [sessionLoading, setSessionLoading] = useState(false)

    // Quota
    const [quota, setQuota] = useState<QuotaStats | null>(null)
    const [topupHistory, setTopupHistory] = useState<TopupRecord[]>([])
    const [topupTotal, setTopupTotal] = useState(0)
    const [topupPage, setTopupPage] = useState(1)
    const [topupLoading, setTopupLoading] = useState(false)
    const [topupAmount, setTopupAmount] = useState(100)
    const [topupReason, setTopupReason] = useState('manual topup')
    const [topupNote, setTopupNote] = useState('')
    const [topupMsg, setTopupMsg] = useState('')

    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://127.0.0.1:8001'
    const adminSecret = typeof window !== 'undefined' ? localStorage.getItem('admin_secret') || '' : ''
    const h = { 'x-admin-secret': adminSecret }

    // Load tenant
    useEffect(() => {
        if (!tenantId) return
        fetch(`${apiUrl}/admin/customers`, { headers: h, cache: 'no-store' })
            .then(r => r.json())
            .then((data: any[]) => {
                const found = data.find((c: any) => c.id === tenantId)
                if (found) setTenant(found)
            })
            .finally(() => setLoading(false))
    }, [tenantId])

    // KB docs
    useEffect(() => {
        if (tab !== 'kb' || !tenantId) return
        setKbLoading(true)
        fetch(`${apiUrl}/admin/customers/${tenantId}/kb`, { headers: h })
            .then(r => r.json())
            .then(data => setKbDocs(data.docs || []))
            .finally(() => setKbLoading(false))
    }, [tab, tenantId])

    // Chat stats + sessions
    useEffect(() => {
        if (tab !== 'chat' || !tenantId) return
        fetch(`${apiUrl}/admin/customers/${tenantId}/chat-stats`, { headers: h })
            .then(r => r.json()).then(data => setChatStats(data))
        loadSessions(1)
    }, [tab, tenantId])

    // Quota
    useEffect(() => {
        if (tab !== 'quota' || !tenantId) return
        fetch(`${apiUrl}/admin/customers/${tenantId}/quota`, { headers: h })
            .then(r => r.json()).then(data => setQuota(data))
        loadTopupHistory(1)
    }, [tab, tenantId])

    const loadTopupHistory = (page: number) => {
        setTopupLoading(true)
        fetch(`${apiUrl}/admin/customers/${tenantId}/quota/history?page=${page}&limit=20`, { headers: h })
            .then(r => r.json())
            .then(data => {
                setTopupHistory(data.history || [])
                setTopupTotal(data.total || 0)
                setTopupPage(page)
            })
            .finally(() => setTopupLoading(false))
    }

    const handleTopup = async () => {
        if (topupAmount <= 0) return
        const res = await fetch(`${apiUrl}/admin/customers/${tenantId}/quota/topup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...h },
            body: JSON.stringify({ amount: topupAmount, reason: topupReason, note: topupNote })
        })
        const data = await res.json()
        if (res.ok) {
            setTopupMsg('✅ Đã cộng request thành công!')
            setTopupAmount(0)
            setTopupReason('Mua thêm theo gói')
            setTopupNote('')
            setQuota(q => q ? { ...q, max_requests_day: data.new_max, requests_today: data.requests_today, remaining: data.new_max - data.requests_today } : q)
            loadTopupHistory(1)
        } else setTopupMsg(`❌ Lỗi: ${data.detail}`)
        setTimeout(() => setTopupMsg(''), 3000)
    }

    const handleGenerateToken = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        const token = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
        setTenant(t => t ? { ...t, mcp_auth_token: `sk_mcp_${token}` } : t)
    }

    const handleCopyToken = () => {
        if (tenant?.mcp_auth_token) {
            navigator.clipboard.writeText(tenant.mcp_auth_token)
            alert('Đã copy token!')
        }
    }

    const handleResetCounter = async () => {
        if (!confirm('Reset số request hôm nay về 0?')) return
        const res = await fetch(`${apiUrl}/admin/customers/${tenantId}/quota/reset-counter`, { method: 'POST', headers: h })
        const data = await res.json()
        if (res.ok) {
            setTopupMsg(`✅ Đã reset counter (cũ: ${data.old_value})`)
            fetch(`${apiUrl}/admin/customers/${tenantId}/quota`, { headers: h }).then(r => r.json()).then(setQuota)
            loadTopupHistory(1)
            setTimeout(() => setTopupMsg(''), 3000)
        }
    }

    const loadSessions = (page: number) => {
        setSessionsLoading(true)
        fetch(`${apiUrl}/admin/customers/${tenantId}/chat-sessions?page=${page}&limit=20`, { headers: h })
            .then(r => r.json())
            .then(data => {
                setSessions(data.sessions || [])
                setSessionsTotal(data.total || 0)
                setSessionsPage(page)
            })
            .finally(() => setSessionsLoading(false))
    }

    const loadSession = async (sessionId: string) => {
        setSessionLoading(true)
        const res = await fetch(`${apiUrl}/admin/customers/${tenantId}/chat-sessions/${sessionId}`, { headers: h })
        const data = await res.json()
        setActiveSession({ id: sessionId, messages: data.messages || [] })
        setSessionLoading(false)
    }

    const deleteSession = async (sessionId: string) => {
        if (!confirm('Xóa cuộc hội thoại này?')) return
        await fetch(`${apiUrl}/admin/customers/${tenantId}/chat-sessions/${sessionId}`, {
            method: 'DELETE', headers: h
        })
        if (activeSession?.id === sessionId) setActiveSession(null)
        loadSessions(sessionsPage)
    }

    const handleSave = async () => {
        if (!tenant) return
        setSaving(true); setSaveMsg('')
        try {
            const res = await fetch(`${apiUrl}/admin/customers/${tenantId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...h },
                body: JSON.stringify({
                    bot_name: tenant.bot_name, system_prompt: tenant.system_prompt,
                    llm_provider: tenant.llm_provider, llm_model: tenant.llm_model,
                    plan: tenant.plan, max_requests_day: tenant.max_requests_day,
                    is_active: tenant.active,
                    mcp_server_url: tenant.mcp_server_url,
                    mcp_auth_token: tenant.mcp_auth_token,
                })
            })
            setSaveMsg(res.ok ? '✅ Đã lưu thành công!' : '❌ Lỗi khi lưu. Thử lại!')
        } catch { setSaveMsg('❌ Không thể kết nối API.') }
        finally { setSaving(false); setTimeout(() => setSaveMsg(''), 3000) }
    }

    const handleRegenKey = async () => {
        if (!confirm('Tạo API Key mới? Key cũ sẽ bị vô hiệu hóa ngay lập tức!')) return
        setRegenLoading(true)
        try {
            const res = await fetch(`${apiUrl}/admin/customers/${tenantId}/regenerate-key`, { method: 'POST', headers: h })
            const data = await res.json()
            if (res.ok) { setRegenKey(data.api_key); setTenant(t => t ? { ...t, api_key: data.api_key } : t) }
        } catch { } finally { setRegenLoading(false) }
    }

    const handleAvatarUpload = async (file: File) => {
        if (!tenant || !file) return
        setUploadingAvatar(true)
        const formData = new FormData()
        formData.append('file', file)
        try {
            const res = await fetch(`${apiUrl}/admin/customers/${tenantId}/avatar`, {
                method: 'POST', headers: h, body: formData
            })
            const data = await res.json()
            if (res.ok) {
                setTenant(t => t ? { ...t, bot_avatar: data.avatar_url } : t)
            } else {
                alert('Lỗi khi upload avatar: ' + (data.detail || ''))
            }
        } catch (e) {
            alert('Lỗi kết nối API')
        } finally {
            setUploadingAvatar(false)
        }
    }

    const handleFileChange = (files: FileList | null) => {
        if (!files) return
        const arr = Array.from(files).filter(f => ALLOWED_TYPES.some(ext => f.name.toLowerCase().endsWith(ext)))
        setUploadFiles(prev => [...prev, ...arr])
    }

    const handleUpload = async () => {
        if (!uploadFiles.length || !tenant) return
        setUploading(true); setUploadMsg('')
        const formData = new FormData()
        uploadFiles.forEach(f => formData.append('files', f))
        try {
            const res = await fetch(`${apiUrl}/kb/upload`, {
                method: 'POST', headers: { 'x-api-key': tenant.api_key }, body: formData
            })
            const data = await res.json()
            if (res.ok) {
                setUploadMsg(`✅ Đã upload! ${data.uploaded_chunks} chunks từ ${data.files} file.`)
                setUploadFiles([])
                fetch(`${apiUrl}/admin/customers/${tenantId}/kb`, { headers: h }).then(r => r.json()).then(d => setKbDocs(d.docs || []))
            } else {
                setUploadMsg(`❌ Upload thất bại: ${data.detail || 'Lỗi không xác định'}`)
            }
        } catch { setUploadMsg('❌ Lỗi kết nối API.') }
        finally { setUploading(false) }
    }

    const handleClearKB = async () => {
        if (!confirm('Xóa toàn bộ Knowledge Base của tenant này?')) return
        await fetch(`${apiUrl}/admin/customers/${tenantId}/kb`, { method: 'DELETE', headers: h })
        setKbDocs([]); setUploadMsg('🗑️ Đã xóa toàn bộ Knowledge Base.')
    }

    if (loading) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--admin-text-muted)' }}>Đang tải...</div>
    if (!tenant) return (
        <div className="admin-empty" style={{ padding: 80 }}>
            <div className="admin-empty-icon">❓</div>
            <h3>Không tìm thấy Tenant</h3>
            <p><a href="/admin/tenants" style={{ color: 'var(--admin-primary)' }}>← Về danh sách</a></p>
        </div>
    )

    const planBadge = (p: string) => {
        const plan = PLANS.find(x => x.value === p)
        return <span className={`badge ${plan?.badge || 'badge-yellow'}`}>{p}</span>
    }

    return (
        <>
            {/* Header */}
            <div className="admin-topbar">
                <div>
                    <a href="/admin/tenants" style={{ color: 'var(--admin-text-muted)', fontSize: 13, textDecoration: 'none' }}>← Tenants</a>
                    <h1 className="admin-page-title" style={{ marginTop: 4 }}>🏢 {tenant.name || tenant.id}</h1>
                    <p className="admin-page-sub">
                        <code style={{ fontSize: 12 }}>{tenant.id}</code> &nbsp;·&nbsp;
                        <span className={`badge ${tenant.active ? 'badge-green' : 'badge-red'}`}>{tenant.active ? 'Active' : 'Inactive'}</span>
                        &nbsp;·&nbsp;{planBadge(tenant.plan)}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--admin-text-muted)' }}>💬 {tenant.requests_today || 0} req hôm nay</span>
                </div>
            </div>

            {/* Info bar */}
            <div className="admin-card" style={{ marginBottom: 20, padding: '14px 20px' }}>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                        <div className="text-sm text-muted">API Key</div>
                        <span className="truncate-key" title={regenKey || tenant.api_key}>{(regenKey || tenant.api_key)?.slice(0, 32)}...</span>
                        {regenKey && <div style={{ fontSize: 11, color: 'var(--admin-success)', marginTop: 2 }}>✅ Key mới — lưu lại ngay!</div>}
                    </div>
                    <div>
                        <div className="text-sm text-muted">Collection</div>
                        <code style={{ fontSize: 11, color: 'var(--admin-primary)' }}>{tenant.qdrant_collection}</code>
                    </div>
                    <div style={{ marginLeft: 'auto' }}>
                        <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={handleRegenKey} disabled={regenLoading}>
                            {regenLoading ? '⏳' : '🔑 Tạo Key mới'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="admin-tabs">
                <button className={`admin-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>⚙️ Cài đặt Bot</button>
                <button className={`admin-tab ${tab === 'kb' ? 'active' : ''}`} onClick={() => setTab('kb')}>📚 Knowledge Base</button>
                <button className={`admin-tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>💬 Lịch sử Chat</button>
                <button className={`admin-tab ${tab === 'quota' ? 'active' : ''}`} onClick={() => setTab('quota')}>📊 Quota</button>
            </div>

            {/* ── Settings Tab ── */}
            {tab === 'settings' && (
                <div className="admin-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--admin-border)' }}>
                        <div style={{
                            width: 80, height: 80, borderRadius: '50%', background: 'var(--admin-surface-3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32,
                            overflow: 'hidden', border: '1px solid var(--admin-border)', position: 'relative'
                        }}>
                            {tenant.bot_avatar ? (
                                <img src={`${apiUrl}${tenant.bot_avatar}`} alt="Bot Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : '🤖'}
                            {uploadingAvatar && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⏳</div>}
                        </div>
                        <div>
                            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleAvatarUpload(e.target.files[0]) }} />
                            <button className="admin-btn admin-btn-sm" onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}>
                                📷 Cập nhật Avatar
                            </button>
                            <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 8 }}>JPG, PNG hoặc WebP. Avatar sẽ hiển thị trên Widget chat.</div>
                        </div>
                    </div>

                    <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--admin-border)' }}>
                        <div className="admin-section-header" style={{ marginBottom: 12 }}>
                            <span className="admin-section-title">🌍 Tích hợp Website (Embed Script)</span>
                            <span className="text-sm text-muted">Copy đoạn code sau và dán vào thẻ <code>&lt;body&gt;</code> trên website của bạn.</span>
                        </div>
                        <div style={{ position: 'relative' }}>
                            <pre style={{ margin: 0, padding: '16px 20px', background: '#1e1e1e', color: '#d4d4d4', borderRadius: 8, fontSize: 13, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {`<script src="${apiUrl.replace('/api', '')}/embed.js?key=${tenant.api_key}${tenant.bot_name ? `&name=${encodeURIComponent(tenant.bot_name)}` : ''}${tenant.bot_avatar ? `&avatar=${encodeURIComponent(tenant.bot_avatar)}` : ''}" defer></script>`}
                            </pre>
                            <button className="admin-btn admin-btn-sm admin-btn-primary"
                                style={{ position: 'absolute', top: 10, right: 10 }}
                                onClick={() => {
                                    navigator.clipboard.writeText(`<script src="${apiUrl.replace('/api', '')}/embed.js?key=${tenant.api_key}${tenant.bot_name ? `&name=${encodeURIComponent(tenant.bot_name)}` : ''}${tenant.bot_avatar ? `&avatar=${encodeURIComponent(tenant.bot_avatar)}` : ''}" defer></script>`)
                                    alert('Đã copy đoạn mã nhúng!')
                                }}>
                                📋 Copy
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                        <div className="admin-form-group">
                            <label className="admin-label">Tên Bot</label>
                            <input className="admin-input" value={tenant.bot_name || ''} onChange={e => setTenant(t => t ? { ...t, bot_name: e.target.value } : t)} />
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Email</label>
                            <input className="admin-input" value={tenant.email || ''} disabled style={{ opacity: 0.6 }} />
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">LLM Provider</label>
                            <select className="admin-select" value={tenant.llm_provider || 'deepseek'} onChange={e => setTenant(t => t ? { ...t, llm_provider: e.target.value } : t)}>
                                <option value="deepseek">DeepSeek</option>
                                <option value="openai">OpenAI</option>
                            </select>
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Model</label>
                            <select className="admin-select" value={tenant.llm_model || 'deepseek-chat'} onChange={e => setTenant(t => t ? { ...t, llm_model: e.target.value } : t)}>
                                <option value="deepseek-chat">deepseek-chat</option>
                                <option value="deepseek-reasoner">deepseek-reasoner</option>
                                <option value="gpt-4o-mini">gpt-4o-mini</option>
                                <option value="gpt-4o">gpt-4o</option>
                            </select>
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Giới hạn requests/ngày</label>
                            <input className="admin-input" type="number" value={tenant.max_requests_day || 100} onChange={e => setTenant(t => t ? { ...t, max_requests_day: Number(e.target.value) } : t)} />
                        </div>
                        <div className="admin-form-group">
                            <label className="admin-label">Trạng thái</label>
                            <select className="admin-select" value={tenant.active ? 'true' : 'false'} onChange={e => setTenant(t => t ? { ...t, active: e.target.value === 'true' } : t)}>
                                <option value="true">Active</option>
                                <option value="false">Inactive (tạm khóa)</option>
                            </select>
                        </div>
                    </div>

                    <hr className="divider" />
                    <div className="admin-section-header" style={{ marginBottom: 16 }}>
                        <span className="admin-section-title">📦 Quản lý Plan</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                        {PLANS.map(plan => (
                            <div key={plan.value} onClick={() => setTenant(t => t ? { ...t, plan: plan.value, max_requests_day: plan.limit < 99999 ? plan.limit : t.max_requests_day } : t)}
                                style={{
                                    background: tenant.plan === plan.value ? 'var(--admin-primary-glow)' : 'var(--admin-bg)',
                                    border: `2px solid ${tenant.plan === plan.value ? 'var(--admin-primary)' : 'var(--admin-border)'}`,
                                    borderRadius: 10, padding: '16px 20px', cursor: 'pointer', transition: 'all 0.15s',
                                }}>
                                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{plan.label}</div>
                                <div className={`badge ${plan.badge}`} style={{ marginBottom: 8 }}>{plan.value}</div>
                                <div className="text-sm text-muted">{plan.desc}</div>
                            </div>
                        ))}
                    </div>

                    <div className="admin-form-group">
                        <label className="admin-label">System Prompt</label>
                        <textarea className="admin-textarea" rows={6} value={tenant.system_prompt || ''} onChange={e => setTenant(t => t ? { ...t, system_prompt: e.target.value } : t)} />
                    </div>

                    <hr className="divider" />
                    <div className="admin-section-header" style={{ marginBottom: 16 }}>
                        <span className="admin-section-title">🔌 MCP Server Integration</span>
                        <span className="text-sm text-muted">Kết nối với Agent tools của khách hàng (Whois, Booking, Support...)</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
                        <div className="admin-form-group">
                            <label className="admin-label">MCP Server URL (Base URL)</label>
                            <input className="admin-input" placeholder="VD: https://api.customer.com/mcp" value={tenant.mcp_server_url || ''} onChange={e => setTenant(t => t ? { ...t, mcp_server_url: e.target.value } : t)} />
                            <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 4 }}>Bot sẽ tự động gọi <code style={{ fontSize: 11 }}>GET /tools</code> và <code style={{ fontSize: 11 }}>POST /execute</code> tới URL này.</div>
                        </div>
                        <div className="admin-form-group">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label className="admin-label">Auth Token (Bearer)</label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button className="admin-btn admin-btn-sm" onClick={handleGenerateToken} title="Tạo token mới" style={{ padding: '2px 6px', fontSize: 11 }}>🔄 Tạo mã</button>
                                    <button className="admin-btn admin-btn-sm" onClick={handleCopyToken} title="Copy token" style={{ padding: '2px 6px', fontSize: 11 }}>📋 Copy</button>
                                </div>
                            </div>
                            <input className="admin-input" type="password" placeholder="Token bảo mật..." value={tenant.mcp_auth_token || ''} onChange={e => setTenant(t => t ? { ...t, mcp_auth_token: e.target.value } : t)} />
                        </div>
                    </div>

                    <div style={{ marginBottom: 20, background: 'var(--admin-bg)', padding: '16px', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
                        <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>💻 Hướng dẫn tích hợp (dành cho Dev)</h4>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                            <button className="admin-btn admin-btn-sm" onClick={() => setActiveCodeTab('php')} style={{ background: activeCodeTab === 'php' ? 'var(--admin-primary-glow)' : '' }}>PHP</button>
                            <button className="admin-btn admin-btn-sm" onClick={() => setActiveCodeTab('node')} style={{ background: activeCodeTab === 'node' ? 'var(--admin-primary-glow)' : '' }}>Node.js</button>
                            <button className="admin-btn admin-btn-sm" onClick={() => setActiveCodeTab('python')} style={{ background: activeCodeTab === 'python' ? 'var(--admin-primary-glow)' : '' }}>Python</button>
                        </div>

                        {activeCodeTab === 'php' && (
                            <pre style={{ margin: 0, padding: 12, background: '#1e1e1e', color: '#d4d4d4', borderRadius: 4, fontSize: 12, overflowX: 'auto' }}>
                                {`// API Endpoint: GET /mcp/tools
$token = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if ($token !== 'Bearer ${tenant.mcp_auth_token || 'YOUR_TOKEN'}') die('Unauthorized');

echo json_encode(["tools" => [
  [
    "type" => "function",
    "function" => [
      "name" => "check_stock",
      "description" => "Kiểm tra tồn kho",
      "parameters" => ["type" => "object", "properties" => ["item" => ["type"=>"string"]]]
    ]
  ]
]]);

// API Endpoint: POST /mcp/execute
$data = json_decode(file_get_contents('php://input'), true);
if ($data['tool'] === 'check_stock') {
    echo json_encode(["status" => "success", "result" => "Còn 5 sản phẩm"]);
}`}
                            </pre>
                        )}
                        {activeCodeTab === 'node' && (
                            <pre style={{ margin: 0, padding: 12, background: '#1e1e1e', color: '#d4d4d4', borderRadius: 4, fontSize: 12, overflowX: 'auto' }}>
                                {`app.get('/mcp/tools', (req, res) => {
  if (req.headers.authorization !== 'Bearer ${tenant.mcp_auth_token || 'YOUR_TOKEN'}') 
    return res.status(401).send('Unauthorized');
    
  res.json({ tools: [{
    type: "function",
    function: { name: "check_stock", description: "Kiểm tra tồn kho", parameters: { /* ... */ } }
  }]});
});

app.post('/mcp/execute', (req, res) => {
  const { tool, arguments: args } = req.body;
  if (tool === 'check_stock') {
    res.json({ status: "success", result: \`Sản phẩm \${args.item} còn 5 cái\` });
  }
});`}
                            </pre>
                        )}
                        {activeCodeTab === 'python' && (
                            <pre style={{ margin: 0, padding: 12, background: '#1e1e1e', color: '#d4d4d4', borderRadius: 4, fontSize: 12, overflowX: 'auto' }}>
                                {`from fastapi import FastAPI, Header, HTTPException
app = FastAPI()

@app.get("/mcp/tools")
def get_tools(authorization: str = Header(None)):
    if authorization != "Bearer ${tenant.mcp_auth_token || 'YOUR_TOKEN'}":
        raise HTTPException(401)
    return {"tools": [ ... ]}

@app.post("/mcp/execute")
def execute(req: dict, authorization: str = Header(None)):
    if req["tool"] == "check_stock":
        return {"status": "success", "result": "Còn 5 sản phẩm"}
`}
                            </pre>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Đang lưu...' : '💾 Lưu thay đổi'}
                        </button>
                        {saveMsg && <span style={{ fontSize: 14, color: saveMsg.includes('✅') ? 'var(--admin-success)' : 'var(--admin-danger)' }}>{saveMsg}</span>}
                    </div>
                </div>
            )}

            {/* ── KB Tab ── */}
            {tab === 'kb' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div className="admin-card">
                        <div className="admin-section-header">
                            <span className="admin-section-title">📤 Upload tài liệu</span>
                            <div style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Hỗ trợ: .txt · .md · .pdf · .xlsx · .csv · .json</div>
                        </div>
                        <div className={`upload-zone ${dragover ? 'dragover' : ''}`}
                            onDragOver={e => { e.preventDefault(); setDragover(true) }}
                            onDragLeave={() => setDragover(false)}
                            onDrop={e => { e.preventDefault(); setDragover(false); handleFileChange(e.dataTransfer.files) }}
                            onClick={() => fileRef.current?.click()}>
                            <div className="upload-zone-icon">📂</div>
                            <div className="upload-zone-title">Kéo thả file vào đây hoặc click để chọn</div>
                            <div className="upload-zone-sub">.txt · .md · .pdf · .xlsx · .csv · .json</div>
                            <input ref={fileRef} type="file" multiple accept=".txt,.md,.pdf,.xlsx,.xls,.csv,.json" style={{ display: 'none' }} onChange={e => handleFileChange(e.target.files)} />
                        </div>
                        {uploadFiles.length > 0 && (
                            <ul className="upload-file-list">
                                {uploadFiles.map((f, i) => (
                                    <li key={i} className="upload-file-item">
                                        <span>📄 {f.name}</span>
                                        <span>{(f.size / 1024).toFixed(1)} KB</span>
                                        <button style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--admin-danger)', cursor: 'pointer', fontSize: 16 }} onClick={() => setUploadFiles(files => files.filter((_, j) => j !== i))}>×</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
                            <button className="admin-btn admin-btn-primary" onClick={handleUpload} disabled={uploading || uploadFiles.length === 0}>
                                {uploading ? '⏳ Đang upload...' : `⬆️ Upload${uploadFiles.length > 0 ? ` (${uploadFiles.length} file)` : ''}`}
                            </button>
                            {uploadMsg && <span style={{ fontSize: 13, color: uploadMsg.includes('✅') ? 'var(--admin-success)' : 'var(--admin-danger)' }}>{uploadMsg}</span>}
                        </div>
                    </div>

                    <div className="admin-card">
                        <div className="admin-section-header">
                            <span className="admin-section-title">📚 Knowledge Base ({kbDocs.length} chunks)</span>
                            <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={handleClearKB}>🗑️ Xóa tất cả</button>
                        </div>
                        {kbLoading ? (
                            <p className="text-muted" style={{ textAlign: 'center', padding: 30 }}>Đang tải...</p>
                        ) : kbDocs.length === 0 ? (
                            <div className="admin-empty" style={{ padding: 40 }}>
                                <div className="admin-empty-icon">📭</div>
                                <h3>Knowledge Base trống</h3>
                                <p>Upload tài liệu để AI có thêm thông tin tư vấn</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
                                {kbDocs.map((doc, i) => (
                                    <div key={doc.id || i} style={{ background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: '12px 14px' }}>
                                        <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                            {doc.metadata?.filename && <span className="badge badge-blue">📄 {doc.metadata.filename}</span>}
                                            {doc.metadata?.type && <span className="badge badge-yellow">{doc.metadata.type}</span>}
                                            <span className="badge" style={{ background: 'var(--admin-surface-3)', color: 'var(--admin-text-muted)', fontSize: 10 }}>#{i + 1}</span>
                                        </div>
                                        <p style={{ fontSize: 13, color: 'var(--admin-text-muted)', margin: 0, lineHeight: 1.6 }}>
                                            {doc.content?.slice(0, 220)}{(doc.content?.length || 0) > 220 ? '...' : ''}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Chat History Tab ── */}
            {tab === 'chat' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Stats */}
                    {chatStats && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                            {[
                                { icon: '💬', val: chatStats.total_sessions, label: 'Tổng cuộc hội thoại' },
                                { icon: '📨', val: chatStats.user_messages, label: 'Câu hỏi từ người dùng' },
                                { icon: '🤖', val: chatStats.total_messages, label: 'Tổng tin nhắn' },
                                { icon: '📊', val: `${chatStats.requests_today} / ${chatStats.max_requests_day}`, label: 'Requests hôm nay' },
                            ].map(s => (
                                <div key={s.label} className="admin-stat-card">
                                    <span className="admin-stat-icon">{s.icon}</span>
                                    <div className="admin-stat-value" style={{ fontSize: 22 }}>{s.val}</div>
                                    <div className="admin-stat-label">{s.label}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Recent queries quick view */}
                    {chatStats?.recent_queries && chatStats.recent_queries.length > 0 && (
                        <div className="admin-card">
                            <div className="admin-section-title" style={{ marginBottom: 12 }}>🔍 Câu hỏi gần nhất</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {chatStats.recent_queries.map((q, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 14px', background: 'var(--admin-bg)', borderRadius: 8, border: '1px solid var(--admin-border)' }}>
                                        <span style={{ fontSize: 18 }}>👤</span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 14, color: 'var(--admin-text)' }}>{q.content}</div>
                                            <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 2 }}>{q.at ? new Date(q.at).toLocaleString('vi-VN') : ''}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Sessions list + Message viewer */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16 }}>
                        {/* Session list */}
                        <div className="admin-card" style={{ maxHeight: 500, display: 'flex', flexDirection: 'column' }}>
                            <div className="admin-section-header">
                                <span className="admin-section-title">📋 Danh sách phiên ({sessionsTotal})</span>
                            </div>
                            {sessionsLoading ? (
                                <p className="text-muted" style={{ textAlign: 'center', padding: 20 }}>Đang tải...</p>
                            ) : sessions.length === 0 ? (
                                <div className="admin-empty" style={{ padding: 30 }}>
                                    <div className="admin-empty-icon" style={{ fontSize: 28 }}>💬</div>
                                    <h3 style={{ fontSize: 14 }}>Chưa có cuộc hội thoại nào</h3>
                                </div>
                            ) : (
                                <div style={{ overflowY: 'auto', flex: 1 }}>
                                    {sessions.map(s => (
                                        <div key={s.id}
                                            onClick={() => loadSession(s.id)}
                                            style={{
                                                padding: '12px 14px', cursor: 'pointer',
                                                borderBottom: '1px solid var(--admin-border)',
                                                background: activeSession?.id === s.id ? 'var(--admin-primary-glow)' : 'transparent',
                                                transition: 'background 0.15s'
                                            }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 600, color: activeSession?.id === s.id ? 'var(--admin-primary)' : 'var(--admin-text)', marginBottom: 3 }}>
                                                        {s.title || 'Cuộc hội thoại mới'}
                                                    </div>
                                                    <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {s.preview || '(Không có nội dung)'}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: 'var(--admin-text-subtle)', marginTop: 4 }}>
                                                        {s.message_count} tin · {s.updated_at ? new Date(s.updated_at).toLocaleString('vi-VN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                                    </div>
                                                </div>
                                                <button onClick={e => { e.stopPropagation(); deleteSession(s.id) }}
                                                    style={{ background: 'none', border: 'none', color: 'var(--admin-danger)', cursor: 'pointer', padding: '4px', fontSize: 14, opacity: 0.6 }}
                                                    title="Xóa phiên">🗑️</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {sessionsTotal > 20 && (
                                <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid var(--admin-border)' }}>
                                    <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => loadSessions(sessionsPage - 1)} disabled={sessionsPage <= 1}>← Trước</button>
                                    <span className="text-sm text-muted" style={{ margin: 'auto' }}>Trang {sessionsPage}</span>
                                    <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => loadSessions(sessionsPage + 1)} disabled={sessionsPage * 20 >= sessionsTotal}>Sau →</button>
                                </div>
                            )}
                        </div>

                        {/* Message viewer */}
                        <div className="admin-card" style={{ maxHeight: 500, display: 'flex', flexDirection: 'column' }}>
                            <div className="admin-section-header">
                                <span className="admin-section-title">💭 Nội dung hội thoại</span>
                            </div>
                            {!activeSession ? (
                                <div className="admin-empty" style={{ padding: 40 }}>
                                    <div className="admin-empty-icon" style={{ fontSize: 28 }}>👈</div>
                                    <h3 style={{ fontSize: 14 }}>Chọn một phiên để xem</h3>
                                </div>
                            ) : sessionLoading ? (
                                <p className="text-muted" style={{ textAlign: 'center', padding: 30 }}>Đang tải...</p>
                            ) : (
                                <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                                    {activeSession.messages.map((msg, i) => (
                                        <div key={msg.id || i} style={{
                                            display: 'flex', gap: 10, padding: '10px 14px',
                                            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                        }}>
                                            {msg.role === 'assistant' && (
                                                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--admin-primary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🤖</div>
                                            )}
                                            <div style={{
                                                maxWidth: '80%',
                                                background: msg.role === 'user' ? 'var(--admin-primary-glow)' : 'var(--admin-bg)',
                                                border: `1px solid ${msg.role === 'user' ? 'var(--admin-primary)' : 'var(--admin-border)'}`,
                                                borderRadius: 10, padding: '10px 14px',
                                            }}>
                                                <div style={{ fontSize: 13, color: 'var(--admin-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                                                <div style={{ fontSize: 10, color: 'var(--admin-text-muted)', marginTop: 4 }}>
                                                    {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('vi-VN') : ''}
                                                </div>
                                            </div>
                                            {msg.role === 'user' && (
                                                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--admin-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>👤</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* ── Quota Tab ── */}
            {tab === 'quota' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* Usage Stats */}
                    {quota && (
                        <div className="admin-card">
                            <div className="admin-section-header" style={{ marginBottom: 16 }}>
                                <span className="admin-section-title">📊 Quota hôm nay</span>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    {topupMsg && <span style={{ fontSize: 13, color: topupMsg.includes('✅') ? 'var(--admin-success)' : 'var(--admin-danger)' }}>{topupMsg}</span>}
                                    <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={handleResetCounter}>🔄 Reset hôm nay</button>
                                </div>
                            </div>

                            {/* Stats row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                                {[
                                    { icon: '📈', val: quota.requests_today, label: 'Đã dùng hôm nay' },
                                    { icon: '🎯', val: quota.max_requests_day >= 99999 ? '∞' : quota.max_requests_day, label: 'Giới hạn ngày' },
                                    { icon: '💚', val: quota.max_requests_day >= 99999 ? '∞' : quota.remaining, label: 'Còn lại' },
                                    { icon: '🎁', val: `+${quota.topups_this_month}`, label: 'Topup tháng này' },
                                ].map(s => (
                                    <div key={s.label} className="admin-stat-card">
                                        <span className="admin-stat-icon">{s.icon}</span>
                                        <div className="admin-stat-value" style={{ fontSize: 20 }}>{s.val}</div>
                                        <div className="admin-stat-label">{s.label}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Progress bar */}
                            {quota.max_requests_day < 99999 && (
                                <div style={{ marginBottom: 8 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                                        <span className="text-muted">Gói <strong>{quota.plan}</strong> — {quota.requests_today} / {quota.max_requests_day} requests</span>
                                        <span style={{ fontWeight: 700, color: quota.used_pct >= 90 ? 'var(--admin-danger)' : quota.used_pct >= 70 ? 'var(--admin-warning)' : 'var(--admin-success)' }}>{quota.used_pct}%</span>
                                    </div>
                                    <div style={{ height: 10, background: 'var(--admin-border)', borderRadius: 8, overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%',
                                            width: `${Math.min(quota.used_pct, 100)}%`,
                                            borderRadius: 8,
                                            background: quota.used_pct >= 90 ? 'var(--admin-danger)' : quota.used_pct >= 70 ? 'var(--admin-warning)' : 'var(--admin-success)',
                                            transition: 'width 0.5s ease',
                                        }} />
                                    </div>
                                    {quota.used_pct >= 100 && (
                                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--admin-danger-glow, rgba(239,68,68,0.1))', borderRadius: 6, color: 'var(--admin-danger)', fontSize: 13 }}>
                                            ⚠️ Tenant này đã hết request hôm nay! Hãy nạp thêm hoặc reset counter.
                                        </div>
                                    )}
                                </div>
                            )}

                            {quota.last_reset_date && (
                                <div className="text-sm text-muted" style={{ marginTop: 4 }}>🕐 Reset lần cuối: {quota.last_reset_date}</div>
                            )}
                        </div>
                    )}

                    {/* Topup Form */}
                    <div className="admin-card">
                        <div className="admin-section-title" style={{ marginBottom: 16 }}>➕ Nạp thêm Request</div>

                        {/* Quick presets */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                            <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>Nạp nhanh:</span>
                            {[100, 250, 500, 1000, 5000].map(preset => (
                                <button key={preset} className={`admin-btn admin-btn-sm ${topupAmount === preset ? 'admin-btn-primary' : 'admin-btn-ghost'}`}
                                    onClick={() => setTopupAmount(preset)}>+{preset.toLocaleString()}</button>
                            ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                            <div className="admin-form-group">
                                <label className="admin-label">Số lượng cần nạp</label>
                                <input className="admin-input" type="number" min={1} value={topupAmount}
                                    onChange={e => setTopupAmount(Number(e.target.value))} />
                            </div>
                            <div className="admin-form-group">
                                <label className="admin-label">Lý do</label>
                                <select className="admin-select" value={topupReason} onChange={e => setTopupReason(e.target.value)}>
                                    <option value="manual topup">🛠️ Admin nạp thủ công</option>
                                    <option value="plan upgrade">⬆️ Nâng cấp gói</option>
                                    <option value="compensation">🎁 Bồi thường sự cố</option>
                                    <option value="promotion">🎉 Khuyến mãi</option>
                                    <option value="technical issue">🔧 Sự cố kỹ thuật</option>
                                </select>
                            </div>
                        </div>

                        <div className="admin-form-group" style={{ marginBottom: 16 }}>
                            <label className="admin-label">Ghi chú (tùy chọn)</label>
                            <input className="admin-input" placeholder="VD: Khách mua thêm 500 req, hoá đơn #INV-001..."
                                value={topupNote} onChange={e => setTopupNote(e.target.value)} />
                        </div>

                        <button className="admin-btn admin-btn-primary" onClick={handleTopup} disabled={topupAmount <= 0}>
                            ➕ Nạp {topupAmount.toLocaleString()} requests vào tài khoản
                        </button>
                    </div>

                    {/* Topup History */}
                    <div className="admin-card">
                        <div className="admin-section-header">
                            <span className="admin-section-title">📜 Lịch sử Quota ({topupTotal} sự kiện)</span>
                        </div>
                        {topupLoading ? (
                            <p className="text-muted" style={{ textAlign: 'center', padding: 24 }}>Đang tải...</p>
                        ) : topupHistory.length === 0 ? (
                            <div className="admin-empty" style={{ padding: 30 }}>
                                <div className="admin-empty-icon" style={{ fontSize: 28 }}>📭</div>
                                <h3 style={{ fontSize: 14 }}>Chưa có lịch sử nạp request</h3>
                            </div>
                        ) : (
                            <div className="admin-table-wrap">
                                <table className="admin-table">
                                    <thead><tr>
                                        <th>Thời gian</th>
                                        <th>Loại</th>
                                        <th>Số lượng</th>
                                        <th>Trước → Sau</th>
                                        <th>Ghi chú</th>
                                    </tr></thead>
                                    <tbody>
                                        {topupHistory.map(r => (
                                            <tr key={r.id}>
                                                <td style={{ fontSize: 12 }}>{r.created_at ? new Date(r.created_at).toLocaleString('vi-VN') : ''}</td>
                                                <td>
                                                    <span className={`badge ${r.reason === 'counter reset' ? 'badge-yellow' : r.amount > 0 ? 'badge-green' : 'badge-red'}`}>
                                                        {r.reason === 'counter reset' ? '🔄 Reset' : `+${r.amount}`}
                                                    </span>
                                                </td>
                                                <td style={{ fontWeight: 600, color: r.amount > 0 ? 'var(--admin-success)' : 'var(--admin-text-muted)' }}>
                                                    {r.amount > 0 ? `+${r.amount.toLocaleString()}` : '—'}
                                                </td>
                                                <td style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
                                                    {r.balance_before.toLocaleString()} → {r.balance_after.toLocaleString()}
                                                </td>
                                                <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {r.note || <span className="text-muted">{r.reason}</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {topupTotal > 20 && (
                            <div style={{ display: 'flex', gap: 8, padding: '12px 0', justifyContent: 'center' }}>
                                <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => loadTopupHistory(topupPage - 1)} disabled={topupPage <= 1}>← Trước</button>
                                <span className="text-sm text-muted" style={{ margin: 'auto 8px' }}>Trang {topupPage}</span>
                                <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => loadTopupHistory(topupPage + 1)} disabled={topupPage * 20 >= topupTotal}>Sau →</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
