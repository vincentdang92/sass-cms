'use client'
import { useEffect, useState } from 'react'

interface Stats {
    total: number
    active: number
    requests: number
}

interface RedisStats {
    status: string
    uptime_days?: number
    memory_used_mb?: number
    memory_peak_mb?: number
    connected_clients?: number
    total_keys?: number
    hits?: number
    misses?: number
    error?: string
}

export default function DashboardPage() {
    const [stats, setStats] = useState<Stats>({ total: 0, active: 0, requests: 0 })
    const [tenants, setTenants] = useState<any[]>([])
    const [redisStats, setRedisStats] = useState<RedisStats | null>(null)
    const [loading, setLoading] = useState(true)
    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://127.0.0.1:8001'

    useEffect(() => {
        const secret = localStorage.getItem('admin_secret')
        if (!secret) return

        fetch(`${apiUrl}/admin/customers`, {
            headers: { 'x-admin-secret': secret }
        })
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setTenants(data)
                    setStats({
                        total: data.length,
                        active: data.filter((c: any) => c.active).length,
                        requests: data.reduce((sum: number, c: any) => sum + (c.requests_today || 0), 0)
                    })
                }
            })
            .finally(() => setLoading(false))

        fetch(`${apiUrl}/admin/system/redis-stats`, {
            headers: { 'x-admin-secret': secret }
        })
            .then(r => r.json())
            .then(data => setRedisStats(data))
            .catch(() => setRedisStats({ status: 'offline', error: 'Không thể kết nối API' }))
    }, [apiUrl])

    if (loading) {
        return (
            <div style={{ textAlign: 'center', padding: '80px', color: 'var(--admin-text-muted)' }}>
                Đang tải dữ liệu...
            </div>
        )
    }

    return (
        <>
            <div className="admin-topbar">
                <div>
                    <h1 className="admin-page-title">📊 Dashboard</h1>
                    <p className="admin-page-sub">Tổng quan hệ thống SaaS Chatbot</p>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="admin-card-grid">
                <div className="admin-stat-card">
                    <span className="admin-stat-icon">🏢</span>
                    <div className="admin-stat-value">{stats.total}</div>
                    <div className="admin-stat-label">Tổng số Tenant</div>
                </div>
                <div className="admin-stat-card">
                    <span className="admin-stat-icon">✅</span>
                    <div className="admin-stat-value" style={{ color: 'var(--admin-success)' }}>{stats.active}</div>
                    <div className="admin-stat-label">Tenant đang hoạt động</div>
                </div>
                <div className="admin-stat-card">
                    <span className="admin-stat-icon">💬</span>
                    <div className="admin-stat-value" style={{ color: 'var(--admin-primary)' }}>{stats.requests}</div>
                    <div className="admin-stat-label">Yêu cầu hôm nay</div>
                </div>
                <div className="admin-stat-card">
                    <span className="admin-stat-icon">🧠</span>
                    <div className="admin-stat-value" style={{ color: 'var(--admin-warning)' }}>RAG</div>
                    <div className="admin-stat-label">Engine đang dùng</div>
                </div>
            </div>

            {/* Redis Cache Stats Table */}
            <div className="admin-card" style={{ marginBottom: 24 }}>
                <div className="admin-section-header">
                    <div>
                        <span className="admin-section-title">⚡ Trạng thái Redis Cache</span>
                        <div style={{ fontSize: 13, color: 'var(--admin-text-muted)', marginTop: 4 }}>
                            Bộ đệm tăng tốc AI RAG và Memory Storage
                            {redisStats && <span className={`badge ${redisStats.status === 'online' ? 'badge-green' : 'badge-red'}`} style={{ marginLeft: 8 }}>{redisStats.status === 'online' ? 'Online' : 'Offline'}</span>}
                        </div>
                    </div>
                </div>
                
                {!redisStats ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--admin-text-muted)' }}>Đang tải...</div>
                ) : redisStats.status === 'offline' ? (
                    <div className="admin-empty" style={{ padding: 20 }}>
                        <div className="admin-empty-icon" style={{ fontSize: 24 }}>⚠️</div>
                        <h4 style={{ margin: '8px 0', fontSize: 14 }}>Redis đang tắt</h4>
                        <p style={{ fontSize: 13, margin: 0, color: 'var(--admin-danger)' }}>{redisStats.error || 'Vui lòng kiểm tra Docker container chatbot-redis'}</p>
                    </div>
                ) : (
                    <div className="admin-table-wrap">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Uptime (ngày)</th>
                                    <th>Bộ nhớ dùng / Peak (MB)</th>
                                    <th>Keys đang lưu</th>
                                    <th>Clients đang kết nối</th>
                                    <th>Tỉ lệ Hit / Miss</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>{redisStats.uptime_days}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span>{redisStats.memory_used_mb}</span>
                                            <span style={{ color: 'var(--admin-text-muted)', fontSize: 12 }}>/ {redisStats.memory_peak_mb}</span>
                                        </div>
                                    </td>
                                    <td><span className="badge badge-blue">{redisStats.total_keys}</span></td>
                                    <td>{redisStats.connected_clients}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <span style={{ color: 'var(--admin-success)', fontWeight: 600 }}>{redisStats.hits || 0}</span>
                                            <span style={{ color: 'var(--admin-text-muted)' }}>/</span>
                                            <span style={{ color: 'var(--admin-warning)' }}>{redisStats.misses || 0}</span>
                                        </div>
                                        {((redisStats.hits || 0) + (redisStats.misses || 0) > 0) && (
                                            <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 4 }}>
                                                Hit rate: {Math.round(((redisStats.hits || 0) / ((redisStats.hits || 0) + (redisStats.misses || 0))) * 100)}%
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Recent Tenants Table */}
            <div className="admin-card">
                <div className="admin-section-header">
                    <span className="admin-section-title">🏢 Danh sách Tenant</span>
                    <a href="/admin/tenants" className="admin-btn admin-btn-ghost admin-btn-sm">Xem tất cả →</a>
                </div>
                <div className="admin-table-wrap">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Tên</th>
                                <th>Plan</th>
                                <th>Trạng thái</th>
                                <th>Requests hôm nay</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tenants.slice(0, 5).map((t: any) => (
                                <tr key={t.id}>
                                    <td><code style={{ fontSize: 12 }}>{t.id}</code></td>
                                    <td><a href={`/admin/tenants/${t.id}`} style={{ color: 'var(--admin-primary)', textDecoration: 'none' }}>{t.name || t.id}</a></td>
                                    <td><span className={`badge ${t.plan === 'pro' ? 'badge-blue' : 'badge-yellow'}`}>{t.plan || 'free'}</span></td>
                                    <td><span className={`badge ${t.active ? 'badge-green' : 'badge-red'}`}>{t.active ? 'Active' : 'Inactive'}</span></td>
                                    <td>{t.requests_today || 0}</td>
                                </tr>
                            ))}
                            {tenants.length === 0 && (
                                <tr>
                                    <td colSpan={5}>
                                        <div className="admin-empty">
                                            <div className="admin-empty-icon">🏢</div>
                                            <h3>Chưa có Tenant nào</h3>
                                            <p><a href="/admin/tenants/new" style={{ color: 'var(--admin-primary)' }}>Tạo Tenant đầu tiên →</a></p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    )
}
