'use client'

// Global Error Boundary cho Widget — fallback cuối cùng nếu error.tsx crash
// Phải là file global-error.tsx (Next.js convention), không thể ở nested routes

export default function WidgetGlobalError({
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <html lang="vi">
            <body style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: '100vh', margin: 0, background: '#f8fafc',
                fontFamily: '-apple-system, sans-serif',
            }}>
                <div style={{ textAlign: 'center', padding: 32, maxWidth: 320 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
                    <h3 style={{ margin: '0 0 8px', color: '#1e293b', fontSize: 16 }}>
                        Widget không khả dụng
                    </h3>
                    <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13 }}>
                        Đã xảy ra lỗi nghiêm trọng. Vui lòng tải lại trang.
                    </p>
                    <button onClick={reset} style={{
                        padding: '8px 20px', background: '#3b82f6', color: '#fff',
                        border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                    }}>
                        Tải lại
                    </button>
                </div>
            </body>
        </html>
    )
}
