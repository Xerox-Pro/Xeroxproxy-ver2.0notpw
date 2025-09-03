// middleware.js
import { NextResponse } from 'next/server'

export function middleware(req) {
  const referer = req.headers.get('referer') || ''
  const allowedDomain = 'https://xeroxapp024.vercel.app' // ← 埋め込み元のドメインに変更

  // Referer が空、または許可ドメインで始まらない場合は拒否
  if (!referer.startsWith(allowedDomain)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // 許可された場合はそのまま処理を続行
  return NextResponse.next()
}

// 適用するパスを指定（全ページに適用する場合）
export const config = {
  matcher: '/:path*'
}
