'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type BotConfig = {
    id: string; bot_name: string; system_prompt: string
    qdrant_collection: string; plan: string; quick_questions: string[]
    mcp_server_url?: string; mcp_auth_token?: string
    industry?: string; greeting_message?: string;
}
type KBJob = { id: string; filename: string; status: string; processed_chunks: number; error_message?: string }
type KBDoc = { id: string; content: string; metadata: Record<string, unknown> }

const TABS = ['overview', 'analytics', 'kb', 'chathistory', 'settings'] as const
type Tab = typeof TABS[number]

const TAB_LABELS: Record<Tab, string> = {
    overview: '📊 Tổng quan', analytics: '📈 Analytics', kb: '📁 Knowledge Base',
    chathistory: '💬 Chat History', settings: '⚙️ Cài đặt',
}

export default function TenantDashboard() {
    const router = useRouter()
    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://localhost:8001'
    const [apiKey, setApiKey] = useState('')
    const [config, setConfig] = useState<BotConfig | null>(null)
    const [tab, setTab] = useState<Tab>('overview')
    const [kbJobs, setKbJobs] = useState<KBJob[]>([])
    const [kbDocs, setKbDocs] = useState<KBDoc[]>([])
    
    // Analytics state
    const [analyticsLogs, setAnalyticsLogs] = useState<any[]>([])
    const [analyticsStats, setAnalyticsStats] = useState<any>(null)
    const [optimizeLog, setOptimizeLog] = useState<any>(null)
    const [optimizeTab, setOptimizeTab] = useState<'A' | 'B'>('B')
    const [manualAnswer, setManualAnswer] = useState('')
    const [editingChunk, setEditingChunk] = useState<{ id: string, content: string } | null>(null)
    
    const [toast, setToast] = useState('')

    const showToast = (msg: string) => {
        setToast(msg)
        setTimeout(() => setToast(''), 5000)
    }

    // Auth guard + load config
    useEffect(() => {
        const key = sessionStorage.getItem('tenant_api_key') || ''
        if (!key) { router.replace('/tenant/login'); return }
        setApiKey(key)
        fetch(`${apiUrl}/admin/customers/me`, { headers: { 'x-api-key': key } })
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setConfig(data) })
    }, [apiUrl, router])

    // Load KB jobs
    const loadJobs = useCallback(async () => {
        if (!apiKey) return
        const r = await fetch(`${apiUrl}/kb/jobs`, { headers: { 'x-api-key': apiKey } })
        if (r.ok) setKbJobs(await r.json())
    }, [apiKey, apiUrl])

    // Load KB docs
    const loadDocs = useCallback(async () => {
        if (!apiKey) return
        const r = await fetch(`${apiUrl}/admin/customers/${config?.id}/kb?limit=50`, {
            headers: { 'x-api-key': apiKey }
        })
        if (r.ok) {
            const data = await r.json()
            setKbDocs(data.docs || [])
        }
    }, [apiKey, apiUrl, config?.id])

    useEffect(() => {
        if (tab === 'kb' && apiKey) { loadJobs(); loadDocs() }
    }, [tab, apiKey, loadJobs, loadDocs])

    // Load Analytics
    const loadAnalytics = useCallback(async () => {
        if (!apiKey) return
        const rStats = await fetch(`${apiUrl}/analytics/rag-stats`, { headers: { 'x-api-key': apiKey } })
        if (rStats.ok) setAnalyticsStats(await rStats.json())

        const rLogs = await fetch(`${apiUrl}/analytics/rag-logs?limit=50`, { headers: { 'x-api-key': apiKey } })
        if (rLogs.ok) {
            const data = await rLogs.json()
            setAnalyticsLogs(data.logs || [])
        }
    }, [apiKey, apiUrl])

    useEffect(() => {
        if (tab === 'analytics' && apiKey) { loadAnalytics() }
    }, [tab, apiKey, loadAnalytics])

    // Polling KB jobs
    useEffect(() => {
        if (tab !== 'kb' || !apiKey) return
        const iv = setInterval(loadJobs, 5000)
        return () => clearInterval(iv)
    }, [tab, apiKey, loadJobs])

    // Upload KB
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return
        const form = new FormData()
        Array.from(files).forEach(f => form.append('files', f))
        const r = await fetch(`${apiUrl}/kb/upload`, {
            method: 'POST', headers: { 'x-api-key': apiKey }, body: form
        })
        if (r.ok) {
            showToast('✅ Đã tải lên — đang xử lý trong nền...')
            loadJobs()
        } else {
            const err = await r.json()
            showToast(`❌ ${err.detail || 'Upload thất bại'}`)
        }
        e.target.value = ''
    }

    // Save settings
    const [settingsForm, setSettingsForm] = useState({ bot_name: '', system_prompt: '', quick_questions: '', industry: '', greeting_message: '' })
    useEffect(() => {
        if (config) setSettingsForm({
            bot_name: config.bot_name || '',
            system_prompt: config.system_prompt || '',
            quick_questions: Array.isArray(config.quick_questions) ? config.quick_questions.join('\n') : '',
            industry: config.industry || '',
            greeting_message: config.greeting_message || '',
        })
    }, [config])

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault()
        const qs = settingsForm.quick_questions.split('\n').map(q => q.trim()).filter(Boolean)
        const r = await fetch(`${apiUrl}/admin/customers/${config?.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ 
                bot_name: settingsForm.bot_name, 
                system_prompt: settingsForm.system_prompt, 
                quick_questions: qs,
                industry: settingsForm.industry,
                greeting_message: settingsForm.greeting_message
            })
        })
        if (r.ok) showToast('✅ Đã lưu cài đặt')
        else showToast('❌ Lưu thất bại')
    }

    // Optimize Handlers
    const handleAddManualQA = async () => {
        if (!manualAnswer.trim() || !optimizeLog) return
        const content = `Hỏi: ${optimizeLog.query}\nĐáp: ${manualAnswer}`
        const r = await fetch(`${apiUrl}/admin/customers/${config?.id}/kb/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ title: optimizeLog.query, content })
        })
        if (r.ok) {
            showToast('✅ Đã thêm câu hỏi vào Knowledge Base!')
            setOptimizeLog(null)
            setManualAnswer('')
            loadJobs() // refresh tasks if needed
        } else {
            showToast('❌ Thêm thất bại')
        }
    }

    const handleUpdateChunk = async () => {
        if (!editingChunk || !optimizeLog) return
        const r = await fetch(`${apiUrl}/admin/customers/${config?.id}/kb/${editingChunk.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ content: editingChunk.content })
        })
        if (r.ok) {
            showToast('✅ Đã cập nhật Chunk!')
            setEditingChunk(null)
            setOptimizeLog(null)
        } else {
            showToast('❌ Cập nhật thất bại')
        }
    }

    const statusColor: Record<string, string> = {
        completed: '#22c55e', failed: '#ef4444', processing: '#f59e0b', pending: '#94a3b8',
    }

    const s: Record<string, React.CSSProperties> = {
        card: { background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0', marginBottom: 16 },
        label: { display: 'block', fontSize: 13, color: '#64748b', marginBottom: 6, fontWeight: 500 },
        input: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, boxSizing: 'border-box' as const },
        btn: { padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
    }

    return (
        <div style={{ padding: 28, minHeight: '100vh' }}>
            {/* Page header */}
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#1e293b' }}>
                    {config?.bot_name || 'Tenant Dashboard'}
                </h1>
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                    Plan: <b>{config?.plan}</b> · Collection: <code>{config?.qdrant_collection}</code>
                </p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
                {TABS.map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        ...s.btn,
                        background: tab === t ? '#3b82f6' : '#fff',
                        color: tab === t ? '#fff' : '#64748b',
                        border: `1px solid ${tab === t ? '#3b82f6' : '#e2e8f0'}`,
                    }}>
                        {TAB_LABELS[t]}
                    </button>
                ))}
            </div>

            {/* ── OVERVIEW TAB ── */}
            {tab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
                    {[
                        { label: 'Bot Name', value: config?.bot_name || '—', icon: '🤖' },
                        { label: 'Ngành nghề', value: config?.industry || 'Chung', icon: '🌍' },
                        { label: 'Plan', value: config?.plan || '—', icon: '📦' },
                        { label: 'MCP Server', value: config?.mcp_server_url ? '✅ Đã cấu hình' : '❌ Chưa cấu hình', icon: '🔌' },
                    ].map(item => (
                        <div key={item.label} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ fontSize: 28 }}>{item.icon}</div>
                            <div>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>{item.label}</div>
                                <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 15 }}>{item.value}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── ANALYTICS TAB ── */}
            {tab === 'analytics' && (
                <>
                    {analyticsStats && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
                            <div style={s.card}>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>Tổng Query</div>
                                <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 24 }}>{analyticsStats.total_queries}</div>
                            </div>
                            <div style={s.card}>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>Câu hỏi Rủi Ro (Miss / Score &lt; 0.4)</div>
                                <div style={{ fontWeight: 600, color: '#ef4444', fontSize: 24 }}>{analyticsStats.miss_queries}</div>
                            </div>
                            <div style={s.card}>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>Tỉ lệ Miss Rate</div>
                                <div style={{ fontWeight: 600, color: '#f59e0b', fontSize: 24 }}>{analyticsStats.miss_rate_pct}%</div>
                            </div>
                            <div style={s.card}>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>Độ trễ trung bình DB</div>
                                <div style={{ fontWeight: 600, color: '#22c55e', fontSize: 24 }}>{analyticsStats.avg_latency_ms} ms</div>
                            </div>
                        </div>
                    )}
                    <div style={s.card}>
                        <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1e293b' }}>📝 Lịch sử Query gần đây</h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                                    <th style={{ padding: '8px 4px' }}>Thời gian</th>
                                    <th style={{ padding: '8px 4px' }}>Query</th>
                                    <th style={{ padding: '8px 4px' }}>Mode</th>
                                    <th style={{ padding: '8px 4px' }}>Top Score</th>
                                    <th style={{ padding: '8px 4px' }}>Chunks trả về</th>
                                    <th style={{ padding: '8px 4px' }}>Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analyticsLogs.map(log => (
                                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '8px 4px', color: '#94a3b8' }}>{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                                        <td style={{ padding: '8px 4px', fontWeight: 500, color: '#1e293b' }}>{log.query}</td>
                                        <td style={{ padding: '8px 4px' }}>
                                            <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{log.search_mode}</span>
                                        </td>
                                        <td style={{ padding: '8px 4px', color: log.top_score < 0.4 ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                                            {log.top_score.toFixed(3)}
                                        </td>
                                        <td style={{ padding: '8px 4px', color: '#64748b' }}>{log.retrieved_chunks?.length || 0}</td>
                                        <td style={{ padding: '8px 4px' }}>
                                            <button onClick={() => { setOptimizeLog(log); setOptimizeTab(log.top_score < 0.4 ? 'B' : 'A') }} style={{ ...s.btn, padding: '4px 10px', fontSize: 12, background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}>
                                                ⚡ Tối ưu
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {analyticsLogs.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Chưa có dữ liệu</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* ── KB TAB ── */}
            {tab === 'kb' && (
                <>
                    <div style={s.card}>
                        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#1e293b' }}>📤 Upload tài liệu</h3>
                        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
                            Hỗ trợ: PDF · TXT · CSV · XLSX · JSON (tối đa 10MB/file, 10 file/lần)
                        </p>
                        <label style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            padding: '10px 20px', background: '#3b82f6', color: '#fff',
                            borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                        }}>
                            📁 Chọn file
                            <input type="file" multiple accept=".pdf,.txt,.csv,.xlsx,.json,.md"
                                style={{ display: 'none' }} onChange={handleUpload} />
                        </label>
                    </div>

                    {kbJobs.length > 0 && (
                        <div style={s.card}>
                            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#1e293b' }}>📋 Trạng thái xử lý</h3>
                            {kbJobs.slice(0, 5).map(job => (
                                <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{job.filename}</div>
                                        {job.error_message && <div style={{ fontSize: 12, color: '#ef4444' }}>{job.error_message}</div>}
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: statusColor[job.status] || '#64748b', textTransform: 'capitalize' }}>
                                        {job.status === 'completed' ? `✅ ${job.processed_chunks} chunks` : job.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={s.card}>
                        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#1e293b' }}>📚 Tài liệu trong KB ({kbDocs.length})</h3>
                        {kbDocs.length === 0
                            ? <p style={{ color: '#94a3b8', fontSize: 13 }}>Chưa có tài liệu nào. Hãy upload file ở trên.</p>
                            : kbDocs.slice(0, 20).map(doc => (
                                <div key={doc.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#475569' }}>
                                    {String(doc.content).slice(0, 120)}…
                                </div>
                            ))
                        }
                    </div>
                </>
            )}

            {/* ── SETTINGS TAB ── */}
            {tab === 'settings' && (
                <div style={{ maxWidth: 640 }}>
                    <form onSubmit={handleSaveSettings}>
                        <div style={s.card}>
                            <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1e293b' }}>⚙️ Cài đặt Bot</h3>
                            <div style={{ marginBottom: 16 }}>
                                <label style={s.label}>Tên Bot</label>
                                <input style={s.input} value={settingsForm.bot_name}
                                    onChange={e => setSettingsForm(p => ({ ...p, bot_name: e.target.value }))} />
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label style={s.label}>Lĩnh vực hoạt động (Cung cấp ngữ cảnh cho AI)</label>
                                <input style={s.input} placeholder="VD: Dịch vụ Nail, Spa, Mỹ phẩm..."
                                    value={settingsForm.industry}
                                    onChange={e => setSettingsForm(p => ({ ...p, industry: e.target.value }))} />
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label style={s.label}>Câu chào mặc định (Greeting message)</label>
                                <input style={s.input} placeholder="Xin chào! Mình có thể giúp gì cho bạn?"
                                    value={settingsForm.greeting_message}
                                    onChange={e => setSettingsForm(p => ({ ...p, greeting_message: e.target.value }))} />
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label style={s.label}>System Prompt</label>
                                <textarea rows={6} style={{ ...s.input, resize: 'vertical', lineHeight: 1.6 }}
                                    value={settingsForm.system_prompt}
                                    onChange={e => setSettingsForm(p => ({ ...p, system_prompt: e.target.value }))} />
                            </div>
                            <div style={{ marginBottom: 20 }}>
                                <label style={s.label}>Câu hỏi nhanh (mỗi dòng 1 câu)</label>
                                <textarea rows={4} style={{ ...s.input, resize: 'vertical', lineHeight: 1.6 }}
                                    placeholder={'Giá domain .com là bao nhiêu?\nCách đặt hàng thế nào?'}
                                    value={settingsForm.quick_questions}
                                    onChange={e => setSettingsForm(p => ({ ...p, quick_questions: e.target.value }))} />
                            </div>
                            <button type="submit" style={{ ...s.btn, background: '#3b82f6', color: '#fff' }}>
                                💾 Lưu thay đổi
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── CHAT HISTORY TAB ── */}
            {tab === 'chathistory' && (
                <div style={s.card}>
                    <p style={{ color: '#94a3b8', fontSize: 14 }}>
                        💬 Xem lịch sử trò chuyện của khách hàng tại Admin → Chat Sessions.
                        (Tính năng chi tiết sẽ được mở trong phiên bản tới)
                    </p>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    background: '#1e293b', color: '#f1f5f9', padding: '12px 20px',
                    borderRadius: 10, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                    maxWidth: 360, animation: 'slideUp 0.3s ease',
                }}>
                    {toast}
                </div>
            )}

            {/* Optimize Modal */}
            {optimizeLog && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
                    <div style={{ background: '#fff', width: 600, maxWidth: '90%', borderRadius: 12, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: 16 }}>⚡ Tối ưu Query</h3>
                            <button onClick={() => setOptimizeLog(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>×</button>
                        </div>
                        
                        <div style={{ padding: 20, overflowY: 'auto' }}>
                            <div style={{ marginBottom: 16, background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Câu hỏi của khách (Query gốc):</div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>"{optimizeLog.query}"</div>
                                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4, display: optimizeLog.top_score < 0.4 ? 'block' : 'none' }}>
                                    ⚠️ Bot rủi ro cao vì điểm Score quá thấp ({optimizeLog.top_score.toFixed(3)}).
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
                                <button onClick={() => setOptimizeTab('B')} style={{ ...s.btn, background: optimizeTab === 'B' ? '#e0f2fe' : 'transparent', color: optimizeTab === 'B' ? '#0284c7' : '#64748b', padding: '6px 12px' }}>Phương án 1: Dạy câu trả lời mới</button>
                                <button onClick={() => setOptimizeTab('A')} style={{ ...s.btn, background: optimizeTab === 'A' ? '#e0f2fe' : 'transparent', color: optimizeTab === 'A' ? '#0284c7' : '#64748b', padding: '6px 12px' }}>Phương án 2: Sửa chunk hiện tại</button>
                            </div>

                            {optimizeTab === 'B' && (
                                <div>
                                    <p style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
                                        Nếu AI chưa có kiến thức này, hãy nhập câu trả lời trực tiếp. Hệ thống sẽ lưu thành 1 file Manual Text dạng Hỏi/Đáp để lần sau trả lời chính xác.
                                    </p>
                                    <textarea 
                                        rows={4} style={{ ...s.input, resize: 'vertical' }}
                                        placeholder="Nhập câu trả lời cho câu hỏi này..."
                                        value={manualAnswer}
                                        onChange={e => setManualAnswer(e.target.value)}
                                    />
                                    <button onClick={handleAddManualQA} style={{ ...s.btn, background: '#3b82f6', color: '#fff', width: '100%', marginTop: 12 }}>
                                        Lưu thành Hỏi-Đáp mới
                                    </button>
                                </div>
                            )}

                            {optimizeTab === 'A' && (
                                <div>
                                    <p style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
                                        Dưới đây là các chunks mà hệ thống RAG kéo ra. Bạn có thể nhấn <b>Sửa</b> để thêm các từ khóa đồng nghĩa của khách vào nội dung để điểm Score cao hơn vào lần sau.
                                    </p>
                                    
                                    {(!optimizeLog.retrieved_chunks || optimizeLog.retrieved_chunks.length === 0) ? (
                                        <div style={{ fontSize: 13, color: '#ef4444' }}>Không có chunk nào được trả về. Vui lòng dùng Phương án 1.</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            {optimizeLog.retrieved_chunks.map((chk: any) => (
                                                <div key={chk.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#64748b' }}>
                                                        <span>Score: <b style={{ color: chk.score < 0.4 ? '#ef4444' : '#10b981' }}>{chk.score?.toFixed(3)}</b></span>
                                                        <button 
                                                            onClick={() => setEditingChunk({ id: chk.id, content: chk.content })}
                                                            style={{ border: 'none', background: 'none', color: '#3b82f6', cursor: 'pointer', fontWeight: 600 }}>
                                                            Sửa Chunk này
                                                        </button>
                                                    </div>
                                                    
                                                    {editingChunk?.id === chk.id ? (
                                                        <div>
                                                            <textarea 
                                                                rows={4} style={{ ...s.input, resize: 'vertical', fontSize: 13 }}
                                                                value={editingChunk?.content || ''}
                                                                onChange={e => setEditingChunk(prev => prev ? { ...prev, content: e.target.value } : null)}
                                                            />
                                                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                                                <button onClick={handleUpdateChunk} style={{ ...s.btn, background: '#22c55e', color: '#fff', padding: '6px 12px', fontSize: 12 }}>Lưu thay đổi</button>
                                                                <button onClick={() => setEditingChunk(null)} style={{ ...s.btn, background: '#e2e8f0', color: '#475569', padding: '6px 12px', fontSize: 12 }}>Hủy</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                                                            {chk.content}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
