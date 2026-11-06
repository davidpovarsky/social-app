import {
  areSefariaRefsEqual,
  areSefariaUrisEqual,
  cleanSefariaUri,
  hasNoImageParam,
  isSefariaEmbed,
  isSefariaSourceUri,
  normalizeSefariaRef,
  refFromSefariaUri,
} from '../url'

describe('Torah Social — Sefaria URL & Ref Normalization', () => {
  describe('isSefariaSourceUri & hasNoImageParam', () => {
    it('detects valid Sefaria source URIs', () => {
      expect(isSefariaSourceUri('https://www.sefaria.org/Berakhot.2b')).toBe(
        true,
      )
      expect(isSefariaSourceUri('https://google.com')).toBe(false)
    })
    it('detects no-image flag in uri', () => {
      expect(
        hasNoImageParam('https://www.sefaria.org/Berakhot.2b#no-image'),
      ).toBe(true)
      expect(hasNoImageParam('https://www.sefaria.org/Berakhot.2b')).toBe(false)
    })
  })

  describe('cleanSefariaUri', () => {
    it('normalizes trailing slashes', () => {
      expect(cleanSefariaUri('https://www.sefaria.org/Berakhot.2b/')).toBe(
        'https://www.sefaria.org/Berakhot.2b',
      )
    })

    it('strips image flags and fragments', () => {
      expect(cleanSefariaUri('https://sefaria.org/Berakhot.2b#no-image')).toBe(
        'https://www.sefaria.org/Berakhot.2b',
      )
      expect(
        cleanSefariaUri('https://www.sefaria.org/Berakhot.2b?noimg=1'),
      ).toBe('https://www.sefaria.org/Berakhot.2b')
    })

    it('normalizes host to www.sefaria.org', () => {
      expect(cleanSefariaUri('https://sefaria.org/Genesis.1.1')).toBe(
        'https://www.sefaria.org/Genesis.1.1',
      )
      expect(cleanSefariaUri('http://www.sefaria.org/Genesis.1.1/')).toBe(
        'https://www.sefaria.org/Genesis.1.1',
      )
    })
  })

  describe('areSefariaUrisEqual', () => {
    it('recognizes URIs differing only by trailing slash, host, or flags as equal', () => {
      expect(
        areSefariaUrisEqual(
          'https://sefaria.org/Rosh_Hashanah.22b/',
          'https://www.sefaria.org/Rosh_Hashanah.22b#no-image',
        ),
      ).toBe(true)
    })
  })

  describe('normalizeSefariaRef & areSefariaRefsEqual', () => {
    it('normalizes dots and underscores to spaces', () => {
      expect(normalizeSefariaRef('Rosh_Hashanah.22b')).toBe('rosh hashanah 22b')
      expect(normalizeSefariaRef('Rosh_Hashanah_22b')).toBe('rosh hashanah 22b')
      expect(normalizeSefariaRef('Rosh Hashanah 22b')).toBe('rosh hashanah 22b')
    })

    it('considers variants of the same ref equal', () => {
      expect(
        areSefariaRefsEqual('Rosh_Hashanah.22b', 'Rosh Hashanah 22b'),
      ).toBe(true)
      expect(
        areSefariaRefsEqual('Rosh_Hashanah_22b', 'Rosh_Hashanah.22b'),
      ).toBe(true)
    })
  })

  describe('refFromSefariaUri', () => {
    it('extracts ref from various Sefaria URL structures', () => {
      expect(refFromSefariaUri('https://www.sefaria.org/Berakhot.2b/')).toBe(
        'Berakhot.2b',
      )
      expect(
        refFromSefariaUri('https://sefaria.org/Rosh_Hashanah.22b#no-image'),
      ).toBe('Rosh Hashanah.22b')
    })
  })

  describe('isSefariaEmbed', () => {
    it('validates external embed structures correctly', () => {
      expect(
        isSefariaEmbed({
          $type: 'app.bsky.embed.external#view',
          external: {uri: 'https://www.sefaria.org/Berakhot.2b'},
        }),
      ).toBe(true)

      expect(
        isSefariaEmbed({
          $type: 'app.bsky.embed.external#view',
          external: {uri: 'https://example.com/not-sefaria'},
        }),
      ).toBe(false)

      expect(isSefariaEmbed(null)).toBe(false)
      expect(isSefariaEmbed({})).toBe(false)
    })
  })
})
