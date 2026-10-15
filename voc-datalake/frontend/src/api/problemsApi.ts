/**
 * @fileoverview Problem Analysis aggregation API (server-side problem tree).
 *
 * Its own module rather than more surface on `client.ts` (which sits at its
 * max-lines budget) — same precedent as `customFiltersApi` / `metricsLatestDateApi`.
 *
 * `GET /feedback/problems` returns the finest-grain problem leaves over the full
 * window (up to the server's 50k scan cap); the client merges them to the
 * similarity slider's threshold via `pages/ProblemAnalysis/problemClustering`.
 * The response is normalized through a lenient Zod schema at this boundary (repo
 * wire-shape rule), so a legacy or partial row can never crash the tree.
 *
 * @module api/problemsApi
 */
import { z } from 'zod'
import { fetchApi } from './client'
import type { DateRangeParams } from './client'
import { toCustomFieldParams } from './customFiltersApi'
import type { DateBasis } from './types'

/** A finest-grain problem leaf, matching `_aggregate_problems` in metrics_handler.py. */
export interface ProblemLeaf {
  category: string
  subcategory: string
  problem: string
  keywords: string[]
  count: number
  urgent_count: number
  avg_sentiment: number
  root_cause: string | null
}

export interface ProblemsResponse {
  period_days: number
  feedback_count: number
  is_partial: boolean
  problems: ProblemLeaf[]
}

// Lenient: coerce the fields we rely on and default the rest, so one malformed
// leaf degrades to a usable shape instead of blanking the page.
const leafSchema = z.object({
  category: z.string().catch('uncategorized'),
  subcategory: z.string().catch('general'),
  problem: z.string().catch(''),
  keywords: z.array(z.string()).catch([]),
  count: z.coerce.number().catch(0),
  urgent_count: z.coerce.number().catch(0),
  avg_sentiment: z.coerce.number().catch(0),
  root_cause: z.string().nullable().catch(null),
})

const responseSchema = z.object({
  period_days: z.coerce.number().catch(0),
  feedback_count: z.coerce.number().catch(0),
  is_partial: z.boolean().catch(false),
  problems: z.array(leafSchema).catch([]),
})

/** Fetch the server-aggregated problem leaves for the window. */
export async function getProblems(
  params: DateRangeParams & {
    date_basis?: DateBasis
    source?: string
    /** Admin-configured custom-field selections, serialized as `cf_<key>` —
     * row-level post-filters the server applies before aggregation. */
    customFilters?: Record<string, string>
  },
): Promise<ProblemsResponse> {
  const { customFilters, ...rest } = params
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(rest)) {
    if (value != null) search.set(key, String(value))
  }
  for (const [key, value] of Object.entries(toCustomFieldParams(customFilters ?? {}))) {
    search.set(key, value)
  }
  const raw = await fetchApi<unknown>(`/feedback/problems?${search.toString()}`)
  // Drop leaves with no problem text — the server already skips rows without a
  // problem_summary, but a lenient parse could still coerce one to ''.
  const parsed = responseSchema.parse(raw)
  return { ...parsed, problems: parsed.problems.filter((p) => p.problem !== '') }
}
