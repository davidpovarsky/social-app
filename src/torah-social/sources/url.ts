const SEFARIA_HOSTS = new Set([
  'sefaria.org',
  'www.sefaria.org',
  'sefaria.org.il',
  'www.sefaria.org.il',
])

export function isSefariaSourceUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false
  try {
    const url = new URL(uri)
    if (!SEFARIA_HOSTS.has(url.hostname.toLowerCase())) return false
    if (url.pathname.startsWith('/api/')) return false
    return url.pathname.replace(/^\/+|\/+$/g, '').length > 0
  } catch {
    return false
  }
}

/**
 * Normalizes a Sefaria ref string for reliable comparison across representations
 * (e.g. "Rosh_Hashanah.22b", "Rosh Hashanah 22b", "Rosh_Hashanah_22b").
 */
export function normalizeSefariaRef(ref: string): string {
  if (!ref || typeof ref !== 'string') return ''
  return decodeURIComponent(ref)
    .replaceAll('_', ' ')
    .replaceAll('.', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Compares two Sefaria references for semantic equality.
 */
export function areSefariaRefsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return normalizeSefariaRef(a) === normalizeSefariaRef(b)
}

export function refFromSefariaUri(uri: string): string | undefined {
  if (!isSefariaSourceUri(uri)) return undefined
  try {
    const clean = cleanSefariaUri(uri)
    const url = new URL(clean)
    const firstPath = url.pathname.replace(/^\/+|\/+$/g, '')
    if (!firstPath) return undefined
    return decodeURIComponent(firstPath).replaceAll('_', ' ')
  } catch {
    return undefined
  }
}

export function hasNoImageParam(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false
  return uri.includes('#no-image') || uri.includes('noimg=1')
}

/**
 * Cleans a Sefaria URI by normalizing scheme, hostname, stripping trailing slashes,
 * query parameters, and image flags.
 */
export function cleanSefariaUri(uri: string): string {
  if (!uri || typeof uri !== 'string') return ''
  try {
    const url = new URL(uri)
    const cleanPath = url.pathname.replace(/^\/+|\/+$/g, '')
    return `https://www.sefaria.org/${cleanPath}`
  } catch {
    return uri
      .replace(/#no-image/g, '')
      .replace(/(\?|&)noimg=1/g, '')
      .replace(/\/+$/, '')
  }
}

/**
 * Checks if two Sefaria URIs refer to the same source.
 */
export function areSefariaUrisEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return cleanSefariaUri(a).toLowerCase() === cleanSefariaUri(b).toLowerCase()
}

export function buildSefariaSourceUri(
  baseUri: string,
  includeImage: boolean = true,
): string {
  const clean = cleanSefariaUri(baseUri)
  return includeImage ? clean : `${clean}#no-image`
}

export function isSefariaEmbed(embed: unknown): boolean {
  if (!embed || typeof embed !== 'object') return false
  const anyEmbed = embed as {
    $type?: string
    external?: {uri?: string}
  }
  if (
    anyEmbed.$type === 'app.bsky.embed.external#view' &&
    typeof anyEmbed.external?.uri === 'string'
  ) {
    return isSefariaSourceUri(anyEmbed.external.uri)
  }
  return false
}
