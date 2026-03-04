'use client'
import { useState } from 'react'

interface Props {
    message?: string
    apiKey: string
}

export function RatingWidget({ message, apiKey }: Props) {
    const [score, setScore] = useState(0)
    const [hovered, setHovered] = useState(0)
    const [comment, setComment] = useState('')
    const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
    const apiUrl = process.env.NEXT_PUBLIC_CHATBOT_API_URL || 'http://localhost:8000'

    const labels = ['', 'Rất tệ', 'Tệ', 'Bình thường', 'Tốt', 'Xuất sắc']

    async function submit() {
        if (!score) return
        setStatus('loading')
        await fetch(`${apiUrl}/crm/ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ score, comment }),
        })
        setStatus('done')
    }

    if (status === 'done') {
        return (
            <div className="component-card success-card">
                <div className="success-icon">🙏</div>
                <div className="success-title">Cảm ơn bạn đã đánh giá!</div>
                <div className="rating-display">{'⭐'.repeat(score)}</div>
            </div>
        )
    }

    return (
        <div className="component-card">
            <div className="component-header">
                <span>⭐ Đánh giá dịch vụ</span>
            </div>

            {message && <p className="rating-message">{message}</p>}

            <div className="stars-row">
                {[1, 2, 3, 4, 5].map(s => (
                    <button
                        key={s}
                        className={`star-btn ${s <= (hovered || score) ? 'active' : ''}`}
                        onMouseEnter={() => setHovered(s)}
                        onMouseLeave={() => setHovered(0)}
                        onClick={() => setScore(s)}
                        aria-label={`${s} sao`}
                    >
                        ★
                    </button>
                ))}
            </div>

            {score > 0 && (
                <p className="star-label">{labels[score]}</p>
            )}

            <textarea
                className="rating-comment"
                placeholder="Góp ý thêm (không bắt buộc)..."
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
            />

            <button
                className="action-btn primary"
                onClick={submit}
                disabled={!score || status === 'loading'}
            >
                {status === 'loading' ? 'Đang gửi...' : 'Gửi đánh giá'}
            </button>
        </div>
    )
}
