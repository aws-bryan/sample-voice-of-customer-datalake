/**
 * @fileoverview Admin config for the custom-field filters exposed on the
 * feedback UI (Phase 4).
 *
 * Its own module rather than more surface on `client.ts`, following the
 * `prioritizationRowsApi` / `metricsLatestDateApi` precedent — `client.ts` sits
 * at its `max-lines` budget. Reading the config is open to any authenticated
 * user (the filter UI is for everyone); saving it is admin-gated server-side,
 * and the Settings card that calls `saveCustomFilters` is shown only to admins.
 *
 * @module api/customFiltersApi
 */
import { fetchApi } from './client'

/** One admin-chosen filter: a stored `custom_fields` key plus a display label. */
export interface CustomFilterConfig {
  readonly key: string
  readonly label: string
}

/** Read the configured custom filters. Empty when none are set. */
export function getCustomFilters(): Promise<{ custom_filters: CustomFilterConfig[]; updated_at?: string | null }> {
  return fetchApi('/settings/custom-filters')
}

/** A preview value for a custom-field facet, with how many records carried it. */
/**
 * Turn custom-filter selections into `cf_<key>=<value>` request params.
 *
 * The single source for how a selections map becomes query params — the server
 * reads the `cf_` prefix on `/feedback`, `/feedback/urgent`, `/feedback/search`
 * and `/feedback/problems`. Empty values are dropped (a cleared dropdown is "no
 * selection", not "match empty").
 */
export function toCustomFieldParams(customFilters: Record<string, string>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(customFilters)) {
    if (value) params[`cf_${key}`] = value
  }
  return params
}

export interface CustomFieldValue {
  readonly value: string
  readonly count: number
}

/** One recommended custom-field facet: a key plus a preview of its values. */
export interface CustomFieldCandidate {
  readonly key: string
  readonly distinct_values: number
  readonly coverage: number
  readonly top_values: CustomFieldValue[]
}

/**
 * Recommended custom-field facets over recent feedback (Phase 4b endpoint).
 *
 * Powers two surfaces: the admin picker suggests which keys to expose, and the
 * filter bar reads each candidate's `top_values` to populate a selected
 * filter's value dropdown. Only keys with moderate cardinality are returned, so
 * a chosen key that drifted to high cardinality may be absent — the filter
 * still works (values are typed into the URL), it just has no suggested list.
 */
export function getCustomFieldCandidates(): Promise<{
  sampled_count: number
  is_partial: boolean
  candidates: CustomFieldCandidate[]
}> {
  return fetchApi('/feedback/custom-field-candidates')
}

/**
 * Save the custom filters (admin-only server-side). Sends the full list — the
 * server validates the ≤3 cap, requires a non-empty key per entry, bounds and
 * de-duplicates, and defaults a missing label to the key.
 */
export function saveCustomFilters(
  filters: ReadonlyArray<{ key: string; label?: string }>,
): Promise<{ success: boolean; custom_filters: CustomFilterConfig[] }> {
  return fetchApi('/settings/custom-filters', {
    method: 'PUT',
    body: JSON.stringify({ custom_filters: filters }),
  })
}
