import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:8001'
    const AGENT_SECRET = process.env.AGENT_APPROVAL_SECRET || process.env.NEXT_PUBLIC_AGENT_APPROVAL_SECRET || ''

    const forwardBody = { ...body }
    if (AGENT_SECRET) forwardBody.secret = AGENT_SECRET

    const url = `${BACKEND_BASE_URL.replace(/\/+$/,'')}/invoices/send`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(forwardBody),
    })

    const text = await r.text()
    return new NextResponse(text, { status: r.status, headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
