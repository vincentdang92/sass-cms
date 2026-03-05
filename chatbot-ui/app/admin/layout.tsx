import type { Metadata } from 'next'
import './admin.css'

export const metadata: Metadata = {
    title: 'Admin Dashboard — SaaS Chatbot',
    description: 'Admin panel for managing chatbot tenants',
}

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
    // The actual layout (sidebar etc.) is inside the (dash) group
    // Here we just provide the html wrapper for admin pages
    return <>{children}</>
}
