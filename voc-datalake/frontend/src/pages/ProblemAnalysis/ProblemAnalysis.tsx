/**
 * @fileoverview Problem analysis page with hierarchical grouping.
 *
 * Features:
 * - Groups feedback by category > subcategory > problem
 * - Merges similar problems using text similarity
 * - Shows root cause hypotheses from AI analysis
 * - Urgency indicators and sentiment in words
 * - Expandable tree view for drill-down
 *
 * The filters live in the URL (`useProblemFilters`); the subcategory list narrows to
 * the chosen category.
 *
 * @module pages/ProblemAnalysis
 */

import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, MessageSquare, TrendingUp, X, Layers } from 'lucide-react'
import { api, getDateRangeParams } from '../../api/client'
import type { FeedbackItem } from '../../api/types'
import { useConfigStore } from '../../store/configStore'
import { applyResolution } from './problemResolution'
import type { CategoryGroup } from './problemResolution'
import { useProblemResolution } from './useProblemResolution'
import { useProblemFeedback } from './useProblemFeedback'
import { toggleSetMember } from './toggleSetMember'
import { WindowCoverageNotice } from './WindowCoverageNotice'
import { groupProblems, toPDFCategories } from './problemGrouping'
import { rankEntityKeys } from '../Categories/entityCounts'
import { generateProblemAnalysisPDF } from './problemAnalysisPdfGenerator'
import { getTimeRangeLabel } from '../../utils/dateUtils'
import { useTranslation } from 'react-i18next'
import { useDisplayLabels } from '../../hooks/useDisplayLabels'
import { CenteredSpinner, ExportPageHeader } from '../Categories/ExportPageHeader'
import { SIMILARITY_LEVELS, useProblemFilters } from './useProblemFilters'
import type { ProblemFilters } from './useProblemFilters'
import { ProblemFiltersBar } from './ProblemFiltersBar'
import { ProblemTree } from './ProblemTree'
import type { TreeExpansion } from './ProblemTree'

// Empty state distinguishes "nothing in this window" from "everything here
// is resolved" — hiding data behind the toggle must not read as no data.
function EmptyProblemsState({ resolvedCount }: { readonly resolvedCount: number }) {
  const { t } = useTranslation('common')
  return (
    <div className="card text-center py-8 sm:py-12">
      <AlertTriangle size={36} className="mx-auto text-muted-strong mb-3 sm:mb-4 sm:w-12 sm:h-12" />
      {resolvedCount > 0 ? (
        <>
          <p className="text-text text-sm sm:text-base">{t('problemResolution.allResolvedTitle')}</p>
          <p className="text-xs sm:text-sm text-muted mt-1">{t('problemResolution.allResolvedHint', { total: resolvedCount })}</p>
        </>
      ) : (
        <>
          <p className="text-text text-sm sm:text-base">{t('problemAnalysisPage.emptyTitle')}</p>
          <p className="text-xs sm:text-sm text-muted mt-1">{t('problemAnalysisPage.emptyHint')}</p>
        </>
      )}
    </div>
  )
}

/** One header stat. Same chrome as the dashboard metric tiles' label/value pair. */
function StatCard({ icon, label, value, tone }: Readonly<{ icon: ReactNode; label: string; value: number; tone?: 'warn' }>) {
  return (
    <div className={clsx('card stat-accent !p-3 sm:!p-4', tone === 'warn' && '!bg-warn-subtle !border-warn/30')}>
      <div className={clsx('flex items-start gap-1.5 sm:gap-2 mb-1', tone === 'warn' ? 'text-warn' : 'text-muted')}>
        {icon}
        <span className="text-xs sm:text-sm min-w-0 break-words hyphens-auto">{label}</span>
      </div>
      <p className={clsx('text-xl sm:text-2xl font-bold font-mono', tone === 'warn' ? 'text-warn' : 'text-text-strong')}>{value}</p>
    </div>
  )
}

function StatRow({ groups }: Readonly<{ groups: readonly CategoryGroup[] }>) {
  const { t } = useTranslation('problemAnalysis')
  const subcategories = groups.reduce((sum, g) => sum + g.subcategories.length, 0)
  const problems = groups.reduce((sum, g) => sum + g.subcategories.reduce((s, sub) => s + sub.problems.length, 0), 0)
  const reviews = groups.reduce((sum, g) => sum + g.totalItems, 0)
  const urgent = groups.reduce((sum, g) => sum + g.urgentCount, 0)
  const icon = (Icon: typeof TrendingUp) => <Icon size={14} className="sm:w-4 sm:h-4" aria-hidden="true" />
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 sm:gap-4">
      <StatCard icon={icon(TrendingUp)} label={t('stats.categories')} value={groups.length} />
      <StatCard icon={icon(Layers)} label={t('stats.subcategories')} value={subcategories} />
      <StatCard icon={icon(AlertTriangle)} label={t('stats.problems')} value={problems} />
      <StatCard icon={icon(MessageSquare)} label={t('stats.reviewsWithProblem')} value={reviews} />
      <StatCard icon={icon(AlertTriangle)} label={t('stats.urgentReviews')} value={urgent} tone="warn" />
    </div>
  )
}

// Rendered when persisting a resolve/unresolve fails.
function ResolveErrorBanner({ show, onDismiss }: { readonly show: boolean; readonly onDismiss: () => void }) {
  const { t } = useTranslation('common')
  if (!show) return null
  return (
    <div className="card !bg-danger-subtle !border-danger/30 text-danger text-sm !py-2 !px-3 flex items-center justify-between gap-2" role="alert">
      <span>{t('problemResolution.saveFailed')}</span>
      <button type="button" onClick={onDismiss} aria-label={t('dismiss')} className="icon-btn text-danger hover:text-danger">
        <X size={14} />
      </button>
    </div>
  )
}

function matchesFilters(item: FeedbackItem, filters: Pick<ProblemFilters, 'urgentOnly' | 'category' | 'subcategory' | 'source'>): boolean {
  return Boolean(item.problem_summary)
    && (!filters.urgentOnly || item.urgency === 'high')
    && (filters.category === null || item.category === filters.category)
    && (filters.subcategory === null || item.subcategory === filters.subcategory)
    && (filters.source === null || item.source_platform === filters.source)
}

/** The subcategories of `category` among `items` (every one when no category is chosen), A → Z. */
function subcategoriesOf(items: readonly FeedbackItem[], category: string | null): string[] {
  const subs = new Set(items
    .filter((item) => category === null || item.category === category)
    .map((item) => item.subcategory)
    .filter((sub): sub is string => typeof sub === 'string' && sub !== ''))
  return [...subs].sort((a, b) => a.localeCompare(b))
}

/**
 * Expansion state of the tree. "Expand all" opens every category and subcategory but
 * NOT every problem's review list: on a wide window that was thousands of cards at once.
 * A problem opens on its own; a subcategory lists its problems ten at a time.
 */
function useTreeExpansion(groups: readonly CategoryGroup[]) {
  const [categories, setCategories] = useState<Set<string>>(new Set())
  const [subcategories, setSubcategories] = useState<Set<string>>(new Set())
  const [problems, setProblems] = useState<Set<string>>(new Set())
  const expansion: TreeExpansion = {
    categories, subcategories, problems,
    toggleCategory: (key) => setCategories((prev) => toggleSetMember(prev, key)),
    toggleSubcategory: (key) => setSubcategories((prev) => toggleSetMember(prev, key)),
    toggleProblem: (key) => setProblems((prev) => toggleSetMember(prev, key)),
  }
  const expandAll = () => {
    setCategories(new Set(groups.map((g) => g.category)))
    setSubcategories(new Set(groups.flatMap((g) => g.subcategories.map((s) => `${g.category}:${s.subcategory}`))))
  }
  const collapseAll = () => {
    setCategories(new Set())
    setSubcategories(new Set())
    setProblems(new Set())
  }
  return { expansion, expandAll, collapseAll }
}

export default function ProblemAnalysis() {
  const { t } = useTranslation(['common', 'problemAnalysis'])
  const labels = useDisplayLabels()
  const { timeRange, customDays, dateBasis, config } = useConfigStore()
  const dateParams = getDateRangeParams(timeRange, customDays, dateBasis)
  const filters = useProblemFilters()

  const { data: entitiesData } = useQuery({
    queryKey: ['entities', dateParams],
    queryFn: () => api.getEntities({ ...dateParams, limit: 100 }),
    enabled: !!config.apiEndpoint,
  })

  // Pages the whole window (`/feedback` clamps `limit` to 100, U5b); `isPartial`
  // reports a window read only in part.
  const feedback = useProblemFeedback(dateParams, config.apiEndpoint)

  // Resolved problems are shared across users (issue #66).
  const {
    resolvedMap, resolvedLoading, pendingKeys, toggleFailed,
    toggleResolved, dismissToggleError,
  } = useProblemResolution(!!config.apiEndpoint)

  const allSources = useMemo(() => rankEntityKeys(entitiesData, 'sources'), [entitiesData])
  const allCategories = useMemo(() => rankEntityKeys(entitiesData, 'categories'), [entitiesData])
  const allSubcategories = useMemo(() => subcategoriesOf(feedback.items, filters.category), [feedback.items, filters.category])

  const threshold = SIMILARITY_LEVELS[filters.similarity]
  const { urgentOnly, category, subcategory, source } = filters
  const groupedData = useMemo(() => {
    const narrowing = { urgentOnly, category, subcategory, source }
    return groupProblems(feedback.items.filter((item) => matchesFilters(item, narrowing)), threshold)
  }, [feedback.items, urgentOnly, category, subcategory, source, threshold])

  // Annotate problem groups with their shared resolved status and hide the
  // resolved ones unless requested (issue #66).
  const { visible: visibleData, resolvedCount } = useMemo(
    () => applyResolution(groupedData, resolvedMap, filters.showResolved),
    [groupedData, resolvedMap, filters.showResolved],
  )
  const tree = useTreeExpansion(visibleData)

  const exportPDF = () => {
    if (visibleData.length === 0) return
    try {
      generateProblemAnalysisPDF({
        categories: toPDFCategories(visibleData, labels),
        timeRange: getTimeRangeLabel(timeRange, customDays, dateBasis),
        resolvedLabel: t('problemResolution.resolved'),
        filters: { source: filters.source, category: filters.category, subcategory: filters.subcategory, urgentOnly: filters.urgentOnly },
      })
    } catch {
      // PDF generation is best-effort (e.g. popup blocked)
    }
  }

  if (!config.apiEndpoint) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted">{t('problemAnalysis:configureApi')}</p>
      </div>
    )
  }

  // Gate on the resolved-state query too: without it, resolved problems
  // flash as unresolved for a frame and then vanish when the query lands.
  if (feedback.isLoading || resolvedLoading) {
    return <CenteredSpinner />
  }

  // Nothing was read: say the window is unknown instead of implying it is empty.
  if (feedback.isError && feedback.items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <WindowCoverageNotice isLoadingMore={false} isPartial={false} hasFailed loadedCount={0} totalCount={0} onRetry={feedback.retry} />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <ExportPageHeader
        title={t('problemAnalysis:title')}
        subtitle={t('problemAnalysis:subtitle')}
        onExport={exportPDF}
        exportDisabled={visibleData.length === 0}
      />
      <StatRow groups={visibleData} />
      {/* Coverage of the counts above; self-hiding when the window was read in full. */}
      <WindowCoverageNotice
        isLoadingMore={feedback.isLoadingMore}
        isPartial={feedback.isPartial}
        hasFailed={feedback.isError}
        loadedCount={feedback.loadedCount}
        totalCount={feedback.totalCount}
      />
      <ProblemFiltersBar
        filters={filters}
        sources={allSources}
        categories={allCategories}
        subcategories={allSubcategories}
        resolvedCount={resolvedCount}
        onExpandAll={tree.expandAll}
        onCollapseAll={tree.collapseAll}
      />
      <ResolveErrorBanner show={toggleFailed} onDismiss={dismissToggleError} />
      {visibleData.length === 0
        ? <EmptyProblemsState resolvedCount={resolvedCount} />
        : <ProblemTree groups={visibleData} expansion={tree.expansion} onToggleResolved={toggleResolved} pendingKeys={pendingKeys} />}
    </div>
  )
}
