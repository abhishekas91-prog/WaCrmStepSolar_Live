import { NextRequest, NextResponse } from 'next/server'

// Generates a preview URL for an invoice PDF stored in the Mongo
// storage layer (bucket "invoices"). Previously this proxied Supabase
// Storage's /storage/v1/object/sign endpoint; now the same-origin
    // /api/db/storage route streams the file bytes directly.
export async function POST(req: NextRequest) {
  try {
    const { object_path, expires_in } = await req.json()
    if (!object_path) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const expiresIn = expires_in || 3600
    const signedUrl = `/api/db/storage?bucket=invoices&path=${encodeURIComponent(object_path)}`

    return NextResponse.json({ signedUrl, expires_in: expiresIn })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
