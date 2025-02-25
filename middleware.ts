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
      // Worker token kontrolü
      const workerToken = request.headers.get('x-worker-token');
      const isWorkerRequest = workerToken === process.env.WORKER_API_TOKEN;

      // Flow route'ları için worker token yeterli
      if (isFlowRoute && isWorkerRequest) {
        return NextResponse.next();
      }

      // Attachments route'u için özel kontrol
      if (request.nextUrl.pathname.startsWith('/api/attachments/')) {
        // Worker mode'da attachments klasörüne direkt erişim var
        if (process.env.WORKER_MODE === '1') {
          return NextResponse.redirect(new URL(request.nextUrl.pathname.replace('/api/attachments/', '/attachments/'), request.url));
        }
        // Normal modda token kontrolü yapılıyor
        if (!token) {
          return new NextResponse(null, { status: 401 });
        }
        return NextResponse.next();
      }

      // Diğer API route'ları için token kontrolü
      if (!token && !isWorkerRequest) {
        return new NextResponse(null, { status: 401 });
      }
      return NextResponse.next();
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
    '/((?!_next/static|_next/image|favicon.ico|public/attachments|attachments).*)',
  ],
}
