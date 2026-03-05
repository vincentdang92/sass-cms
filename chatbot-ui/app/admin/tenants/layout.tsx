import AdminDashLayout from '../dashboard/layout'

export default function TenantsLayoutWrapper({ children }: { children: React.ReactNode }) {
    return <AdminDashLayout>{children}</AdminDashLayout>
}
