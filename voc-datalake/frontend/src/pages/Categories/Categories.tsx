/**
 * @fileoverview Categories analysis page: one unified filter bar, three
 * interactive analytics cards (category distribution doubles as the category
 * selector, sentiment gauge legend is the sentiment control, keyword clicks
 * populate search), and the consolidated feedback list that replaced the
 * standalone Feedback page (issue #198). The default view (nothing selected)
 * browses all feedback.
 * @module pages/Categories
 */

import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { getDateRangeParams } from '../../api/client'
import type { FeedbackItem } from '../../api/client'
import { useConfigStore } from '../../store/configStore'
import { getTimeRangeLabel } from '../../utils/dateUtils'
import type { ViewMode } from './types'
import { FilterBar } from './FilterBar'
import { SentimentGauge } from './SentimentGaugeCard'
import { WordCloudCard } from './WordCloudCard'
import { CategoryDistribution } from './CategoryDistribution'
import { FeedbackResults } from './FeedbackResults'
import { generateCategoriesPDF } from './categoriesPdfGenerator'
import { useCategoryFilters } from './useCategoryFilters'
import { useFeedbackListData } from './useFeedbackListData'
import { useCategoryAnalytics } from './useCategoryAnalytics'
import { useCustomFilterControls } from './useCustomFilterControls'
import { useEmptyWindowFallback } from '../../hooks/useEmptyWindowFallback'
import EmptyWindowBanner from '../../components/EmptyWindowBanner'
import { csvField } from '../../utils/csv'
import { useTranslation } from 'react-i18next'

function exportFeedbackCsv(items: FeedbackItem[]): void {
  const csv = [
    ['ID', 'Source', 'Category', 'Sentiment', 'Rating', 'Text', 'Date'].map(csvField).join(','),
    ...items.map(item => [
      csvField(item.feedback_id),
      csvField(item.source_platform),
      csvField(item.category),
      csvField(item.sentiment_label),
      csvField(item.rating ?? ''),
      csvField(item.original_text),
      csvField(item.source_created_at),
    ].join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `feedback-export-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * PDF generation is best-effort (e.g. popup blocked) — never crash the page.
 * Only the error message is logged: the full error object could carry
 * feedback content from the report payload.
 */
function safeGeneratePdf(generate: () => void): void {
  try {
    generate()
  } catch (err) {
    console.error('PDF export failed:', err instanceof Error ? err.message : String(err))
  }
}

export default function Categories() {
  const { t } = useTranslation(['common', 'categories'])
  const { timeRange, customDays, dateBasis, config } = useConfigStore()
  const dateParams = getDateRangeParams(timeRange, customDays, dateBasis)

  const filters = useCategoryFilters()
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Analytics on the user's selected window first — its emptiness decides whether
  // to fall back. Only fall back when NO filters are active: a filtered window
  // that matches nothing is an honest empty result (the user asked a specific
  // question), not stale-data-out-of-range, so widening it would surface
  // unrelated feedback and misrepresent the filter.
  const selectedAnalytics = useCategoryAnalytics(dateParams, filters.selectedSource, config.apiEndpoint)
  const selectedEmpty = !filters.hasActiveFilters && !selectedAnalytics.isLoading && selectedAnalytics.totalIssues === 0
  const { effectiveDateParams, fallback, isResolving } = useEmptyWindowFallback(
    dateParams, selectedEmpty, selectedAnalytics.isLoading, config.apiEndpoint, dateBasis,
  )

  // Re-query at the effective window. When no fallback is active
  // effectiveDateParams === dateParams, so these resolve to the same cache
  // entries as the probe queries above (no extra fetch).
  const analytics = useCategoryAnalytics(effectiveDateParams, filters.selectedSource, config.apiEndpoint)
  const feedback = useFeedbackListData(effectiveDateParams, filters, config.apiEndpoint)
  const customFilterControls = useCustomFilterControls(config.apiEndpoint, filters.customFilters)

  const exportCsv = () => exportFeedbackCsv(feedback.filteredFeedback)

  // One report: analytics sections plus the currently filtered feedback items.
  const exportPdf = () => safeGeneratePdf(() => generateCategoriesPDF({
    categoryData: analytics.categoryData,
    sentimentData: analytics.sentimentData,
    wordCloudData: analytics.wordCloudData,
    totalIssues: analytics.totalIssues,
    avgSentiment: analytics.avgSentiment,
    timeRange: getTimeRangeLabel(timeRange, customDays, dateBasis),
    selectedSource: filters.selectedSource,
    items: feedback.filteredFeedback,
  }))

  if (!config.apiEndpoint) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">{t('categories:configureApiEndpoint')}</p>
      </div>
    )
  }

  // `isResolving` holds the spinner while the empty-window probe runs, so the
  // page doesn't briefly render an empty grid before the fallback widens.
  if (analytics.isLoading || isResolving) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {fallback ? <EmptyWindowBanner date={fallback.latestDate} /> : null}
      <FilterBar
        searchText={filters.searchText}
        onSearchChange={filters.setSearchText}
        selectedSource={filters.selectedSource}
        onSourceChange={filters.setSelectedSource}
        allSources={analytics.allSources}
        showUrgentOnly={filters.showUrgentOnly}
        onUrgentChange={filters.setShowUrgentOnly}
        ratingFilter={filters.ratingFilter}
        onRatingFilterChange={filters.setRatingFilter}
        hasActiveFilters={filters.hasActiveFilters}
        onClearFilters={filters.clearFilters}
        customFilterControls={customFilterControls}
        onCustomFilterChange={filters.setCustomFilter}
        trailing={
          <button
            onClick={exportPdf}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap"
            title={t('exportPdfTooltip')}
          >
            <FileDown size={14} />
            {t('exportPdf')}
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <CategoryDistribution
          categoryData={analytics.categoryData}
          totalIssues={analytics.totalIssues}
          periodDays={analytics.periodDays}
          selectedCategories={filters.selectedCategories}
          onToggleCategory={filters.toggleCategory}
        />
        <SentimentGauge
          sentimentData={analytics.sentimentData}
          avgSentiment={analytics.avgSentiment}
          sentimentFilter={filters.sentimentFilter}
          onSentimentFilterChange={filters.setSentimentFilter}
          percentages={analytics.sentimentPercentages}
        />
        <WordCloudCard
          wordCloudData={analytics.wordCloudData}
          searchText={filters.searchText}
          onSearchChange={filters.setSearchText}
        />
      </div>

      <FeedbackResults
        filteredFeedback={feedback.filteredFeedback}
        feedbackLoading={feedback.isLoading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedSource={filters.selectedSource}
        selectedCategories={filters.selectedCategories}
        sentimentFilter={filters.sentimentFilter}
        ratingFilter={filters.ratingFilter}
        onExport={exportCsv}
        totalCount={feedback.totalCount}
        isPartialWindow={feedback.isPartialWindow}
        hasMore={feedback.hasMore}
        onLoadMore={feedback.loadMore}
        isLoadingMore={feedback.isLoadingMore}
      />
    </div>
  )
}
