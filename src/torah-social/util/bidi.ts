/**
 * Bidirectional text utilities for Torah Social.
 *
 * Ensures mixed Hebrew/English citations, book names, tractates, daf/amud markers,
 * URLs, @handles, and parenthesized references maintain correct visual order in both
 * RTL and LTR contexts without punctuation inversion or number corruption.
 */

export const RLM = '\u200F'
export const LRM = '\u200E'
export const FSI = '\u2068' // First Strong Isolate
export const PDI = '\u2069' // Pop Directional Isolate
export const RLI = '\u2067' // Right-to-Left Isolate
export const LRI = '\u2066' // Left-to-Right Isolate

/**
 * Checks if a string contains Hebrew characters.
 */
export function hasHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text)
}

/**
 * Checks if a string is primarily Hebrew text or starts with Hebrew text.
 */
export function isHebrewText(text: string): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  // If first strong directional character is Hebrew
  const firstStrong = trimmed.match(/[\u0590-\u05FFA-Za-z]/)
  if (firstStrong && /[\u0590-\u05FF]/.test(firstStrong[0])) {
    return true
  }
  const hebrewMatches = text.match(/[\u0590-\u05FF]/g)
  const latinMatches = text.match(/[A-Za-z]/g)
  const hebrewCount = hebrewMatches ? hebrewMatches.length : 0
  const latinCount = latinMatches ? latinMatches.length : 0
  return hebrewCount >= latinCount
}

/**
 * Wraps text in First-Strong Isolation (FSI ... PDI) so that internal numbers,
 * punctuation, and quotes do not affect or get inverted by surrounding text.
 */
export function bidiIsolate(text: string): string {
  if (!text) return ''
  return `${FSI}${text}${PDI}`
}

/**
 * Formats parenthesized reference with strong directional marks so that parentheses
 * match the text's direction without getting reversed at the line boundary.
 */
export function formatParenthesizedRef(
  ref: string,
  isRtlContext: boolean = true,
): string {
  if (!ref) return ''
  const isHeb = hasHebrew(ref)
  if (isRtlContext) {
    return isHeb ? `(${RLM}${ref}${RLM})` : `(${LRM}${ref}${LRM})`
  } else {
    return isHeb ? `(${RLM}${ref}${RLM})` : `(${ref})`
  }
}

/**
 * Canonical Talmud amud and Hebrew numeral formatter.
 * Converts 'Berakhot 22b' and 'ברכות כ״ב ב' to 'ברכות כ״ב ע״ב' and ASCII quotes to unicode gershayim.
 */
export function formatCanonicalHebrewRef(ref: string, heRef?: string): string {
  let base = heRef || ref || ''
  if (!base) return ''

  // Replace ascii quotes between Hebrew characters with unicode gershayim (״)
  base = base.replace(/([\u0590-\u05FF])"([\u0590-\u05FF])/g, '$1״$2')

  // If ends with ' א' or ' ב' or variants, convert to ע״א / ע״ב
  if (/[0-9]+[ab]$/i.test(ref)) {
    if (base.endsWith(' א') || base.endsWith(' ע"א') || base.endsWith(' ע״א')) {
      base = base.replace(/ (?:א|ע"א|ע״א)$/, '') + ' ע״א'
    } else if (
      base.endsWith(' ב') ||
      base.endsWith(' ע"ב') ||
      base.endsWith(' ע״ב')
    ) {
      base = base.replace(/ (?:ב|ע"ב|ע״ב)$/, '') + ' ע״ב'
    } else if (/a$/i.test(ref) && !base.includes('ע״א')) {
      base = `${base} ע״א`
    } else if (/b$/i.test(ref) && !base.includes('ע״ב')) {
      base = `${base} ע״ב`
    }
  }

  // Ensure any remaining quote in amud marker is canonical gershayim
  return base.replace(/ע"א/g, 'ע״א').replace(/ע"ב/g, 'ע״ב')
}
