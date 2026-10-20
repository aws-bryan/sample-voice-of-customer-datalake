/**
 * Wave 4 live finding: Data Explorer's source picker listed "com.mattel.amethyst (Android)"
 * — an app stored under its package id — although the app config knows its name.
 */
import { describe, it, expect } from 'vitest'
import { appNamesByStoreId, appSourceName } from './useAppSourceLabel'

const names = appNamesByStoreId([
  { platform: 'Android', idField: 'package_name', apps: [
    { app_name: 'Barbie Dreamhouse', package_name: 'com.mattel.amethyst' },
    { app_name: 'Zara', package_name: 'com.inditex.zara' },
  ] },
  { platform: 'iOS', idField: 'app_id', apps: [{ app_name: '', app_id: '585629514' }] },
])

describe('appSourceName', () => {
  it('names an app stored under its package id by the configured app name', () => {
    expect(appSourceName('com.mattel.amethyst_Android', names)).toBe('Barbie Dreamhouse (Android)')
  })

  it('leaves sources it does not know to the ordinary label', () => {
    expect([appSourceName('Zara_Android', names), appSourceName('585629514_iOS', names), appSourceName('trustpilot', names)])
      .toStrictEqual([undefined, undefined, undefined])
  })
})
