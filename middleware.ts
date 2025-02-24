import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');
  const isAuthRoute = request.nextUrl.pathname.startsWith('/api/auth/');
  const isFlowRoute = request.nextUrl.pathname.startsWith('/api/send-to-flow') || request.nextUrl.pathname.startsWith('/api/send-email-to-flow');
  
  // Auth route'ları için kontrol yapma
  if (isAuthRoute) {
    return NextResponse.next();
  }

  // API route'ları için auth kontrolü
  if (isApiRoute) {
    // Bearer token kontrolü
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const adminToken = authHeader.substring(7);
      try {
        // Token kontrolü burada yapılacak
        return NextResponse.next();
      } catch (error) {
        console.error('[AUTH ERROR] Invalid admin token:', error);
      }
    }

    // Normal oturum kontrolü
    if (!token && !isFlowRoute) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
