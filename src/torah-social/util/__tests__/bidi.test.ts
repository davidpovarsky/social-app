import {
  bidiIsolate,
  formatCanonicalHebrewRef,
  formatParenthesizedRef,
  FSI,
  hasHebrew,
  isHebrewText,
  LRM,
  PDI,
  RLM,
} from '../bidi'

describe('Torah Social — Bidi Utilities', () => {
  describe('hasHebrew and isHebrewText', () => {
    it('detects Hebrew letters', () => {
      expect(hasHebrew('שלום')).toBe(true)
      expect(hasHebrew('Shalom')).toBe(false)
      expect(hasHebrew('ברכות 22b')).toBe(true)
    })

    it('determines primary language', () => {
      expect(isHebrewText('שלום עליכם')).toBe(true)
      expect(isHebrewText('Hello World')).toBe(false)
      expect(isHebrewText('ברכות כ״ב ע״ב (Rosh Hashanah)')).toBe(true)
      expect(isHebrewText('Rosh Hashanah tractate ברכות')).toBe(false)
    })
  })

  describe('bidiIsolate', () => {
    it('wraps string in FSI and PDI isolates', () => {
      const isolated = bidiIsolate('https://www.sefaria.org/Rosh_Hashanah.22b')
      expect(isolated.startsWith(FSI)).toBe(true)
      expect(isolated.endsWith(PDI)).toBe(true)
      expect(isolated).toBe(
        `${FSI}https://www.sefaria.org/Rosh_Hashanah.22b${PDI}`,
      )
    })

    it('returns empty string for empty input', () => {
      expect(bidiIsolate('')).toBe('')
    })
  })

  describe('formatParenthesizedRef', () => {
    it('isolates Hebrew references in RTL context with RLM', () => {
      const formatted = formatParenthesizedRef('ברכות כ״ב ע״ב', true)
      expect(formatted).toBe(`(${RLM}ברכות כ״ב ע״ב${RLM})`)
    })

    it('isolates English references in RTL context with LRM', () => {
      const formatted = formatParenthesizedRef('Rosh_Hashanah_22b', true)
      expect(formatted).toBe(`(${LRM}Rosh_Hashanah_22b${LRM})`)
    })

    it('handles LTR context properly', () => {
      const formatted = formatParenthesizedRef('Berakhot 22b', false)
      expect(formatted).toBe('(Berakhot 22b)')
    })
  })

  describe('formatCanonicalHebrewRef', () => {
    it('formats Talmud daf ending in a to ע״א', () => {
      expect(formatCanonicalHebrewRef('Berakhot.2a', 'ברכות ב א')).toBe(
        'ברכות ב ע״א',
      )
      expect(formatCanonicalHebrewRef('Berakhot.2a', 'ברכות ב ע"א')).toBe(
        'ברכות ב ע״א',
      )
    })

    it('formats Talmud daf ending in b to ע״ב', () => {
      expect(
        formatCanonicalHebrewRef('Rosh_Hashanah.22b', 'ראש השנה כב ב'),
      ).toBe('ראש השנה כב ע״ב')
      expect(
        formatCanonicalHebrewRef('Rosh_Hashanah.22b', 'ראש השנה כ״ב ב'),
      ).toBe('ראש השנה כ״ב ע״ב')
      expect(
        formatCanonicalHebrewRef('Rosh_Hashanah.22b', 'ראש השנה כ"ב ע"ב'),
      ).toBe('ראש השנה כ״ב ע״ב')
    })

    it('converts ascii gershayim to unicode gershayim in Hebrew numerals', () => {
      expect(formatCanonicalHebrewRef('Berakhot.22b', 'ברכות כ"ב ע"ב')).toBe(
        'ברכות כ״ב ע״ב',
      )
    })

    it('falls back to ref when heRef is not provided', () => {
      expect(formatCanonicalHebrewRef('Genesis.1.1')).toBe('Genesis.1.1')
    })
  })
})
