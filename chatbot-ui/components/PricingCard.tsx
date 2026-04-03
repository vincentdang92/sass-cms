'use client'
import { useState } from 'react'

interface PricingItem {
    name: string
    price: number
    unit: string
    highlight?: boolean
}

interface Props {
    category: string
    items: PricingItem[]
    onBuy?: (item: PricingItem) => void
}

const getCategoryLabel = (cat: string | undefined) => {
    if (!cat) return '🏷️ Dịch vụ'
    const labels: Record<string, string> = { domain: '🌐 Tên miền', hosting: '🖥️ Hosting', vps: '⚡ VPS' }
    return labels[cat.toLowerCase()] || `🏷️ ${cat}`
}

export function PricingCard({ category, items, onBuy }: Props) {
    const [selected, setSelected] = useState<PricingItem | null>(null)

    return (
        <div className="component-card">
            <div className="component-header">
                <span>{getCategoryLabel(category)}</span>
                <span className="component-badge">Bảng giá</span>
            </div>

            <div className="pricing-grid">
                {(items || []).map((item, i) => (
                    <div
                        key={i}
                        className={`pricing-item ${item.highlight ? 'highlight' : ''} ${selected?.name === item.name ? 'selected' : ''}`}
                        onClick={() => setSelected(item)}
                    >
                        <div className="pricing-name">{item.name || 'Đang tải...'}</div>
                        <div className="pricing-price">
                            {item.price?.toLocaleString('vi-VN') || 0}đ
                            <span className="pricing-unit">/{item.unit || 'năm'}</span>
                        </div>
                        {item.highlight && <span className="popular-badge">Phổ biến</span>}
                    </div>
                ))}
            </div>

            {selected && (
                <button
                    className="action-btn primary"
                    onClick={() => onBuy?.(selected)}
                >
                    Mua {selected.name} — {selected.price.toLocaleString('vi-VN')}đ
                </button>
            )}
        </div>
    )
}
