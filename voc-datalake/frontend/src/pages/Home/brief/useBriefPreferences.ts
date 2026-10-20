/**
 * @fileoverview The caller's own brief preferences (GET/PUT /settings/my-briefing).
 * @module pages/Home/brief/useBriefPreferences
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_PREFERENCES, briefPreferencesKey, briefingApi } from '../../../api/briefingApi'
import { useAuthStore } from '../../../store/authStore'
import { useConfigStore } from '../../../store/configStore'
import type { BriefPreferenceChanges, BriefPreferences } from '../../../api/briefingApi'

export interface BriefPreferencesResult {
  preferences: BriefPreferences
  isLoading: boolean
  save: (changes: BriefPreferenceChanges) => void
  isSaving: boolean
  saveFailed: boolean
  saved: boolean
}

export function useBriefPreferences(): BriefPreferencesResult {
  const sub = useAuthStore().user?.sub ?? ''
  const enabled = useConfigStore((s) => s.config.apiEndpoint) !== ''
  const queryClient = useQueryClient()
  const queryKey = [...briefPreferencesKey(), sub] as const
  const query = useQuery({ queryKey, queryFn: briefingApi.getPreferences, enabled })
  const mutation = useMutation({
    mutationFn: briefingApi.savePreferences,
    onSuccess: (fresh) => { queryClient.setQueryData(queryKey, fresh) },
  })
  return {
    preferences: query.data ?? DEFAULT_PREFERENCES,
    isLoading: query.isLoading,
    save: (changes) => { mutation.mutate(changes) },
    isSaving: mutation.isPending,
    saveFailed: mutation.isError,
    saved: mutation.isSuccess,
  }
}
