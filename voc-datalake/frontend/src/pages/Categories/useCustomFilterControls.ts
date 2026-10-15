/**
 * @fileoverview Builds the custom-field filter dropdowns for the Categories
 * FilterBar (Phase 4d).
 *
 * Joins two independent sources: the admin-chosen filter CONFIG
 * (`/settings/custom-filters` — which keys to expose and their labels) and the
 * recommended VALUES per key (`/feedback/custom-field-candidates` — the facet
 * previews from Phase 4b). The current selections come from the URL-synced
 * filter state. A configured key with no suggested values still renders a
 * control (the user can keep a deep-linked value); the dropdown just has no
 * suggestions to offer.
 *
 * @module pages/Categories/useCustomFilterControls
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCustomFilters, getCustomFieldCandidates } from '../../api/customFiltersApi'
import type { CustomFilterControl } from './FilterBar'

export function useCustomFilterControls(
  apiEndpoint: string,
  selections: Record<string, string>,
): CustomFilterControl[] {
  const enabled = !!apiEndpoint

  const { data: config } = useQuery({
    queryKey: ['custom-filters-config'],
    queryFn: () => getCustomFilters(),
    enabled,
  })

  const { data: candidates } = useQuery({
    queryKey: ['custom-field-candidates'],
    queryFn: () => getCustomFieldCandidates(),
    enabled,
  })

  return useMemo(() => {
    const configured = config?.custom_filters ?? []
    if (configured.length === 0) return []

    // key -> suggested values, from the candidate previews.
    const valuesByKey = new Map<string, string[]>()
    for (const candidate of candidates?.candidates ?? []) {
      valuesByKey.set(candidate.key, candidate.top_values.map((v) => v.value))
    }

    return configured.map((filter) => ({
      key: filter.key,
      label: filter.label,
      values: valuesByKey.get(filter.key) ?? [],
      selected: selections[filter.key] ?? '',
    }))
  }, [config, candidates, selections])
}
