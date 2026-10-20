/**
 * @fileoverview Live "how many reviews match" line for the persona wizard's
 * feedback-filters step.
 *
 * Persona generation reads an even sample of the matching reviews, so the count
 * says both how many match and whether the personas will see all of them. A zero
 * is called out because generation fails on an empty set, and finding that out
 * from a failed job wastes a model run.
 *
 * @module pages/ProjectDetail/PersonaFeedbackPreview
 */
import clsx from 'clsx'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { projectsApi } from '../../api/projectsApi'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { personaFeedbackScope, personaFeedbackScopeKey } from './personaFeedbackScope'
import type { PersonaFeedbackPreview as Preview } from '../../api/personaFeedbackSchema'
import type { ContextConfig } from '../../components/DataSourceWizard/exports'

/** How long the filters must be still before the count is re-requested. */
export const PERSONA_PREVIEW_DEBOUNCE_MS = 500

interface PersonaFeedbackPreviewProps {
  readonly projectId: string
  readonly contextConfig: ContextConfig
}

/** A preview whose counts were readable; anything else renders as the error line. */
interface KnownPreview {
  readonly matched: number
  readonly lowerBound: boolean
  readonly sampleLimit: number | null
}

function knownPreview(preview: Preview): KnownPreview | null {
  if (preview.matched === null) return null
  return { matched: preview.matched, lowerBound: preview.matched_is_lower_bound, sampleLimit: preview.sample_limit }
}

function matchText(t: TFunction, { matched, lowerBound }: KnownPreview): string {
  return lowerBound
    ? t('dataSourceWizard.personaPreview.matchesAtLeast', { matched })
    : t('dataSourceWizard.personaPreview.matches', { count: matched })
}

/** Whether the personas see every match, or an even sample of `limit` of them. */
function sampleText(t: TFunction, { matched, lowerBound, sampleLimit }: KnownPreview): string {
  if (sampleLimit === null) return ''
  return lowerBound || matched > sampleLimit
    ? t('dataSourceWizard.personaPreview.sampled', { limit: sampleLimit })
    : t('dataSourceWizard.personaPreview.usesAll')
}

function StatusLine({ preview, stale }: { readonly preview: KnownPreview; readonly stale: boolean }) {
  const { t } = useTranslation('components')
  if (preview.matched === 0) {
    return (
      <p className="flex items-start gap-2 text-sm text-amber-700">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        {t('dataSourceWizard.personaPreview.noMatches')}
      </p>
    )
  }
  return (
    <p className={clsx('text-sm text-gray-700 transition-opacity', stale && 'opacity-60')}>
      <span className="font-medium">{matchText(t, preview)}</span> {sampleText(t, preview)}
    </p>
  )
}

export default function PersonaFeedbackPreview({ projectId, contextConfig }: PersonaFeedbackPreviewProps) {
  const { t } = useTranslation('components')
  // The parent hands down one config object per edit, so debouncing the object
  // itself waits for the edits to stop; the first render requests immediately.
  const settled = useDebouncedValue(contextConfig, PERSONA_PREVIEW_DEBOUNCE_MS)
  const query = useQuery({
    queryKey: ['persona-feedback-preview', projectId, personaFeedbackScopeKey(settled)],
    queryFn: () => projectsApi.previewPersonaFeedback(projectId, personaFeedbackScope(settled)),
    enabled: projectId !== '',
    // Keep the last count on screen (dimmed) while the next one loads.
    placeholderData: keepPreviousData,
  })
  const preview = query.data ? knownPreview(query.data) : null

  return (
    // Sticky at the foot of the scrolling step, so the count stays in view while
    // the filters it describes are being toggled further up.
    <div role="status" aria-live="polite" className="sticky bottom-0 border-t bg-white pt-3">
      {query.isPending ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          {t('dataSourceWizard.personaPreview.counting')}
        </p>
      ) : null}
      {!query.isPending && preview === null ? (
        <p className="text-sm text-red-600">{t('dataSourceWizard.personaPreview.error')}</p>
      ) : null}
      {preview ? <StatusLine preview={preview} stale={query.isPlaceholderData} /> : null}
    </div>
  )
}
