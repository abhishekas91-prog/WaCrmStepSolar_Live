import { describe, expect, it } from 'vitest'
import { formatCrmStatusReply } from './crm-lookup'

describe('formatCrmStatusReply', () => {
  const baseLead = {
    id: 'lead-1',
    code: 'SS-001',
    full_name: 'Ada',
    assigned_name: null,
    created_at: '2026-09-09T00:00:00Z',
  }

  it('formats the current phase and timeline when CRM stages exist', () => {
    const reply = formatCrmStatusReply({
      ...baseLead,
      stages: [{ key: 'survey', label: 'Site survey', status: 'In Progress', estimated_days: 3 }],
    })
    expect(reply).toContain('Project phase: *Site survey* (In Progress).')
    expect(reply).toContain('lagbhag 3 din')
  })

  it('does not crash when CRM returns no stages', () => {
    const reply = formatCrmStatusReply({ ...baseLead, stages: [] })
    expect(reply).toContain('Project phase: *Initial review* (Pending).')
    expect(reply).toContain('next update')
  })
})
