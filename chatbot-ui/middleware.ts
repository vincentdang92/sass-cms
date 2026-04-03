import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
    const url = request.nextUrl
    
    // Chỉ bảo vệ các route dành cho admin và tenant portal
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/tenant')) {
        const allowedIpsStr = process.env.ALLOWED_ADMIN_IPS || '*'
        
        // Nếu allow * thì cho qua hết
        if (allowedIpsStr.trim() === '*') return NextResponse.next()

        const allowedIps = allowedIpsStr.split(',').map(ip => ip.trim()).filter(Boolean)
        
        // Lấy IP thật của client
        const realIp = request.headers.get('x-real-ip')
        const forwardedFor = request.headers.get('x-forwarded-for')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let clientIp = (request as any).ip || realIp || (forwardedFor ? forwardedFor.split(',')[0].trim() : '127.0.0.1')

        // Normalize IPv6 localhost (::1) về 127.0.0.1 để so sánh dễ dàng
        if (clientIp === '::1') clientIp = '127.0.0.1'

        if (!allowedIps.includes(clientIp)) {
            return new NextResponse(
                JSON.stringify({
                    error: "403 Forbidden",
                    message: "Your IP is not whitelisted for portal access.",
                    ip: clientIp
                }),
                {
                    status: 403,
                    headers: { 'content-type': 'application/json' }
                }
            )
        }
    }
    
    return NextResponse.next()
}

export const config = {
    // Chỉ chạy middleware trên những routes quan trọng
    matcher: ['/admin/:path*', '/tenant/:path*']
}
