import {type TorahSource} from '../sefaria/types'
import {
  formatTorahQuoteForInsertion,
  hasTorahQuoteBlock,
  isTorahQuoteAlreadyIncluded,
} from './quoteBlock'

const source: TorahSource = {
  ref: 'Rosh Hashanah 22b',
  heRef: 'ראש השנה כ״ב ע״ב',
  uri: 'https://www.sefaria.org/Rosh_Hashanah.22b',
  preview: 'מצאו ולא ידעו מה לעשות',
}

describe('Torah quote insertion', () => {
  it('inserts a short, readable quote without pasting another link', () => {
    const text = formatTorahQuoteForInsertion(source)
    expect(text).toContain('״מצאו ולא ידעו מה לעשות״')
    expect(text).toContain('ראש השנה כ״ב ע״ב')
    expect(text).not.toContain('https://')
    expect(text).not.toContain('www.sefaria.org')
  })

  it('detects the same quote after insertion and prevents duplicates', () => {
    const text = 'הודעה שלי' + formatTorahQuoteForInsertion(source)
    expect(isTorahQuoteAlreadyIncluded(text, source)).toBe(true)
    expect(isTorahQuoteAlreadyIncluded('פוסט חדש', source)).toBe(false)
  })

  it('recognizes an already-inserted legacy Sefaria URL', () => {
    expect(
      isTorahQuoteAlreadyIncluded(
        'https://www.sefaria.org/Rosh_Hashanah.22b',
        source,
      ),
    ).toBe(true)
  })

  it('works without excerpt and keeps overly long excerpts compact', () => {
    const noExcerpt = formatTorahQuoteForInsertion({
      ...source,
      preview: undefined,
    })
    expect(noExcerpt).toContain('מקור: ראש השנה כ״ב ע״ב')
    const long = formatTorahQuoteForInsertion({
      ...source,
      preview: 'א'.repeat(400),
    })
    expect(long.length).toBeLessThan(200)
  })

  it('keeps old linked Torah quote blocks readable', () => {
    const old =
      '> ״דברי תורה״\n(📖 ברכות · https://www.sefaria.org/Berakhot.22b)'
    expect(hasTorahQuoteBlock(old)).toBe(true)
  })
})
