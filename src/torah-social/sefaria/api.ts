import {
  type SefariaCompletion,
  type SefariaManuscript,
  type SefariaTextResponse,
  type SefariaVersion,
  type TorahSource,
} from './types'

const SEFARIA_ORIGIN = 'https://www.sefaria.org'

function apiUrl(
  path: string,
  params?: Record<string, string | number | Array<string | number>>,
) {
  const url = new URL(path, SEFARIA_ORIGIN)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item))
        }
      } else {
        url.searchParams.set(key, String(value))
      }
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

export function formatHebrewRef(ref: string, heRef?: string): string {
  if (!heRef) return ref
  // If Talmud daf ends in 'a' (א) or 'b' (ב), format canonically with ע״א / ע״ב
  if (/[0-9]+[ab]$/i.test(ref)) {
    if (heRef.endsWith(' א')) {
      return heRef.slice(0, -2) + ' ע״א'
    }
    if (heRef.endsWith(' ב')) {
      return heRef.slice(0, -2) + ' ע״ב'
    }
  }
  return heRef
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
      const rawKeys = Array.isArray(item.key) ? item.key : [item.key]
      return rawKeys
        .map(k => k?.trim())
        .filter((k): k is string => Boolean(k))
        .map(key => ({title, key}))
    })
}

export async function searchTorahSources(
  query: string,
  signal?: AbortSignal,
): Promise<SefariaCompletion[]> {
  const value = query.trim()
  if (value.length < 2) return []

  const [validatedResult, autocompleteResult] = await Promise.allSettled([
    validateRef(value, signal),
    autocompleteRefs(value, signal),
  ])

  const results: SefariaCompletion[] = []
  const seenRefs = new Set<string>()

  if (validatedResult.status === 'fulfilled' && validatedResult.value) {
    const valid = validatedResult.value
    seenRefs.add(valid.ref.toLowerCase())

    const formattedTitle = formatHebrewRef(valid.ref, valid.heRef)
    results.push({
      title: formattedTitle,
      key: valid.ref,
      exact: true,
      heRef: formattedTitle,
      ref: valid.ref,
      category: valid.category,
    })

    // If it's a Talmud daf without amud (e.g. "Rosh Hashanah 22" or "Berakhot 2"),
    // generate daf/amud candidates: 22a (ע״א) and 22b (ע״ב)
    const talmudDafMatch = valid.ref.match(/^(.+?)\s+(\d+)$/)
    if (talmudDafMatch) {
      const [, tractate, dafNum] = talmudDafMatch
      const amudA = `${tractate} ${dafNum}a`
      const amudB = `${tractate} ${dafNum}b`

      const amudCandidates = await Promise.allSettled([
        validateRef(amudA, signal),
        validateRef(amudB, signal),
      ])

      for (const cand of amudCandidates) {
        if (cand.status === 'fulfilled' && cand.value) {
          const c = cand.value
          if (!seenRefs.has(c.ref.toLowerCase())) {
            seenRefs.add(c.ref.toLowerCase())
            const candTitle = formatHebrewRef(c.ref, c.heRef)
            results.push({
              title: candTitle,
              key: c.ref,
              exact: true,
              heRef: candTitle,
              ref: c.ref,
              category: c.category,
            })
          }
        }
      }
    }
  }

  if (autocompleteResult.status === 'fulfilled') {
    for (const item of autocompleteResult.value) {
      if (!seenRefs.has(item.key.toLowerCase())) {
        seenRefs.add(item.key.toLowerCase())
        results.push(item)
      }
    }
  }

  return results
}

export async function validateRef(
  input: string,
  signal?: AbortSignal,
): Promise<{ref: string; heRef: string; category?: string}> {
  type RefResponse = {
    is_ref?: boolean
    ref?: string
    normalized?: string
    url_ref?: string
    urlRef?: string
    he_ref?: string
    heRef?: string
    hebrew?: string
    primary_category?: string
    primaryCategory?: string
    index_title?: string
  }

  const value = input.trim()
  if (!value) throw new Error('יש להזין מקור')

  const data = await getJson<RefResponse>(
    apiUrl(`/api/ref/${encodeURIComponent(value)}`),
    signal,
  )

  const resolvedRef = data.normalized || data.ref || data.url_ref
  if (data.is_ref === false || !resolvedRef) {
    throw new Error('המקור לא זוהה בספריית Sefaria')
  }

  return {
    ref: resolvedRef,
    heRef: data.hebrew || data.he_ref || data.heRef || resolvedRef,
    category: data.primary_category || data.primaryCategory || data.index_title,
  }
}

export function getTorahSourceImageUrl(
  ref: string,
  options?: {
    lang?: 'he' | 'en'
    platform?: 'twitter' | 'facebook'
    vhe?: string
    ven?: string
  },
): string {
  const params: Record<string, string> = {
    lang: options?.lang || 'he',
  }
  if (options?.platform) params.platform = options.platform
  if (options?.vhe) params.vhe = options.vhe
  if (options?.ven) params.ven = options.ven

  return apiUrl(
    `/api/img-gen/${encodeURIComponent(ref.replaceAll(' ', '_'))}`,
    params,
  )
}

export async function getManuscripts(
  ref: string,
  signal?: AbortSignal,
): Promise<SefariaManuscript[]> {
  try {
    const data = await getJson<SefariaManuscript[]>(
      apiUrl(`/api/manuscripts/${encodeURIComponent(ref)}`),
      signal,
    )
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function getText(
  ref: string,
  signal?: AbortSignal,
): Promise<SefariaTextResponse> {
  return getJson<SefariaTextResponse>(
    apiUrl(`/api/v3/texts/${encodeURIComponent(ref)}`, {
      version: ['hebrew', 'english'],
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
  const imageUrl = getTorahSourceImageUrl(normalized.ref)

  return {
    ref: normalized.ref,
    heRef: text?.heRef || normalized.heRef,
    uri: sefariaRefUrl(normalized.ref),
    category: normalized.category,
    preview: preview || undefined,
    versionTitle: version?.versionTitle,
    license: version?.license,
    imageUrl,
  }
}

export {SEFARIA_ORIGIN}
