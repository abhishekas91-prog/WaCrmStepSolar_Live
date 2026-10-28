import { NextResponse } from 'next/server'

/**
 * Stale-run sweep is disabled. Previously this endpoint marked abandoned
 * active flow runs as timed_out; the scheduled GitHub Action that pinged
 * it has been turned off as well.
 */
export async function GET() {
  return NextResponse.json({ swept: 0, disabled: true })
}
