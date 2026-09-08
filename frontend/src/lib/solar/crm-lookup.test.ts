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
    expect(reply).toContain('Your solar project enquiry is registered successfully.')
    expect(reply).toContain('Reference ID: *SS-001*')
    expect(reply).toContain('Current project stage: *Site survey* (In Progress)')
    expect(reply).toContain('Expected timeline: approximately 3 days')
  })

  it('does not crash when CRM returns no stages', () => {
    const reply = formatCrmStatusReply({ ...baseLead, stages: [] })
    expect(reply).toContain('Current project stage: *Initial review* (Pending)')
    expect(reply).toContain('expected timeline shortly')
  })
})
