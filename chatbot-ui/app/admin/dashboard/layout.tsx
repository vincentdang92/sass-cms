'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV = [
    { href: '/admin/dashboard', icon: '📊', label: 'Dashboard' },
    { href: '/admin/tenants', icon: '🏢', label: 'Tenants' },
    { href: '/admin/tenants/new', icon: '➕', label: 'Tạo Tenant mới' },
]

export default function AdminDashLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [adminSecret, setAdminSecret] = useState('')

    useEffect(() => {
        const s = localStorage.getItem('admin_secret')
        if (!s) {
            router.replace('/admin')
        } else {
            setAdminSecret(s)
        }
    }, [router])

    const handleLogout = () => {
        localStorage.removeItem('admin_secret')
        router.push('/admin')
    }

    return (
        <div className="admin-root">
            <aside className="admin-sidebar">
                <div className="admin-sidebar-logo">
                    <h1>⚡ SaaS Admin</h1>
                    <span>Quản trị hệ thống</span>
                </div>
                <nav className="admin-nav">
                    <div className="admin-nav-label">Menu</div>
                    {NAV.map(item => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`admin-nav-item ${pathname === item.href ? 'active' : ''}`}
                        >
                            <span>{item.icon}</span>
                            {item.label}
                        </Link>
                    ))}
                    <div className="admin-nav-label" style={{ marginTop: 20 }}>Tài khoản</div>
                    <button
                        onClick={handleLogout}
                        className="admin-nav-item"
                        style={{ cursor: 'pointer', width: '100%', textAlign: 'left', border: 'none', background: 'none' }}
                    >
                        <span>🚪</span>Đăng xuất
                    </button>
                </nav>
            </aside>
            <main className="admin-main">
                {children}
            </main>
        </div>
    )
}
