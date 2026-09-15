const SEFARIA_HOSTS = new Set([
  'sefaria.org',
  'www.sefaria.org',
  'sefaria.org.il',
  'www.sefaria.org.il',
])

export function isSefariaSourceUri(uri: string) {
  try {
    const url = new URL(uri)
    if (!SEFARIA_HOSTS.has(url.hostname.toLowerCase())) return false
    if (url.pathname.startsWith('/api/')) return false
    return url.pathname.length > 1
  } catch {
    return false
  }
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
  return uri.includes('#no-image') || uri.includes('noimg=1')
}

export function cleanSefariaUri(uri: string): string {
  return uri.replace(/#no-image/g, '').replace(/(\?|&)noimg=1/g, '')
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

