'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
    const [secret, setSecret] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    useEffect(() => {
        if (typeof window !== 'undefined' && localStorage.getItem('admin_secret')) {
            router.replace('/admin/dashboard')
        }
    }, [router])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://127.0.0.1:8001'
        try {
            const res = await fetch(`${apiUrl}/admin/customers`, {
                headers: { 'x-admin-secret': secret }
            })
            if (res.ok) {
                localStorage.setItem('admin_secret', secret)
                router.push('/admin/dashboard')
            } else {
                setError('Sai mật khẩu admin. Vui lòng kiểm tra lại ADMIN_SECRET.')
            }
        } catch {
            setError('Không thể kết nối tới API. Kiểm tra backend đã chạy chưa.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="admin-login-wrap">
            <div className="admin-login-box">
                <div className="admin-login-logo">
                    <h1>⚡ SaaS Admin</h1>
                    <p>Đăng nhập để quản lý hệ thống chatbot</p>
                </div>

                <form onSubmit={handleLogin}>
                    <div className="admin-form-group">
                        <label className="admin-label">Admin Secret Key</label>
                        <input
                            type="password"
                            className="admin-input"
                            placeholder="Nhập ADMIN_SECRET..."
                            value={secret}
                            onChange={e => setSecret(e.target.value)}
                            required
                        />
                    </div>

                    {error && (
                        <div style={{
                            background: 'rgba(248,113,113,0.1)',
                            border: '1px solid rgba(248,113,113,0.3)',
                            borderRadius: '8px',
                            padding: '12px 14px',
                            fontSize: '13px',
                            color: '#f87171',
                            marginBottom: '20px'
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <button type="submit" className="admin-btn admin-btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
                        {loading ? 'Đang kiểm tra...' : '🔑 Đăng nhập'}
                    </button>
                </form>
            </div>
        </div>
    )
}
