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
    const url = new URL(uri)
    const firstPath = url.pathname.replace(/^\/+|\/+$/g, '')
    if (!firstPath) return undefined
    return decodeURIComponent(firstPath).replaceAll('_', ' ')
  } catch {
    return undefined
  }
}
