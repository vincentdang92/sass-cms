'use client'

// Error Boundary cho /widget/[tenantId] — phân loại lỗi theo HTTP status

export default function TenantWidgetError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    // Detect lỗi phổ biến từ message
    const isQuota = error.message?.includes('429') || error.message?.toLowerCase().includes('quota')
    const isAuth = error.message?.includes('401') || error.message?.toLowerCase().includes('api key')
    const isDown = error.message?.includes('503') || error.message?.includes('502')

    const icon = isAuth ? '🔑' : isQuota ? '📈' : isDown ? '🔧' : '🤖'
    const title = isAuth
        ? 'API key không hợp lệ'
        : isQuota
            ? 'Đã đạt giới hạn yêu cầu hôm nay'
            : isDown
                ? 'Dịch vụ đang bảo trì'
                : 'Widget tạm thời không khả dụng'
    const desc = isAuth
        ? 'Vui lòng kiểm tra lại cấu hình API key.'
        : isQuota
            ? 'Chatbot hết lượt sử dụng hôm nay. Vui lòng thử lại vào ngày mai.'
            : 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.'

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '100vh',
            fontFamily: '-apple-system, sans-serif',
            background: '#f8fafc', padding: 24, textAlign: 'center',
        }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
            <h3 style={{ margin: '0 0 8px', color: '#1e293b', fontSize: 16, fontWeight: 600 }}>
                {title}
            </h3>
            <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13, lineHeight: 1.6, maxWidth: 280 }}>
                {desc}
            </p>
            {!isAuth && !isQuota && (
                <button onClick={reset} style={{
                    padding: '8px 20px', background: '#3b82f6', color: '#fff',
                    border: 'none', borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                }}>
                    Thử lại
                </button>
            )}
        </div>
    )
}
