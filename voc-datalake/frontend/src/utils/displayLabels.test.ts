import { describe, expect, it } from 'vitest'
import { categoryLabel, channelLabel, humanizeId, keywordLabel, sourceLabel, subcategoryLabel, themeLabel } from './displayLabels'

const CATEGORIES = [
  {
    name: 'software_firmware',
    description: 'Software & Firmware',
    subcategories: [{ name: 'firmware_updates', description: 'Firmware Updates' }],
  },
  {
    name: 'ease_of_use',
    description: '',
    subcategories: [{ name: 'installation_setup', description: 'Installation & Setup' }],
  },
  { name: 'pricing', description: 'Everything about price. '.repeat(5), subcategories: [] },
]

describe('humanizeId', () => {
  it.each([
    ['existing_customer', 'Existing customer'],
    ['ease of_use', 'Ease of use'],
    ['api_automation', 'API automation'],
    ['ios_operating_system', 'iOS operating system'],
    ['pii__redaction_', 'PII redaction'],
    ['SwissAir', 'SwissAir'],
    ['com.spotify.music', 'com.spotify.music'],
    ['', ''],
  ])('%s → %s', (id, label) => {
    expect(humanizeId(id)).toBe(label)
  })
})

describe('categoryLabel / subcategoryLabel', () => {
  it('prefers the configured name', () => {
    expect(categoryLabel('software_firmware', CATEGORIES)).toBe('Software & Firmware')
  })

  it('falls back to the humanised id when the name is empty, too long or unknown', () => {
    expect([
      categoryLabel('ease_of_use', CATEGORIES),
      categoryLabel('pricing', CATEGORIES),
      categoryLabel('ux_issues'),
    ]).toStrictEqual(['Ease of use', 'Pricing', 'UX issues'])
  })

  it('finds a subcategory under its parent, then anywhere, else humanises', () => {
    expect([
      subcategoryLabel('firmware_updates', 'software_firmware', CATEGORIES),
      subcategoryLabel('installation_setup', undefined, CATEGORIES),
      subcategoryLabel('tac_services', 'software_firmware', CATEGORIES),
    ]).toStrictEqual(['Firmware Updates', 'Installation & Setup', 'Tac services'])
  })

  it('joins a theme as Category / Subcategory', () => {
    expect([
      themeLabel('ease_of_use', 'installation_setup', CATEGORIES),
      themeLabel('ease_of_use', null, CATEGORIES),
      themeLabel('ease_of_use', '', CATEGORIES),
    ]).toStrictEqual(['Ease of use / Installation & Setup', 'Ease of use', 'Ease of use'])
  })
})

describe('keywordLabel', () => {
  it.each([
    ['software_firmware', 'Software & Firmware'],
    ['ease_of_use', 'Ease of use'],
    ['battery', 'battery'],
  ])('%s → %s', (keyword, label) => {
    expect(keywordLabel(keyword, CATEGORIES)).toBe(label)
  })
})

describe('channelLabel', () => {
  it.each([
    ['app_review_android', undefined],
    ['web_scrape_jsonld', undefined],
    ['unknown', undefined],
    ['manual_import', undefined],
    ['', undefined],
    ['LATAM Airlines', 'LATAM Airlines'],
    ['airlinequality.com', 'airlinequality.com'],
    ['customer_email', 'Customer email'],
  ])('%s → %s', (channel, label) => {
    expect(channelLabel(channel, 'manual_import')).toBe(label)
  })
})

describe('sourceLabel', () => {
  it.each([
    ['Rappi Android_android', 'Rappi (Android)'],
    ['Zara - iOS_ios', 'Zara (iOS)'],
    ['Zara_android', 'Zara (Android)'],
    ['Zara (iOS)_ios', 'Zara (iOS)'],
    ['Rappi iOS_ios', 'Rappi (iOS)'],
    ['Android Auto helper_android', 'Android Auto helper'],
    ['Foo iOS_android', 'Foo iOS (Android)'],
    ['SwissAir_android', 'SwissAir (Android)'],
    ['TinyBean_iOS', 'TinyBean (iOS)'],
    ['zalando_ios', 'Zalando (iOS)'],
    ['com.spotify.music_Android', 'com.spotify.music (Android)'],
    ['Biosphere_android', 'Biosphere (Android)'],
    ['web_trustpilot_latam', 'Latam (Trustpilot)'],
    ['web_trustpilot_latam_airlines_main', 'Latam airlines main (Trustpilot)'],
    ['web_www_trustpilot_com', 'Trustpilot'],
    ['web_www_trustpilot_com_latam', 'Latam (Trustpilot)'],
    ['web_trustpilot_com_latam_airlines', 'Latam airlines (Trustpilot)'],
    ['web_www_example_co_uk', 'Example'],
    ['web_trustpilot_co_op', 'Co op (Trustpilot)'],
    ['manual_import', 'Manual import'],
    ['Melia - Trustpilot', 'Melia - Trustpilot'],
  ])('%s → %s', (id, label) => {
    expect(sourceLabel(id)).toBe(label)
  })

  it('prefers a source profile label, ignoring one that only repeats the id', () => {
    const profiles = [
      { id: 'web_trustpilot_latam', label: 'LATAM Airlines' },
      { id: 'radar_linear', label: 'radar_linear' },
    ]
    expect([sourceLabel('web_trustpilot_latam', profiles), sourceLabel('radar_linear', profiles)])
      .toStrictEqual(['LATAM Airlines', 'Radar · Linear'])
  })

  // Wave 4: "Radar linear" in the CSV import source picker, Source policies and Erase.
  it('names a Radar source by its brand: "Radar · <Brand>"', () => {
    const profiles = [{ id: 'competitor_reviews', label: 'competitor_reviews', radar_brand: 'Globex' }]
    expect([sourceLabel('radar_linear'), sourceLabel('competitor_reviews', profiles), sourceLabel('radar_swiss_air')])
      .toStrictEqual(['Radar · Linear', 'Radar · Globex', 'Radar · Swiss air'])
  })
})
