import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE } from '@/lib/mongo/auth'
import { verifyAccessToken } from '@/lib/mongo/jwt'

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return atob(padded)
}

function getSessionUserFromCookie(request: NextRequest): Promise<string | null> {
  const raw = request.cookies.get(AUTH_COOKIE)?.value
  if (!raw) return Promise.resolve(null)
  try {
    const parsed = JSON.parse(decodeBase64Url(raw))
    if (!parsed?.access_token) return Promise.resolve(null)
    return verifyAccessToken(parsed.access_token)
      .then((res) => res?.sub ?? null)
      .catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

export async function proxy(request: NextRequest) {
  const userId = await getSessionUserFromCookie(request)
  const user = userId ? { id: userId } : null

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click.
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup' ||
      request.nextUrl.pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/inbox'
      url.search = ''
    }
    const res = NextResponse.redirect(url)
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    return res
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/settings',
    '/flows',
    '/notifications',
    '/solar',
    '/invoices',
  ]
  if (
    !user &&
    protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    const res = NextResponse.redirect(url)
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    return res
  }

  // API routes that need auth (not webhooks)
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook')
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
