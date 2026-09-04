import type {
  SefariaCompletion,
  SefariaTextResponse,
  SefariaVersion,
  TorahSource,
} from './types'

const SEFARIA_ORIGIN = 'https://www.sefaria.org'

function apiUrl(path: string, params?: Record<string, string | number>) {
  const url = new URL(path, SEFARIA_ORIGIN)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: {Accept: 'application/json'},
    signal,
  })
  if (!response.ok) {
    throw new Error(`Sefaria request failed (${response.status})`)
  }
  return (await response.json()) as T
}

function flattenText(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenText)
  }
  return []
}

function selectPrimaryVersion(versions: SefariaVersion[] | undefined) {
  if (!versions?.length) return undefined
  return (
    versions.find(version => version.language === 'he') ??
    versions.find(version => version.language === 'hebrew') ??
    versions[0]
  )
}

export function sefariaRefUrl(ref: string) {
  // Sefaria documents underscores as a URL-safe replacement for spaces in refs.
  const pathRef = encodeURIComponent(ref.replaceAll(' ', '_'))
  return `${SEFARIA_ORIGIN}/${pathRef}`
}

export async function autocompleteRefs(
  query: string,
  signal?: AbortSignal,
): Promise<SefariaCompletion[]> {
  const value = query.trim()
  if (value.length < 2) return []

  type NameResponse = {
    completion_objects?: Array<{
      title?: string
      key?: string | string[]
      type?: string
    }>
  }

  const data = await getJson<NameResponse>(
    apiUrl(`/api/name/${encodeURIComponent(value)}`, {
      limit: 10,
      type: 'ref',
    }),
    signal,
  )

  return (data.completion_objects ?? [])
    .filter(item => item.type == null || item.type === 'ref')
    .flatMap(item => {
      const title = item.title?.trim()
      if (!title) return []
      const rawKey = Array.isArray(item.key) ? item.key[0] : item.key
      return [{title, key: rawKey?.trim() || title}]
    })
}

export async function validateRef(
  input: string,
  signal?: AbortSignal,
): Promise<{ref: string; heRef: string; category?: string}> {
  type RefResponse = {
    is_ref?: boolean
    ref?: string
    he_ref?: string
    heRef?: string
    primary_category?: string
    primaryCategory?: string
  }

  const value = input.trim()
  if (!value) throw new Error('יש להזין מקור')

  const data = await getJson<RefResponse>(
    apiUrl(`/api/ref/${encodeURIComponent(value)}`),
    signal,
  )

  if (data.is_ref === false || !data.ref) {
    throw new Error('המקור לא זוהה בספריית Sefaria')
  }

  return {
    ref: data.ref,
    heRef: data.he_ref || data.heRef || data.ref,
    category: data.primary_category || data.primaryCategory,
  }
}

export async function getText(
  ref: string,
  signal?: AbortSignal,
): Promise<SefariaTextResponse> {
  return getJson<SefariaTextResponse>(
    apiUrl(`/api/v3/texts/${encodeURIComponent(ref)}`, {
      version: 'primary',
      return_format: 'text_only',
    }),
    signal,
  )
}

export async function resolveTorahSource(
  input: string,
  signal?: AbortSignal,
): Promise<TorahSource> {
  const normalized = await validateRef(input, signal)
  let text: SefariaTextResponse | undefined

  try {
    text = await getText(normalized.ref, signal)
  } catch {
    // A valid ref can exist even when a requested primary text is unavailable.
    // The source remains attachable; the reader can retry without blocking post creation.
  }

  const version = selectPrimaryVersion(text?.versions)
  const preview = flattenText(version?.text).slice(0, 2).join(' ').trim()

  return {
    ref: normalized.ref,
    heRef: text?.heRef || normalized.heRef,
    uri: sefariaRefUrl(normalized.ref),
    category: normalized.category,
    preview: preview || undefined,
    versionTitle: version?.versionTitle,
    license: version?.license,
  }
}

export {SEFARIA_ORIGIN}
