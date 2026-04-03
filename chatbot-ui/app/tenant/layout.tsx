'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

export default function TenantLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const isLoginPage = pathname === '/tenant/login'

    useEffect(() => {
        if (!isLoginPage && typeof window !== 'undefined') {
            const key = sessionStorage.getItem('tenant_api_key')
            if (!key) router.replace('/tenant/login')
        }
    }, [isLoginPage, router])

    if (isLoginPage) return <>{children}</>

    const handleLogout = () => {
        sessionStorage.removeItem('tenant_api_key')
        router.push('/tenant/login')
    }

    const navItems = [
        { href: '/tenant/dashboard', label: 'Dashboard', icon: '📊' },
    ]

    return (
        <div style={{
            display: 'flex', minHeight: '100vh',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            background: '#f1f5f9',
        }}>
            {/* Sidebar */}
            <aside style={{
                width: 240, background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                display: 'flex', flexDirection: 'column', padding: '24px 0',
                position: 'fixed', height: '100vh', zIndex: 50,
            }}>
                <div style={{ padding: '0 20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>🏢</div>
                    <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 16 }}>Tenant Portal</div>
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Quản lý chatbot</div>
                </div>

                <nav style={{ flex: 1, padding: '16px 12px' }}>
                    {navItems.map(item => {
                        const active = pathname.startsWith(item.href)
                        return (
                            <Link key={item.href} href={item.href} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                                background: active ? 'rgba(59,130,246,0.2)' : 'transparent',
                                color: active ? '#60a5fa' : '#94a3b8',
                                textDecoration: 'none', fontSize: 14, fontWeight: active ? 600 : 400,
                                transition: 'all 0.15s',
                            }}>
                                <span>{item.icon}</span>
                                <span>{item.label}</span>
                            </Link>
                        )
                    })}
                </nav>

                <div style={{ padding: '16px 12px' }}>
                    <button onClick={handleLogout} style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8,
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        color: '#f87171', cursor: 'pointer', fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        🚪 Đăng xuất
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main style={{ marginLeft: 240, flex: 1, minHeight: '100vh' }}>
                {children}
            </main>
        </div>
    )
}
