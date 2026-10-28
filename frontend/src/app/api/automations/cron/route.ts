import { NextResponse } from 'next/server'

/**
 * Automation wait-step drain is disabled. Previously this endpoint
 * resumed due `automation_pending_executions` rows.
 */
export async function GET() {
  return NextResponse.json({ processed: 0, disabled: true })
}
