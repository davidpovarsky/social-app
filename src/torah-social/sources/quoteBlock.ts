import type {TorahSource} from '../sefaria/types'
import {cleanSefariaUri} from './url'

export const TORAH_QUOTE_REGEX =
  /(?:^|\n)>\s*(?:״([^״\n]+)״|"([^"\n]+)"|([^\n(]+))?\s*(?:\n|\s)*\(?(?:📖\s*)?([^·\n)]+)?(?:\s*·\s*)?(https?:\/\/(?:www\.)?sefaria\.org\/[^\s)]+)\)?/g

export type TorahBlockText = {
  type: 'text'
  content: string
}

export type TorahBlockQuote = {
  type: 'quote'
  quote: string
  refName?: string
  uri: string
}

export type TorahBlockItem = TorahBlockText | TorahBlockQuote

/**
 * A quote is prose; the tappable reference belongs in the separate external
 * embed. Never paste a raw Sefaria URL into the post body automatically.
 */
export function formatTorahQuoteForInsertion(source: TorahSource): string {
  const excerpt = source.preview?.replace(/\s+/g, ' ').trim() ?? ''
  const quote = excerpt.length > 140 ? `${excerpt.slice(0, 137)}…` : excerpt
  const ref = source.heRef || source.ref || 'מקור תורני'
  return quote ? `\n״${quote}״\n— ${ref}\n` : `\nמקור: ${ref}\n`
}

/** Prevent accidental repeated insertion from search and auto-detection. */
export function isTorahQuoteAlreadyIncluded(
  text: string,
  source: TorahSource,
): boolean {
  const ref = source.heRef || source.ref
  if (!text || !ref) return false
  return (
    text.includes(`— ${ref}`) ||
    text.includes(`מקור: ${ref}`) ||
    (Boolean(source.uri) && text.includes(cleanSefariaUri(source.uri)))
  )
}

export function hasTorahQuoteBlock(text: string): boolean {
  if (!text || typeof text !== 'string') return false
  if (!text.includes('sefaria.org')) return false
  TORAH_QUOTE_REGEX.lastIndex = 0
  return TORAH_QUOTE_REGEX.test(text)
}

export function parseTorahQuoteBlocks(text: string): TorahBlockItem[] {
  const blocks: TorahBlockItem[] = []
  let lastIndex = 0
  TORAH_QUOTE_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TORAH_QUOTE_REGEX.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = TORAH_QUOTE_REGEX.lastIndex

    if (matchStart > lastIndex) {
      const beforeText = text.slice(lastIndex, matchStart).trim()
      if (beforeText) {
        blocks.push({type: 'text', content: beforeText})
      }
    }

    const quote = (match[1] || match[2] || match[3] || '').trim()
    const refName = (match[4] || '').trim()
    const uri = match[5].trim()

    blocks.push({
      type: 'quote',
      quote,
      refName: refName || undefined,
      uri,
    })

    lastIndex = matchEnd
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining) {
      blocks.push({type: 'text', content: remaining})
    }
  }

  return blocks
}
