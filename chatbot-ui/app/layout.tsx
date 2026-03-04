import type { Metadata } from 'next'
import './../../globals.css'

export const metadata: Metadata = {
    title: 'Chatbot Widget',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="vi">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
            </head>
            <body style={{ margin: 0, padding: 0, background: 'transparent' }}>
                {children}
            </body>
        </html>
    )
}
