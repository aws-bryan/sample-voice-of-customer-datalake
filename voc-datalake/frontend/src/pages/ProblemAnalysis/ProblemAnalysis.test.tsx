/**
 * @fileoverview Tests for ProblemAnalysis page.
 *
 * The page is now an aggregation view over the server-built problem tree:
 * `useProblemFeedback` fetches finest-grain leaves from `getProblems` and
 * merges them client-side. These tests mock `getProblems` with a couple of
 * leaves; the feedback drill-down (`api.getFeedback`) is only reached when a
 * problem is expanded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ProblemsResponse } from '../../api/problemsApi'

const mockGetFeedback = vi.fn()
const mockGetEntities = vi.fn()
const mockGetResolvedProblems = vi.fn()
const mockSetProblemResolved = vi.fn()
const mockGetProblems = vi.fn()
const mockGetCustomFilters = vi.fn()
const mockGetCustomFieldCandidates = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    getFeedback: (params: unknown) => mockGetFeedback(params),
    getEntities: (params: unknown) => mockGetEntities(params),
    getResolvedProblems: () => mockGetResolvedProblems(),
    setProblemResolved: (key: string, resolved: boolean) => mockSetProblemResolved(key, resolved),
  },
  getDaysFromRange: () => 7,
  getDateRangeParams: () => ({ days: 7 }),
}))

// Capture the params so a test can assert custom-field selections reach it.
vi.mock('../../api/problemsApi', () => ({
  getProblems: (params: unknown) => mockGetProblems(params),
}))

// Custom-filter config + candidates feed the dropdowns (same as Categories).
// `toCustomFieldParams` is a pure helper used by the data layer; keep its real
// behavior so the drill-down builds correct cf_ params.
vi.mock('../../api/customFiltersApi', () => ({
  getCustomFilters: () => mockGetCustomFilters(),
  getCustomFieldCandidates: () => mockGetCustomFieldCandidates(),
  toCustomFieldParams: (filters: Record<string, string>) => {
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(filters)) {
      if (value) params[`cf_${key}`] = value
    }
    return params
  },
}))

vi.mock('../../store/configStore', () => ({
  useConfigStore: () => ({
    timeRange: '7d',
    customDays: undefined,
    dateBasis: 'processed_at',
    config: { apiEndpoint: 'https://api.example.com' },
  }),
}))

import ProblemAnalysis from './ProblemAnalysis'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

// Two leaves in delivery/shipping_speed. Shared keyword sets merge them at the
// default 0.4 threshold; the larger-count leaf ("Slow delivery times") is the
// representative, which is what the resolution key normalizes from.
const problemsResponse: ProblemsResponse = {
  period_days: 7,
  feedback_count: 3,
  is_partial: false,
  problems: [
    {
      category: 'delivery',
      subcategory: 'shipping_speed',
      problem: 'Slow delivery times',
      keywords: ['delivery', 'slow'],
      count: 2,
      urgent_count: 1,
      avg_sentiment: -0.5,
      root_cause: 'Logistics bottleneck',
    },
    {
      category: 'delivery',
      subcategory: 'shipping_speed',
      problem: 'Delivery too slow',
      keywords: ['delivery', 'slow'],
      count: 1,
      urgent_count: 0,
      avg_sentiment: -0.6,
      root_cause: null,
    },
  ],
}

// Drill-down rows, returned by api.getFeedback when a problem is expanded.
const mockFeedbackItems = [
  {
    feedback_id: 'f1',
    source_platform: 'webscraper',
    brand_name: 'TestBrand',
    original_text: 'The delivery was very slow',
    category: 'delivery',
    subcategory: 'shipping_speed',
    problem_summary: 'Slow delivery times',
    sentiment_score: -0.5,
    sentiment_label: 'negative',
    urgency: 'high',
    source_created_at: '2025-01-01',
  },
]

const mockEntities = {
  entities: {
    categories: { delivery: 10, product: 5 },
    sources: { webscraper: 15, manual_import: 8 },
  },
}

describe('ProblemAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProblems.mockResolvedValue(problemsResponse)
    mockGetFeedback.mockResolvedValue({ items: mockFeedbackItems, count: 1 })
    mockGetEntities.mockResolvedValue(mockEntities)
    mockGetResolvedProblems.mockResolvedValue({ resolved: {} })
    mockSetProblemResolved.mockResolvedValue({ success: true })
    // One configured custom filter ("Tier") with suggested values.
    mockGetCustomFilters.mockResolvedValue({ custom_filters: [{ key: 'tier', label: 'Tier' }] })
    mockGetCustomFieldCandidates.mockResolvedValue({
      candidates: [{ key: 'tier', top_values: [{ value: 'Gold' }, { value: 'Platinum' }] }],
    })
  })

  describe('custom filters', () => {
    it('passes a selected custom filter through to getProblems', async () => {
      render(<ProblemAnalysis />, { wrapper: createWrapper() })

      // The configured "Tier" dropdown renders once config + candidates load.
      const tierSelect = await screen.findByRole('combobox', { name: /filter by tier/i })

      await userEvent.selectOptions(tierSelect, 'Gold')

      await waitFor(() => {
        expect(mockGetProblems).toHaveBeenCalledWith(
          expect.objectContaining({ customFilters: { tier: 'Gold' } }),
        )
      })
    })
  })

  describe('rendering', () => {
    it('renders stats cards', async () => {
      render(<ProblemAnalysis />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText('Categories')).toBeInTheDocument()
        expect(screen.getByText('Subcategories')).toBeInTheDocument()
        expect(screen.getByText('Problems')).toBeInTheDocument()
        expect(screen.getByText('Feedback')).toBeInTheDocument()
        expect(screen.getByText('Urgent')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('shows loading spinner while fetching', () => {
      mockGetProblems.mockReturnValue(new Promise(() => {}))

      render(<ProblemAnalysis />, { wrapper: createWrapper() })

      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty state when no problems found', async () => {
      mockGetProblems.mockResolvedValue({ ...problemsResponse, problems: [], feedback_count: 0 })

      render(<ProblemAnalysis />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText(/no problem analysis data found/i)).toBeInTheDocument()
      })
    })
  })

  describe('category grouping', () => {
    it('builds a category from the server leaves', async () => {
      render(<ProblemAnalysis />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
      })

      // The delivery category header is built from the leaves.
      expect(screen.getByRole('button', { name: /delivery/i })).toBeInTheDocument()
    })
  })

  describe('expand/collapse', () => {
    it('renders expand button', async () => {
      render(<ProblemAnalysis />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
      })

      const expandButtons = screen.getAllByRole('button')
      const expandButton = expandButtons.find(b => b.textContent?.toLowerCase().includes('expand'))
      expect(expandButton).toBeTruthy()
    })
  })

  describe('source filtering', () => {
    it('renders source filter dropdown with available sources', async () => {
      render(<ProblemAnalysis />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
      })

      const sourceSelects = document.querySelectorAll('select')
      expect(sourceSelects.length).toBeGreaterThan(0)

      const firstSelect = sourceSelects[0]
      expect(firstSelect.querySelector('option[value=""]')).toBeTruthy()
    })
  })
})

// Note: Testing "not configured" state requires module re-mocking which is complex
// The main functionality is tested above


describe('problem resolution (issue #66)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProblems.mockResolvedValue(problemsResponse)
    mockGetFeedback.mockResolvedValue({ items: mockFeedbackItems, count: 1 })
    mockGetEntities.mockResolvedValue(mockEntities)
    mockSetProblemResolved.mockResolvedValue({ success: true })
    // No custom filters configured for the resolution tests.
    mockGetCustomFilters.mockResolvedValue({ custom_filters: [] })
    mockGetCustomFieldCandidates.mockResolvedValue({ candidates: [] })
    // The merged "Slow delivery times" group is marked resolved server-side.
    mockGetResolvedProblems.mockResolvedValue({
      resolved: {
        'delivery|shipping_speed|slow delivery times': { resolved_at: '2026-07-01T00:00:00Z' },
      },
    })
  })

  it('hides resolved problems by default and shows them via the toggle', async () => {
    render(<ProblemAnalysis />, { wrapper: createWrapper() })

    // Resolved group hidden: the page falls back to its empty state.
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /show resolved \(1\)/i })).toBeInTheDocument()
    })
    expect(screen.queryByText('Slow delivery times')).not.toBeInTheDocument()
    // The empty state explains WHY the tree is empty instead of "no data".
    expect(screen.getByText(/marked resolved/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /show resolved/i }))

    // Visible again, annotated as resolved (category header appears).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delivery/i })).toBeInTheDocument()
    })
  })

  it('persists an unresolve action through the API', async () => {
    render(<ProblemAnalysis />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /show resolved \(1\)/i })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('checkbox', { name: /show resolved/i }))

    // Expand category → subcategory to reach the problem row.
    await userEvent.click(await screen.findByRole('button', { name: /delivery/i }))
    await userEvent.click(await screen.findByRole('button', { name: /shipping speed/i }))

    await userEvent.click(await screen.findByRole('button', { name: /mark as unresolved/i }))

    expect(mockSetProblemResolved).toHaveBeenCalledWith(
      'delivery|shipping_speed|slow delivery times', false,
    )
  })
})
