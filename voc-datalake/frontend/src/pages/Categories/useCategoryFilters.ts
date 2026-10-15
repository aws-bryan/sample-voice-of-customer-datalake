/**
 * @fileoverview URL-synced filter state for the Categories page.
 *
 * Owns every user-adjustable feedback filter and mirrors the shareable
 * subset (q / source / sentiment / category) to the URL so links are
 * shareable and FeedbackDetail tag-clicks can deep-link into a pre-filtered
 * Categories view. Multi-select categories are encoded comma-separated
 * (`?category=a,b`); single-value deep-links simply select one chip.
 *
 * The default state (nothing selected) browses ALL feedback — there is no
 * separate "All" toggle. Selecting categories narrows the list; deselecting
 * everything returns to the browse-all view (issue #198 UX rationalization).
 *
 * @module pages/Categories/useCategoryFilters
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ANY_RATING_FILTER } from './types'
import type { RatingFilter, SentimentFilter } from './types'

const SENTIMENT_VALUES: readonly SentimentFilter[] = ['all', 'positive', 'negative', 'neutral', 'mixed']

function isSentimentFilter(value: string): value is SentimentFilter {
  return SENTIMENT_VALUES.some((v) => v === value)
}

function parseSentimentParam(value: string | null): SentimentFilter {
  if (value !== null && isSentimentFilter(value)) return value
  return 'all'
}

function parseCategoriesParam(value: string | null): string[] {
  if (value === null || value === '') return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Read-only snapshot of the current filter values. */
export interface CategoryFiltersState {
  searchText: string
  selectedCategories: string[]
  selectedSource: string | null
  sentimentFilter: SentimentFilter
  ratingFilter: RatingFilter
  showUrgentOnly: boolean
  /**
   * Selected custom-field filters, keyed by the stored `custom_fields` key.
   * Empty when none are chosen. Each entry becomes a `cf_<key>=<value>` query
   * param (see useFeedbackListData) and is mirrored to the URL for deep-linking.
   */
  customFilters: Record<string, string>
}

/** Query-param prefix for custom-field filters, matching the backend contract. */
const CUSTOM_FILTER_PARAM_PREFIX = 'cf_'

/** Filter values plus the mutation handlers the page wires into its UI. */
export interface CategoryFiltersApi extends CategoryFiltersState {
  setSearchText: (value: string) => void
  toggleCategory: (category: string) => void
  setSelectedSource: (value: string | null) => void
  setSentimentFilter: (value: SentimentFilter) => void
  setRatingFilter: (value: RatingFilter) => void
  setShowUrgentOnly: (value: boolean) => void
  /** Set a custom filter's value; an empty value clears that one filter. */
  setCustomFilter: (key: string, value: string) => void
  clearFilters: () => void
  hasActiveFilters: boolean
}

function computeHasActiveFilters(state: CategoryFiltersState): boolean {
  return (
    state.searchText !== '' ||
    state.selectedCategories.length > 0 ||
    state.selectedSource !== null ||
    state.sentimentFilter !== 'all' ||
    state.ratingFilter.value > 0 ||
    state.showUrgentOnly ||
    Object.keys(state.customFilters).length > 0
  )
}

/** Extract `cf_<key>=<value>` params into a `{key: value}` map (empty values dropped). */
function parseCustomFiltersParam(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [rawKey, value] of params.entries()) {
    if (!rawKey.startsWith(CUSTOM_FILTER_PARAM_PREFIX) || value === '') continue
    const key = rawKey.slice(CUSTOM_FILTER_PARAM_PREFIX.length)
    if (key) result[key] = value
  }
  return result
}

/** Canonical query string for the URL-synced subset of the filter state. */
function buildShareableParams(
  searchText: string,
  selectedSource: string | null,
  sentimentFilter: SentimentFilter,
  selectedCategories: string[],
  customFilters: Record<string, string>
): URLSearchParams {
  const params = new URLSearchParams()
  if (searchText) params.set('q', searchText)
  if (selectedSource) params.set('source', selectedSource)
  if (sentimentFilter !== 'all') params.set('sentiment', sentimentFilter)
  if (selectedCategories.length > 0) params.set('category', selectedCategories.join(','))
  // Sorted so the snapshot string is stable regardless of selection order —
  // the render-phase URL/state comparison below depends on byte-equality.
  for (const key of Object.keys(customFilters).sort((a, b) => a.localeCompare(b))) {
    if (customFilters[key]) params.set(`${CUSTOM_FILTER_PARAM_PREFIX}${key}`, customFilters[key])
  }
  return params
}

export function useCategoryFilters(): CategoryFiltersApi {
  const [searchParams, setSearchParams] = useSearchParams()

  const [searchText, setSearchText] = useState(searchParams.get('q') ?? '')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() =>
    parseCategoriesParam(searchParams.get('category'))
  )
  const [selectedSource, setSelectedSource] = useState<string | null>(searchParams.get('source'))
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>(() =>
    parseSentimentParam(searchParams.get('sentiment'))
  )
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(ANY_RATING_FILTER)
  const [showUrgentOnly, setShowUrgentOnly] = useState(false)
  const [customFilters, setCustomFilters] = useState<Record<string, string>>(() =>
    parseCustomFiltersParam(searchParams)
  )

  // Canonical form of what the URL says vs. what the state says. When they
  // disagree right after the URL changed, the change came from outside
  // (browser back/forward, same-route navigation to /categories?...) and the
  // state adopts it. Guarded render-phase updates per React's "adjusting
  // state when props change" pattern — our own URL mirroring converges the
  // two snapshots, so it never re-triggers adoption.
  const urlSnapshot = buildShareableParams(
    searchParams.get('q') ?? '',
    searchParams.get('source'),
    parseSentimentParam(searchParams.get('sentiment')),
    parseCategoriesParam(searchParams.get('category')),
    parseCustomFiltersParam(searchParams)
  ).toString()
  const stateSnapshot = buildShareableParams(
    searchText,
    selectedSource,
    sentimentFilter,
    selectedCategories,
    customFilters
  ).toString()
  const [prevUrlSnapshot, setPrevUrlSnapshot] = useState(urlSnapshot)
  if (urlSnapshot !== prevUrlSnapshot) {
    setPrevUrlSnapshot(urlSnapshot)
    if (urlSnapshot !== stateSnapshot) {
      setSearchText(searchParams.get('q') ?? '')
      setSelectedSource(searchParams.get('source'))
      setSentimentFilter(parseSentimentParam(searchParams.get('sentiment')))
      setSelectedCategories(parseCategoriesParam(searchParams.get('category')))
      setCustomFilters(parseCustomFiltersParam(searchParams))
    }
  }

  // Mirror the shareable filters to the URL (replace, not push, so the
  // browser back button isn't flooded by keystrokes). The legacy `all=1`
  // param is intentionally dropped: browse-all is now the default state.
  useEffect(() => {
    const params = buildShareableParams(searchText, selectedSource, sentimentFilter, selectedCategories, customFilters)
    setSearchParams(params, { replace: true })
  }, [searchText, selectedSource, sentimentFilter, selectedCategories, customFilters, setSearchParams])

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    )
  }

  const setCustomFilter = (key: string, value: string) => {
    setCustomFilters((prev) => {
      // An empty value means "clear this one" — drop the key rather than keep
      // an empty entry, so hasActiveFilters and the URL stay accurate.
      if (!value) {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: value }
    })
  }

  const clearFilters = () => {
    setSearchText('')
    setSelectedCategories([])
    setSelectedSource(null)
    setSentimentFilter('all')
    setRatingFilter(ANY_RATING_FILTER)
    setShowUrgentOnly(false)
    setCustomFilters({})
  }

  const state: CategoryFiltersState = {
    searchText,
    selectedCategories,
    selectedSource,
    sentimentFilter,
    ratingFilter,
    showUrgentOnly,
    customFilters,
  }

  return {
    ...state,
    setSearchText,
    toggleCategory,
    setSelectedSource,
    setSentimentFilter,
    setRatingFilter,
    setShowUrgentOnly,
    setCustomFilter,
    clearFilters,
    hasActiveFilters: computeHasActiveFilters(state),
  }
}
