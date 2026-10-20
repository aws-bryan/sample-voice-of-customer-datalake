/**
 * @fileoverview Tests for the persona wizard's live match count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PersonaFeedbackPreview, { PERSONA_PREVIEW_DEBOUNCE_MS } from './PersonaFeedbackPreview'
import { defaultContextConfig } from '../../components/DataSourceWizard/exports'
import type { ContextConfig } from '../../components/DataSourceWizard/exports'

const mockPreviewPersonaFeedback = vi.fn()

vi.mock('../../api/projectsApi', () => ({
  projectsApi: {
    previewPersonaFeedback: (...args: unknown[]) => mockPreviewPersonaFeedback(...args),
  },
}))

function renderPreview(contextConfig: ContextConfig = defaultContextConfig) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <PersonaFeedbackPreview projectId="proj-1" contextConfig={contextConfig} />
    </QueryClientProvider>,
  )
  const rerender = (next: ContextConfig) => view.rerender(
    <QueryClientProvider client={queryClient}>
      <PersonaFeedbackPreview projectId="proj-1" contextConfig={next} />
    </QueryClientProvider>,
  )
  return { ...view, rerenderWith: rerender }
}

describe('PersonaFeedbackPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the match count and the sample note when more reviews match than are sampled', async () => {
    mockPreviewPersonaFeedback.mockResolvedValue({ matched: 612, matched_is_lower_bound: false, sample_limit: 145 })
    renderPreview()

    expect(await screen.findByText('612 reviews match these filters')).toBeInTheDocument()
    expect(screen.getByText('Personas use an even sample of 145 of them.')).toBeInTheDocument()
  })

  it('shows that every review is used when the matches fit in the sample', async () => {
    mockPreviewPersonaFeedback.mockResolvedValue({ matched: 1, matched_is_lower_bound: false, sample_limit: 145 })
    renderPreview()

    expect(await screen.findByText('1 review matches these filters')).toBeInTheDocument()
    expect(screen.getByText('Personas use all of them.')).toBeInTheDocument()
  })

  it('shows "N+" and the sample note when the count is a lower bound', async () => {
    mockPreviewPersonaFeedback.mockResolvedValue({ matched: 50000, matched_is_lower_bound: true, sample_limit: 145 })
    renderPreview()

    expect(await screen.findByText('50000+ reviews match these filters')).toBeInTheDocument()
    expect(screen.getByText('Personas use an even sample of 145 of them.')).toBeInTheDocument()
  })

  it('shows the generation-will-fail warning when nothing matches', async () => {
    mockPreviewPersonaFeedback.mockResolvedValue({ matched: 0, matched_is_lower_bound: false, sample_limit: 145 })
    renderPreview()

    expect(await screen.findByText('No reviews match these filters — persona generation will fail.')).toBeInTheDocument()
    expect(screen.queryByText(/Personas use/)).not.toBeInTheDocument()
  })

  it('shows the error line when the count cannot be read', async () => {
    mockPreviewPersonaFeedback.mockResolvedValue({ matched: null, matched_is_lower_bound: false, sample_limit: null })
    renderPreview()

    expect(await screen.findByText("Couldn't count matching reviews.")).toBeInTheDocument()
  })

  it('shows the error line when the request fails', async () => {
    mockPreviewPersonaFeedback.mockRejectedValue(new Error('API Error: 500'))
    renderPreview()

    expect(await screen.findByText("Couldn't count matching reviews.")).toBeInTheDocument()
  })

  it('counts the same feedback scope generation sends, shared filters as extraFilters', async () => {
    mockPreviewPersonaFeedback.mockResolvedValue({ matched: 3, matched_is_lower_bound: false, sample_limit: 145 })
    renderPreview({
      ...defaultContextConfig,
      sources: ['webscraper'],
      categories: ['billing'],
      days: 90,
      feedback: { ...defaultContextConfig.feedback, urgentOnly: true },
    })

    await screen.findByText('3 reviews match these filters')
    expect(mockPreviewPersonaFeedback).toHaveBeenCalledWith('proj-1', {
      sources: ['webscraper'],
      categories: ['billing'],
      sentiments: [],
      days: 90,
      extraFilters: { urgent: 'true' },
    })
  })

  it('re-counts once, after the filters stop changing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockPreviewPersonaFeedback.mockResolvedValue({ matched: 3, matched_is_lower_bound: false, sample_limit: 145 })
    const { rerenderWith } = renderPreview()
    await screen.findByText('3 reviews match these filters')

    rerenderWith({ ...defaultContextConfig, sentiments: ['negative'] })
    rerenderWith({ ...defaultContextConfig, sentiments: ['negative', 'mixed'] })
    expect(mockPreviewPersonaFeedback).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(PERSONA_PREVIEW_DEBOUNCE_MS))

    expect(mockPreviewPersonaFeedback).toHaveBeenCalledTimes(2)
    expect(mockPreviewPersonaFeedback).toHaveBeenLastCalledWith('proj-1', expect.objectContaining({ sentiments: ['negative', 'mixed'] }))
  })
})
