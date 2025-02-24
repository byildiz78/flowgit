import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  try {
    const token = await getToken({ 
      req: request, 
      secret: process.env.NEXTAUTH_SECRET,
    });

    console.log('[MIDDLEWARE] Token check:', {
      path: request.nextUrl.pathname,
      hasToken: !!token,
      token: token ? 'exists' : 'none'
    });

    const isApiRoute = request.nextUrl.pathname.startsWith('/api/');
    const isAuthRoute = request.nextUrl.pathname.startsWith('/api/auth/');
    const isFlowRoute = request.nextUrl.pathname.startsWith('/api/send-to-flow') || 
                       request.nextUrl.pathname.startsWith('/api/send-email-to-flow');
    
    // Auth route'ları için kontrol yapma
    if (isAuthRoute || request.nextUrl.pathname === '/login') {
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
          return NextResponse.json({ error: 'Invalid admin token' }, { status: 401 });
        }
      }

      // Normal oturum kontrolü
      if (!token && !isFlowRoute) {
        console.log('[MIDDLEWARE] Unauthorized API access attempt');
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
    } else if (!token && !request.nextUrl.pathname.startsWith('/_next')) {
      // Sayfa istekleri için login'e yönlendir
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
  } catch (error) {
    console.error('[MIDDLEWARE ERROR]:', error);
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
