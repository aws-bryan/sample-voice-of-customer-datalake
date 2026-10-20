/**
 * @fileoverview Safe date formatting utilities.
 * @module utils/dateUtils
 */

import { format, isValid, parseISO, startOfDay, subDays } from 'date-fns'
import { ALL_TIME_CUSTOM_DAYS } from '../api/baseUrl'
import type { DateBasis } from '../api/types'

/**
 * Human-readable labels for the time-range tokens stored in the config store.
 *
 * Mirrors the `fullLabel` values in `TimeRangeSelector`. `'90d'` is the widest
 * fixed preset and `'all'` is all time (days=0); the bare token must never be
 * shown to users.
 */
const TIME_RANGE_LABELS: Record<string, string> = {
  '24h': '24 Hours',
  '48h': '48 Hours',
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
  all: 'All time',
}

/**
 * Maps a stored time-range token to a human-readable label for display
 * (e.g. PDF report headers).
 *
 * - Known presets map to their descriptive label.
 * - `'custom'` becomes `Last N days` when `customDays` is set, else `Custom`.
 * - Unknown tokens fall back to the token itself.
 * - When `dateBasis` is 'review', the label notes that the window applies to
 *   review dates instead of the (default) imported dates.
 */
/** Base label for a time-range token, before any date-basis annotation. */
function baseTimeRangeLabel(timeRange: string, customDays?: number | null): string {
  if (timeRange === 'custom') {
    if (customDays == null) return 'Custom'
    return customDays === ALL_TIME_CUSTOM_DAYS ? 'All time' : `Last ${customDays} days`
  }
  return TIME_RANGE_LABELS[timeRange] ?? timeRange
}

export function getTimeRangeLabel(
  timeRange: string,
  customDays?: number | null,
  dateBasis?: DateBasis
): string {
  const baseLabel = baseTimeRangeLabel(timeRange, customDays)
  return dateBasis === 'review' ? `${baseLabel} (by review date)` : baseLabel
}

/**
 * Safely formats a date string or Date object.
 * Returns a fallback string if the date is invalid.
 */
export function safeFormatDate(
  dateValue: string | Date | null | undefined,
  formatStr: string,
  fallback = 'N/A'
): string {
  if (!dateValue) return fallback

  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue

  if (!isValid(date)) return fallback

  return format(date, formatStr)
}

/**
 * A timestamp as the reader's locale writes a date and time (medium date, short time, e.g.
 * "Oct 18, 2026, 9:05 AM" in English); `fallback` when it is missing or does not parse.
 */
export function formatDateTime(value: string | null | undefined, language: string, fallback = ''): string {
  if (value == null || value === '') return fallback
  const date = new Date(value)
  if (!isValid(date)) return fallback
  return new Intl.DateTimeFormat(language || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

function capitalised(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1)
}

/**
 * Recent activity as people say it, in the reader's locale: "Now", "5 min. ago", "2 hr. ago"
 * (earlier today), "Yesterday", then the date ("Oct 12"; with the year when it is not this
 * year). `fallback` when the timestamp is missing or does not parse. `nowMs` is injectable for tests.
 */
export function formatRelativeDate(value: string | null | undefined, language: string, nowMs: number = Date.now(), fallback = ''): string {
  if (value == null || value === '') return fallback
  const date = new Date(value)
  if (!isValid(date)) return fallback
  const lang = language || 'en'
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
  const ago = nowMs - date.getTime()
  const today = startOfDay(nowMs).getTime()
  if (ago < MINUTE_MS) return capitalised(relative.format(0, 'second'), lang)
  if (ago < HOUR_MS) return relative.format(-Math.floor(ago / MINUTE_MS), 'minute')
  if (date.getTime() >= today) return relative.format(-Math.floor(ago / HOUR_MS), 'hour')
  if (date.getTime() >= subDays(today, 1).getTime()) return capitalised(relative.format(-1, 'day'), lang)
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear()
  return new Intl.DateTimeFormat(lang, sameYear ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' }).format(date)
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/u

/**
 * A `YYYY-MM-DD` calendar day in the reader's locale: `short` = "Oct 6" (chart ticks),
 * `long` = "Oct 6, 2026" (lists). Read as a LOCAL date, so no time zone moves it a day.
 * `fallback` (the input) when it is not such a day.
 */
export function formatCalendarDay(day: string, language: string, style: 'short' | 'long' = 'long'): string {
  if (!CALENDAR_DAY.test(day)) return day
  const value = parseISO(day)
  if (!isValid(value) || format(value, 'yyyy-MM-dd') !== day) return day
  const options: Intl.DateTimeFormatOptions = style === 'short'
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  return new Intl.DateTimeFormat(language || 'en', options).format(value)
}
