/**
 * @fileoverview On-demand feedback items for an expanded problem row.
 *
 * The server now returns only aggregated problem leaves (counts, no rows), so
 * the raw feedback behind a problem is fetched lazily when the user expands it
 * — a filtered `/feedback` call for that category over the window, narrowed
 * client-side to the rows whose `problem_summary` belongs to this merged group
 * (its representative plus the similar problems folded into it).
 *
 * Enabled only while expanded, so collapsed rows cost nothing.
 *
 * @module pages/ProblemAnalysis/useProblemItems
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { DateRangeParams, FeedbackItem } from '../../api/client'
import { toCustomFieldParams } from '../../api/customFiltersApi'
import { FEEDBACK_PAGE_LIMIT } from '../../api/feedbackPagination'

export interface ProblemItems {
  items: FeedbackItem[]
  isLoading: boolean
  isError: boolean
}

/**
 * Fetch the feedback items for one merged problem group.
 *
 * @param problemTexts the merged group's problem texts (representative +
 *   similar), used to narrow the category's rows to this group.
 */
export function useProblemItems(
  dateParams: DateRangeParams,
  category: string,
  subcategory: string,
  problemTexts: string[],
  source: string | null,
  enabled: boolean,
  customFilters: Record<string, string> = {},
): ProblemItems {
  // Fold the custom-field selections into `cf_<key>` request params so the
  // drilled-in example rows respect the same filter as the aggregated tree
  // (/feedback supports cf_ post-filters). Same helper Categories uses.
  const cfParams = toCustomFieldParams(customFilters)

  const query = useQuery({
    // Category scopes the server query; subcategory + problem texts narrow it
    // client-side below. Keyed on all of them (plus custom filters) so two
    // problems in the same category don't share a cache entry.
    queryKey: ['problem-items', dateParams, source, category, subcategory, problemTexts, customFilters],
    queryFn: () =>
      api.getFeedback({
        ...dateParams,
        category,
        source: source ?? undefined,
        limit: FEEDBACK_PAGE_LIMIT,
        ...cfParams,
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const wanted = useMemo(() => new Set(problemTexts), [problemTexts])
  const items = useMemo(
    () =>
      (query.data?.items ?? []).filter(
        (item) => item.subcategory === subcategory && wanted.has(item.problem_summary ?? ''),
      ),
    [query.data, subcategory, wanted],
  )

  return { items, isLoading: query.isLoading, isError: query.isError }
}
