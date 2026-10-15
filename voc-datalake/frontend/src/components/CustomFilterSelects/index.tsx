/**
 * @fileoverview Shared custom-field filter dropdowns (Phase 4).
 *
 * One `<select>` per admin-configured custom filter, rendered the same way on
 * every page that exposes them (Categories, Problem Analysis). Extracted from
 * Categories' FilterBar so the two pages share one implementation; it reads its
 * two strings from the `common` namespace rather than a page namespace so it is
 * page-agnostic.
 *
 * @module components/CustomFilterSelects
 */
import { useTranslation } from 'react-i18next'

/** One custom-field filter dropdown's data: its key, label, options, and selection. */
export interface CustomFilterControl {
  readonly key: string
  readonly label: string
  readonly values: readonly string[]
  readonly selected: string
}

export function CustomFilterSelects({
  controls,
  onChange,
}: Readonly<{ controls: readonly CustomFilterControl[]; onChange: (key: string, value: string) => void }>) {
  const { t } = useTranslation('common')
  return (
    <>
      {controls.map((control) => {
        // Keep the current selection visible even when it isn't among the
        // suggested values (a high-cardinality key returns no suggestions, or
        // the value aged out of the sample), so a deep-linked filter still shows
        // what it's filtering on rather than silently reading as "all".
        const options = control.selected && !control.values.includes(control.selected)
          ? [control.selected, ...control.values]
          : control.values
        return (
          <select
            key={control.key}
            value={control.selected}
            onChange={(e) => onChange(control.key, e.target.value)}
            aria-label={t('customFilter.filterBy', { label: control.label })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">{t('customFilter.allOf', { label: control.label })}</option>
            {options.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        )
      })}
    </>
  )
}
