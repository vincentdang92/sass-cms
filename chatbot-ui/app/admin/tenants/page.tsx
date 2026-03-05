'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const PLANS = [
    { value: 'free', label: 'Free', limit: 100, color: 'badge-yellow' },
    { value: 'pro', label: 'Pro', limit: 1000, color: 'badge-blue' },
    { value: 'enterprise', label: 'Enterprise', limit: 99999, color: 'badge-green' },
]

export default function TenantsPage() {
    const [tenants, setTenants] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [regenStatus, setRegenStatus] = useState<Record<string, string>>({})
    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://127.0.0.1:8001'

    const getSecret = () => typeof window !== 'undefined' ? localStorage.getItem('admin_secret') || '' : ''

    const fetchTenants = () => {
        const secret = getSecret()
        fetch(`${apiUrl}/admin/customers`, { headers: { 'x-admin-secret': secret } })
            .then(r => r.json())
            .then(data => Array.isArray(data) && setTenants(data))
            .finally(() => setLoading(false))
    }

    useEffect(() => { fetchTenants() }, [])

    const handleRegenKey = async (tenantId: string) => {
        if (!confirm(`Tạo API Key mới cho "${tenantId}"?\nKey cũ sẽ bị vô hiệu hóa ngay lập tức!`)) return
        setRegenStatus(s => ({ ...s, [tenantId]: 'loading' }))
        const secret = getSecret()
        try {
            const res = await fetch(`${apiUrl}/admin/customers/${tenantId}/regenerate-key`, {
                method: 'POST',
                headers: { 'x-admin-secret': secret }
            })
            const data = await res.json()
            if (res.ok) {
                setRegenStatus(s => ({ ...s, [tenantId]: data.api_key }))
                // Update tenant list locally
                setTenants(ts => ts.map(t => t.id === tenantId ? { ...t, api_key: data.api_key } : t))
            } else {
                setRegenStatus(s => ({ ...s, [tenantId]: 'error' }))
            }
        } catch {
            setRegenStatus(s => ({ ...s, [tenantId]: 'error' }))
        }
    }

    const handleChangePlan = async (tenantId: string, plan: string) => {
        const secret = getSecret()
        const planDef = PLANS.find(p => p.value === plan)
        await fetch(`${apiUrl}/admin/customers/${tenantId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
            body: JSON.stringify({ plan, max_requests_day: planDef?.limit || 100, is_active: true })
        })
        setTenants(ts => ts.map(t => t.id === tenantId ? { ...t, plan } : t))
    }

    const handleToggleActive = async (tenantId: string, currentActive: boolean) => {
        const secret = getSecret()
        await fetch(`${apiUrl}/admin/customers/${tenantId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
            body: JSON.stringify({ is_active: !currentActive })
        })
        setTenants(ts => ts.map(t => t.id === tenantId ? { ...t, active: !currentActive } : t))
    }

    const planBadge = (plan: string) => {
        const p = PLANS.find(p => p.value === plan)
        return <span className={`badge ${p?.color || 'badge-yellow'}`}>{p?.label || plan}</span>
    }

    return (
        <>
            <div className="admin-topbar">
                <div>
                    <h1 className="admin-page-title">🏢 Tenants</h1>
                    <p className="admin-page-sub">Quản lý khách hàng SaaS · {tenants.length} tenant{tenants.length !== 1 ? 's' : ''}</p>
                </div>
                <Link href="/admin/tenants/new" className="admin-btn admin-btn-primary">
                    ➕ Tạo Tenant mới
                </Link>
            </div>

            {/* Plan Overview */}
            <div className="admin-card-grid" style={{ marginBottom: 24 }}>
                {PLANS.map(plan => {
                    const count = tenants.filter(t => t.plan === plan.value).length
                    return (
                        <div key={plan.value} className="admin-stat-card">
                            <span className="admin-stat-icon">{plan.value === 'free' ? '🆓' : plan.value === 'pro' ? '⭐' : '🚀'}</span>
                            <div className="admin-stat-value">{count}</div>
                            <div className="admin-stat-label">Gói {plan.label}</div>
                            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                                {plan.limit >= 99999 ? 'Không giới hạn' : `${plan.limit.toLocaleString()} req/ngày`}
                            </div>
                        </div>
                    )
                })}
                <div className="admin-stat-card">
                    <span className="admin-stat-icon">💬</span>
                    <div className="admin-stat-value" style={{ color: 'var(--admin-primary)' }}>
                        {tenants.reduce((s, t) => s + (t.requests_today || 0), 0)}
                    </div>
                    <div className="admin-stat-label">Tổng requests hôm nay</div>
                </div>
            </div>

            <div className="admin-card">
                {loading ? (
                    <p className="text-muted" style={{ textAlign: 'center', padding: 40 }}>Đang tải...</p>
                ) : tenants.length === 0 ? (
                    <div className="admin-empty">
                        <div className="admin-empty-icon">🏢</div>
                        <h3>Chưa có Tenant nào</h3>
                        <p>Bắt đầu bằng cách <Link href="/admin/tenants/new" style={{ color: 'var(--admin-primary)' }}>tạo Tenant đầu tiên</Link></p>
                    </div>
                ) : (
                    <div className="admin-table-wrap">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Tenant</th>
                                    <th>API Key</th>
                                    <th>Plan</th>
                                    <th>Trạng thái</th>
                                    <th>Requests hôm nay</th>
                                    <th>Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tenants.map((t: any) => (
                                    <tr key={t.id}>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{t.name || t.id}</div>
                                            <code style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>{t.id}</code>
                                        </td>
                                        <td>
                                            {regenStatus[t.id] && regenStatus[t.id] !== 'loading' && regenStatus[t.id] !== 'error' ? (
                                                <div>
                                                    <span className="truncate-key" style={{ color: 'var(--admin-success)' }} title={regenStatus[t.id]}>{regenStatus[t.id]}</span>
                                                    <div style={{ fontSize: 11, color: 'var(--admin-success)', marginTop: 2 }}>✅ Key mới — lưu lại ngay!</div>
                                                </div>
                                            ) : (
                                                <span className="truncate-key" title={t.api_key}>{t.api_key || '—'}</span>
                                            )}
                                        </td>
                                        <td>
                                            {/* Inline plan switcher */}
                                            <select
                                                className="admin-select"
                                                value={t.plan || 'free'}
                                                onChange={e => handleChangePlan(t.id, e.target.value)}
                                                style={{ padding: '4px 8px', fontSize: 12, minWidth: 110 }}
                                            >
                                                {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                            </select>
                                        </td>
                                        <td>
                                            <button
                                                className={`badge ${t.active ? 'badge-green' : 'badge-red'}`}
                                                style={{ cursor: 'pointer', border: 'none' }}
                                                onClick={() => handleToggleActive(t.id, t.active)}
                                                title="Click để đổi trạng thái"
                                            >
                                                {t.active ? '● Active' : '○ Inactive'}
                                            </button>
                                        </td>
                                        <td>
                                            <span style={{ color: t.requests_today >= (t.max_requests_day * 0.8) ? 'var(--admin-warning)' : 'inherit' }}>
                                                {t.requests_today || 0}
                                                <span className="text-muted text-sm"> / {t.max_requests_day || '?'}</span>
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <Link href={`/admin/tenants/${t.id}`} className="admin-btn admin-btn-ghost admin-btn-sm">
                                                    ✏️ Chi tiết
                                                </Link>
                                                <button
                                                    className="admin-btn admin-btn-danger admin-btn-sm"
                                                    onClick={() => handleRegenKey(t.id)}
                                                    disabled={regenStatus[t.id] === 'loading'}
                                                    title="Tạo lại API Key"
                                                >
                                                    {regenStatus[t.id] === 'loading' ? '⏳' : '🔑 Regen Key'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    )
}
