'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TenantLoginPage() {
    const [apiKey, setApiKey] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://localhost:8001'

    useEffect(() => {
        if (typeof window !== 'undefined' && sessionStorage.getItem('tenant_api_key')) {
            router.replace('/tenant/dashboard')
        }
    }, [router])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        try {
            const res = await fetch(`${apiUrl}/admin/customers/me`, {
                headers: { 'x-api-key': apiKey.trim() }
            })
            if (res.ok) {
                sessionStorage.setItem('tenant_api_key', apiKey.trim())
                router.push('/tenant/dashboard')
            } else {
                setError('API key không hợp lệ. Vui lòng kiểm tra lại.')
            }
        } catch {
            setError('Không thể kết nối tới server. Kiểm tra backend đã chạy chưa.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}>
            <div style={{
                background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20,
                padding: '48px 40px', width: '100%', maxWidth: 400,
                boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
            }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🏢</div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#f1f5f9' }}>
                        Tenant Portal
                    </h1>
                    <p style={{ margin: '8px 0 0', fontSize: 14, color: '#94a3b8' }}>
                        Quản lý chatbot của doanh nghiệp bạn
                    </p>
                </div>

                <form onSubmit={handleLogin}>
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6, fontWeight: 500 }}>
                            API Key
                        </label>
                        <input
                            type="password"
                            placeholder="Nhập API key của bạn..."
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            required
                            style={{
                                width: '100%', padding: '12px 14px', borderRadius: 10,
                                border: '1px solid rgba(255,255,255,0.15)',
                                background: 'rgba(255,255,255,0.05)', color: '#f1f5f9',
                                fontSize: 14, outline: 'none', boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {error && (
                        <div style={{
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 8, padding: '10px 14px', fontSize: 13,
                            color: '#f87171', marginBottom: 16,
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !apiKey.trim()}
                        style={{
                            width: '100%', padding: '13px', borderRadius: 10,
                            background: loading ? '#334155' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                            color: '#fff', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: 15, fontWeight: 600, transition: 'all 0.2s',
                        }}
                    >
                        {loading ? 'Đang xác thực...' : '🔑 Đăng nhập'}
                    </button>
                </form>

                <p style={{ textAlign: 'center', fontSize: 12, color: '#475569', marginTop: 24, marginBottom: 0 }}>
                    API key do Admin hệ thống cung cấp
                </p>
            </div>
        </div>
    )
}
