import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchApi = vi.fn()
vi.mock('./client', () => ({
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}))

import { getProblems } from './problemsApi'

describe('getProblems', () => {
  beforeEach(() => mockFetchApi.mockReset())

  it('GETs /feedback/problems with the window params', async () => {
    mockFetchApi.mockResolvedValue({ period_days: 7, feedback_count: 0, is_partial: false, problems: [] })
    await getProblems({ days: 7, date_basis: 'review', source: 'webscraper' })
    const url = mockFetchApi.mock.calls[0][0] as string
    expect(url).toContain('/feedback/problems?')
    expect(url).toContain('days=7')
    expect(url).toContain('date_basis=review')
    expect(url).toContain('source=webscraper')
  })

  it('returns the parsed problem leaves', async () => {
    mockFetchApi.mockResolvedValue({
      period_days: 7,
      feedback_count: 3,
      is_partial: false,
      problems: [
        { category: 'delivery', subcategory: 'late', problem: 'order late', keywords: ['order', 'late'], count: 3, urgent_count: 1, avg_sentiment: -0.5, root_cause: null },
      ],
    })
    const res = await getProblems({ days: 7 })
    expect(res.feedback_count).toBe(3)
    expect(res.problems[0].problem).toBe('order late')
    expect(res.problems[0].keywords).toEqual(['order', 'late'])
  })

  it('leniently normalizes a malformed leaf instead of throwing', async () => {
    mockFetchApi.mockResolvedValue({
      problems: [
        // Missing most fields, string count — coerced/defaulted, not rejected.
        { problem: 'something', count: '4' },
      ],
    })
    const res = await getProblems({ days: 7 })
    expect(res.problems[0].count).toBe(4)
    expect(res.problems[0].category).toBe('uncategorized')
    expect(res.problems[0].keywords).toEqual([])
    expect(res.is_partial).toBe(false)
  })

  it('drops leaves with no problem text', async () => {
    mockFetchApi.mockResolvedValue({
      problems: [
        { problem: '', count: 2 },
        { problem: 'real problem', count: 5 },
      ],
    })
    const res = await getProblems({ days: 7 })
    expect(res.problems).toHaveLength(1)
    expect(res.problems[0].problem).toBe('real problem')
  })
})
