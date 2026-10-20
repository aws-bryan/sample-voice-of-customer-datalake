/**
 * "PR/FAQ" is spelled one way in every locale string a person reads
 * (wave 3: no "PRFAQ" / "PR-FAQ" / "PR FAQ" variants). Keys may still say
 * `prfaq`; only values are checked.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const LOCALES_DIR = path.join(__dirname, '../../../public/locales')
const VARIANT = /\bPR(?:FAQ|-FAQ| FAQ)s?\b/i

function stringValues(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object' || value === null) return []
  return Object.values(value).flatMap(stringValues)
}

function variantsIn(locale: string): readonly string[] {
  const dir = path.join(LOCALES_DIR, locale)
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => stringValues(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
      .filter((text) => VARIANT.test(text))
      .map((text) => `${locale}/${file}: ${text}`))
}

describe('PR/FAQ spelling', () => {
  const locales = fs.readdirSync(LOCALES_DIR).filter((name) => fs.statSync(path.join(LOCALES_DIR, name)).isDirectory())

  it('covers all eight shipped locales', () => {
    expect(locales).toHaveLength(8)
  })

  it.each(locales)('%s locale strings only say "PR/FAQ"', (locale) => {
    expect(variantsIn(locale)).toStrictEqual([])
  })
})
