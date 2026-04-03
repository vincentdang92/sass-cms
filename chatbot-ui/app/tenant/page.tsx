'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// Skeleton placeholder khi đang check auth
function DashboardSkeleton() {
    const pulse = {
        background: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-pulse 1.4s ease infinite',
        borderRadius: 8,
    } as React.CSSProperties

    return (
        <div style={{ padding: 28 }}>
            <style>{`
                @keyframes skeleton-pulse {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
            `}</style>

            {/* Header skeleton */}
            <div style={{ marginBottom: 28 }}>
                <div style={{ ...pulse, height: 28, width: 220, marginBottom: 10 }} />
                <div style={{ ...pulse, height: 16, width: 340 }} />
            </div>

            {/* Tab bar skeleton */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                {[120, 100, 130, 80].map((w, i) => (
                    <div key={i} style={{ ...pulse, height: 38, width: w, borderRadius: 8 }} />
                ))}
            </div>

            {/* Cards skeleton */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
                {[1, 2, 3].map(i => (
                    <div key={i} style={{
                        background: '#fff', borderRadius: 12, padding: 20,
                        border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 14,
                    }}>
                        <div style={{ ...pulse, width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ ...pulse, height: 12, width: '60%', marginBottom: 8 }} />
                            <div style={{ ...pulse, height: 18, width: '80%' }} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Body skeleton */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e2e8f0' }}>
                {[100, 80, 90, 70, 85].map((w, i) => (
                    <div key={i} style={{ ...pulse, height: 14, width: `${w}%`, marginBottom: 12 }} />
                ))}
            </div>
        </div>
    )
}

export default function TenantRootPage() {
    const router = useRouter()
    const [checking, setChecking] = useState(true)

    useEffect(() => {
        // Check auth rồi redirect — ngắn nhất có thể để tránh flash
        const key = sessionStorage.getItem('tenant_api_key')
        if (key) {
            router.replace('/tenant/dashboard')
        } else {
            router.replace('/tenant/login')
        }
        setChecking(false)
    }, [router])

    // Hiển thị skeleton trong lúc chờ redirect
    if (checking) return <DashboardSkeleton />
    return null
}
