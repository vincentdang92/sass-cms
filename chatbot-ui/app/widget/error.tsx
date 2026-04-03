'use client'

// Widget route-level Error Boundary
// Bắt mọi lỗi JS trong /widget/** — không propagate lên admin/tenant layout

export default function WidgetError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '100vh',
            fontFamily: '-apple-system, sans-serif',
            background: '#f8fafc', padding: 24, textAlign: 'center',
        }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
            <h3 style={{ margin: '0 0 8px', color: '#1e293b', fontSize: 16, fontWeight: 600 }}>
                Widget tạm thời không khả dụng
            </h3>
            <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>
                Hệ thống đang gặp sự cố. Vui lòng thử lại sau ít phút.
            </p>
            <button
                onClick={reset}
                style={{
                    padding: '8px 20px', background: '#3b82f6', color: '#fff',
                    border: 'none', borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                }}
            >
                Thử lại
            </button>
        </div>
    )
}
