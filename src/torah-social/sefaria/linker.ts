import {sefariaRefUrl} from './api'
import type {DetectedTorahSource} from './types'

const FIND_REFS_URL = 'https://www.sefaria.org/api/find-refs'
const ASYNC_URL = 'https://www.sefaria.org/api/async'

const POLL_INTERVAL_MS = 350
const MAX_POLLS = 30

type FindRefsSection = {
  results?: Array<{
    startChar?: number
    endChar?: number
    text?: string
    linkFailed?: boolean
    refs?: string[]
  }>
  refData?: Record<
    string,
    {
      heRef?: string
      url?: string
      primaryCategory?: string
      he?: unknown
      en?: unknown
    }
  >
}

type FindRefsResult = {
  body?: FindRefsSection
  title?: FindRefsSection
}

type AsyncResponse = {
  task_id?: string
  state?: string
  ready?: boolean
  result?: FindRefsResult
  error?: string
}

function detectLanguage(text: string): 'he' | 'en' {
  const hebrew = (text.match(/[\u0590-\u05ff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return hebrew >= latin ? 'he' : 'en'
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (!signal) return
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      {once: true},
    )
  })
}

async function pollTask(taskId: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const response = await fetch(`${ASYNC_URL}/${encodeURIComponent(taskId)}`, {
      headers: {Accept: 'application/json'},
      signal,
    })
    const data = (await response.json()) as AsyncResponse

    if (response.status === 200) {
      if (!data.result) throw new Error('Sefaria Linker returned no result')
      return data.result
    }
    if (response.status >= 400) {
      throw new Error(data.error || `Sefaria Linker failed (${response.status})`)
    }

    await sleep(POLL_INTERVAL_MS, signal)
  }

  throw new Error('Sefaria Linker timed out')
}

/**
 * Detect citations in arbitrary post text using Sefaria's current asynchronous
 * Find Refs API. The API returns all candidate refs when a citation is ambiguous;
 * we preserve that fact so the UI never silently pretends an ambiguous citation
 * is certain.
 */
export async function detectTorahSources(
  text: string,
  signal?: AbortSignal,
): Promise<DetectedTorahSource[]> {
  const body = text.trim()
  if (body.length < 3) return []

  const response = await fetch(FIND_REFS_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: {title: '', body},
      lang: detectLanguage(body),
    }),
    signal,
  })

  const queued = (await response.json()) as AsyncResponse
  if (response.status !== 202 || !queued.task_id) {
    throw new Error(
      queued.error || `Sefaria Linker could not enqueue (${response.status})`,
    )
  }

  const result = await pollTask(queued.task_id, signal)
  const section = result.body
  if (!section?.results?.length) return []

  const found: DetectedTorahSource[] = []
  for (const match of section.results) {
    if (match.linkFailed || !match.refs?.length) continue
    const ref = match.refs[0]
    const data = section.refData?.[ref]

    found.push({
      ref,
      heRef: data?.heRef || ref,
      uri: sefariaRefUrl(ref),
      category: data?.primaryCategory,
      matchedText: match.text || ref,
      startChar: match.startChar ?? 0,
      endChar: match.endChar ?? 0,
      ambiguous: match.refs.length > 1,
    })
  }

  return found
}
