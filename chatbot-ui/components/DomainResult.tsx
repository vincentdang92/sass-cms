'use client'

interface Props {
    domain: string
    available: boolean
    price?: number
    registrar?: string
    expires?: string
    onBuy?: () => void
}

export function DomainResult({ domain, available, price, registrar, expires, onBuy }: Props) {
    return (
        <div className="component-card">
            <div className="component-header">
                <span>🌐 Kiểm tra Domain</span>
            </div>

            <div className={`domain-status ${available ? 'available' : 'taken'}`}>
                <span className="domain-name">{domain}</span>
                <span className={`status-badge ${available ? 'green' : 'red'}`}>
                    {available ? '✅ Còn trống' : '❌ Đã đăng ký'}
                </span>
            </div>

            {available && price && (
                <div className="domain-price-row">
                    <span className="price-label">Giá đăng ký</span>
                    <span className="price-value">{price.toLocaleString('vi-VN')}đ/năm</span>
                </div>
            )}

            {!available && (
                <div className="domain-info">
                    {registrar && <div><span>Registrar:</span> {registrar}</div>}
                    {expires && <div><span>Hết hạn:</span> {expires}</div>}
                </div>
            )}

            {available && (
                <button
                    className="action-btn primary"
                    onClick={onBuy}
                >
                    Đăng ký {domain}
                </button>
            )}

            {!available && (
                <p className="suggestion-text">
                    💡 Bạn có thể thử: <strong>{domain.split('.')[0]}.net</strong> hoặc <strong>{domain.split('.')[0]}.vn</strong>
                </p>
            )}
        </div>
    )
}
