/** @type {import('next').NextConfig} */
const nextConfig = {
    // Cho phép embed trong iframe từ bất kỳ domain nào
    async headers() {
        return [
            {
                source: '/widget/:path*',
                headers: [
                    {
                        key: 'X-Frame-Options',
                        value: 'ALLOWALL',
                    },
                    {
                        key: 'Content-Security-Policy',
                        value: "frame-ancestors *",
                    },
                ],
            },
        ]
    },
}

module.exports = nextConfig
