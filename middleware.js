// middleware.js
import { NextResponse } from 'next/server'

export function middleware(req) {
  const url = new URL(req.url)
  const token = url.searchParams.get("token")

  // 埋め込み専用の秘密キー
  const allowedToken = "abc123"

  if (token !== allowedToken) {
    return new NextResponse("直接アクセスは使用できません。Xerox YTからのアクセスをお願いします", { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/:path*',
}
