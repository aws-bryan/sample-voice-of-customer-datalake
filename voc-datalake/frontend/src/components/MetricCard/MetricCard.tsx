/**
 * @fileoverview Dashboard metric card component.
 *
 * Displays a single metric with optional trend indicator:
 * - Title and large value display
 * - Optional icon with color theming
 * - Trend arrow (up/down/neutral) with percentage change
 * - Mobile-responsive with adaptive sizing
 *
 * @module components/MetricCard
 */

import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import clsx from 'clsx'
import type { Tone } from '../../theme/tones'

type TrendDirection = 'up' | 'down' | 'neutral'
type MetricTone = Extract<Tone, 'accent' | 'ok' | 'danger' | 'warn' | 'muted'>

interface MetricCardProps {
  /** Metric title/label */
  title: string
  /** Main metric value */
  value: string | number
  /** Percentage change from previous period */
  change?: number
  /** Icon element to display */
  icon?: ReactNode
  /** Trend direction for styling */
  trend?: TrendDirection
  /** Color theme for icon background */
  color?: MetricTone
  /** Disclosure tooltip on the value (e.g. partial/approximate data) */
  hint?: string
  /** A secondary line under the value (e.g. "78 % negative · −0.78"). */
  detail?: ReactNode
}

const COLOR_CLASSES: Record<MetricTone, string> = {
  accent: 'bg-accent-subtle text-accent',
  ok: 'bg-ok-subtle text-ok',
  danger: 'bg-danger-subtle text-danger',
  warn: 'bg-warn-subtle text-warn',
  muted: 'bg-bg-hover text-muted',
}

function getTrendDirection(trend?: TrendDirection): string {
  if (trend === 'up') return 'Increased'
  if (trend === 'down') return 'Decreased'
  return 'No change'
}

function getTrendLabel(trend?: TrendDirection, change?: number): string {
  const direction = getTrendDirection(trend)
  return `${direction} by ${Math.abs(change ?? 0)}%`
}

function getTrendClasses(trend?: TrendDirection): string {
  if (trend === 'up') return 'text-ok'
  if (trend === 'down') return 'text-danger'
  return 'text-muted'
}

// Render the appropriate trend icon based on direction
function TrendIcon({ trend }: Readonly<{ trend?: TrendDirection }>) {
  if (trend === 'up') return <TrendingUp size={14} className="flex-shrink-0" aria-hidden="true" />
  if (trend === 'down') return <TrendingDown size={14} className="flex-shrink-0" aria-hidden="true" />
  return <Minus size={14} className="flex-shrink-0" aria-hidden="true" />
}

// Trend indicator sub-component - defined outside render to avoid recreation
function TrendIndicator({ trend, change }: Readonly<{ trend?: TrendDirection; change: number }>) {
  return (
    <div 
      className={clsx(
        'inline-flex items-center gap-1 mt-1 sm:mt-2 text-xs sm:text-sm',
        getTrendClasses(trend)
      )}
      aria-label={getTrendLabel(trend, change)}
    >
      <TrendIcon trend={trend} />
      <span className="font-mono">{change > 0 ? '+' : ''}{change}%</span>
    </div>
  )
}

/**
 * Nothing in a tile is cut off (owner request, wave 4; WCAG 1.4.4 / 1.4.10):
 * the label, value and detail WRAP instead of `truncate`. The card is a size
 * container, so the value steps down a size (never below 18 px) in a narrow
 * tile and the decorative icon is dropped below 12rem — both follow the root
 * font size, so 200 % text also gets the room.
 */
export default function MetricCard({ title, value, change, icon, trend, color = 'accent', hint, detail }: Readonly<MetricCardProps>) {
  return (
    // Padding sits inside the size container so a narrow tile (a 4-up grid at 200 % text) gives it to the text.
    <div className="card stat-accent @container !p-0">
      <div className="flex items-start justify-between gap-2 @[12rem]:gap-3 p-3 @[12rem]:p-4 @[16rem]:p-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm text-muted mb-0.5 sm:mb-1 break-words hyphens-auto">{title}</p>
          <p
            className="text-lg @[9rem]:text-xl @[13rem]:text-2xl font-bold font-mono tracking-tight text-text-strong break-words hyphens-auto"
            title={hint}
            aria-label={hint ? `${value} — ${hint}` : undefined}
          >
            {value}
          </p>
          {detail === undefined ? null : <p className="text-xs text-muted mt-0.5 break-words">{detail}</p>}
          {change !== undefined && (
            <TrendIndicator trend={trend} change={change} />
          )}
        </div>
        {icon && (
          <div 
            className={clsx(
              'hidden @[12rem]:block p-2 sm:p-2.5 rounded-lg flex-shrink-0',
              COLOR_CLASSES[color]
            )}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
