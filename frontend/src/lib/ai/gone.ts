import { NextResponse } from 'next/server'

/** LLM assistant was removed — this deployment has no provider API keys. */
export function aiGone() {
  return NextResponse.json(
    {
      error:
        'AI assistant is disabled. Use Flows → Solar Assistant for WhatsApp solar quotes.',
      code: 'ai_removed',
    },
    { status: 410 },
  )
}
