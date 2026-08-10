import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { object_path, expires_in } = await req.json()
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    const INVOICE_BUCKET = process.env.INVOICE_BUCKET || 'invoices'

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
    }

    const url = `${SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/sign/${encodeURIComponent(INVOICE_BUCKET)}/${encodeURIComponent(object_path)}`
    const body = { expiresIn: expires_in || 3600 }

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
    })

    if (!r.ok) {
      const txt = await r.text()
      return NextResponse.json({ error: 'supabase_error', detail: txt }, { status: r.status })
    }

    const data = await r.json()
    // data.signedURL or data.signedUrl depending on implementation
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
