import {formatHebrewRef, sefariaRefUrl, validateRef} from './api'
import {type DetectedTorahSource} from './types'

const FIND_REFS_URL = 'https://www.sefaria.org/api/find-refs'
const ASYNC_URL = 'https://www.sefaria.org/api/async'

const POLL_INTERVAL_MS = 300
const MAX_POLLS = 10 // 3 seconds timeout for Sefaria Linker polling before fallback

const TALMUD_TRACTATES = [
  'ברכות',
  'שבת',
  'עירובין',
  'פסחים',
  'שקלים',
  'יומא',
  'סוכה',
  'ביצה',
  'ראש השנה',
  'תענית',
  'מגילה',
  'מועד קטן',
  'חגיגה',
  'יבמות',
  'כתובות',
  'נדרים',
  'נזיר',
  'סוטה',
  'גיטין',
  'קידושין',
  'בבא קמא',
  'בבא מציעא',
  'בבא בתרא',
  'סנהדרין',
  'מכות',
  'שבועות',
  'עבודה זרה',
  'הוריות',
  'זבחים',
  'מנחות',
  'חולין',
  'בכורות',
  'ערכין',
  'תמורה',
  'כריתות',
  'מעילה',
  'תמיד',
  'מדות',
  'קינים',
  'נדה',
]

const TANAKH_BOOKS = [
  'בראשית',
  'שמות',
  'ויקרא',
  'במדבר',
  'דברים',
  'יהושע',
  'שופטים',
  'שמואל א',
  'שמואל ב',
  'שמואל',
  'מלכים א',
  'מלכים ב',
  'מלכים',
  'ישעיהו',
  'ישעיה',
  'ירמיהו',
  'ירמיה',
  'יחזקאל',
  'הושע',
  'יואל',
  'עמוס',
  'עובדיה',
  'יונה',
  'מיכה',
  'נחום',
  'חבקוק',
  'צפניה',
  'חגי',
  'זכריה',
  'מלאכי',
  'תהילים',
  'תהלים',
  'משלי',
  'איוב',
  'שיר השירים',
  'רות',
  'איכה',
  'קהלת',
  'אסתר',
  'דניאל',
  'עזרא',
  'נחמיה',
  'דברי הימים א',
  'דברי הימים ב',
  'דברי הימים',
]

const ENGLISH_BOOKS = [
  'Genesis',
  'Exodus',
  'Leviticus',
  'Numbers',
  'Deuteronomy',
  'Joshua',
  'Judges',
  'I Samuel',
  'II Samuel',
  '1 Samuel',
  '2 Samuel',
  'I Kings',
  'II Kings',
  '1 Kings',
  '2 Kings',
  'Isaiah',
  'Jeremiah',
  'Ezekiel',
  'Hosea',
  'Joel',
  'Amos',
  'Obadiah',
  'Jonah',
  'Micah',
  'Nahum',
  'Habakkuk',
  'Zephaniah',
  'Haggai',
  'Zechariah',
  'Malachi',
  'Psalms',
  'Proverbs',
  'Job',
  'Song of Songs',
  'Ruth',
  'Lamentations',
  'Ecclesiastes',
  'Esther',
  'Daniel',
  'Ezra',
  'Nehemiah',
  'I Chronicles',
  'II Chronicles',
  '1 Chronicles',
  '2 Chronicles',
  'Berakhot',
  'Shabbat',
  'Eruvin',
  'Pesachim',
  'Rosh Hashanah',
  'Yoma',
  'Sukkah',
  'Beitzah',
  'Taanit',
  'Megillah',
  'Chagigah',
  'Yevamot',
  'Ketubot',
  'Nedarim',
  'Gittin',
  'Kiddushin',
  'Bava Kamma',
  'Bava Metzia',
  'Bava Batra',
  'Sanhedrin',
  'Makkot',
  'Shevuot',
  'Avodah Zarah',
  'Horayot',
  'Zevachim',
  'Menachot',
  'Chullin',
]

const ALL_HEBREW_BOOKS = [...TALMUD_TRACTATES, ...TANAKH_BOOKS].sort(
  (a, b) => b.length - a.length,
)

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

function logDiagnostic(event: string, meta?: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.debug(`[TorahLinker] ${event}`, meta ? JSON.stringify(meta) : '')
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (!signal) return
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        const err =
          typeof DOMException !== 'undefined'
            ? new DOMException('Aborted', 'AbortError')
            : new Error('Aborted')
        reject(err)
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
      throw new Error(
        data.error || `Sefaria Linker failed (${response.status})`,
      )
    }

    await sleep(POLL_INTERVAL_MS, signal)
  }

  throw new Error('Sefaria Linker timed out')
}

export function extractCandidateTorahRefs(text: string): Array<{
  matchedText: string
  candidate: string
  startChar: number
  endChar: number
}> {
  const candidates: Array<{
    matchedText: string
    candidate: string
    startChar: number
    endChar: number
  }> = []

  // 1. Hebrew candidate extraction
  for (const book of ALL_HEBREW_BOOKS) {
    const pattern = new RegExp(
      `(?:^|[\\s(\\["'>״])(?:[בלמשכ]|וכ|וב)?(${book.replace(/\\s+/g, '\\s+')})\\s+([א-ת0-9]+(?:[:\\s]+(?:ע["״][אב]|[אב]|\\d+|[א-ת]+))?)`,
      'gu',
    )
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const fullRef = `${match[1]} ${match[2]}`.trim()
      candidates.push({
        matchedText: match[0].trim(),
        candidate: fullRef,
        startChar: match.index,
        endChar: match.index + match[0].length,
      })
    }
  }

  // 2. English candidate extraction
  for (const book of ENGLISH_BOOKS) {
    const pattern = new RegExp(`\\b(${book})\\s+(\\d+(?::\\d+|[ab])?)\\b`, 'gi')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      candidates.push({
        matchedText: match[0].trim(),
        candidate: match[0].trim(),
        startChar: match.index,
        endChar: match.index + match[0].length,
      })
    }
  }

  return candidates
}

export async function detectTorahSourcesFallback(
  text: string,
  signal?: AbortSignal,
): Promise<DetectedTorahSource[]> {
  const candidates = extractCandidateTorahRefs(text)
  if (!candidates.length) return []

  const validated: DetectedTorahSource[] = []
  const seenRefs = new Set<string>()

  for (const c of candidates) {
    if (signal?.aborted) break
    try {
      const valid = await validateRef(c.candidate, signal)
      if (!seenRefs.has(valid.ref.toLowerCase())) {
        seenRefs.add(valid.ref.toLowerCase())
        const heRef = formatHebrewRef(valid.ref, valid.heRef)
        validated.push({
          ref: valid.ref,
          heRef,
          uri: sefariaRefUrl(valid.ref),
          category: valid.category,
          matchedText: c.matchedText,
          startChar: c.startChar,
          endChar: c.endChar,
          ambiguous: false,
        })
      }
    } catch {
      // Discard invalid candidate
    }
  }

  return validated
}

/**
 * Detect citations in arbitrary post text using Sefaria's Find Refs API
 * with automatic fallback to local regex candidate validation.
 */
export async function detectTorahSources(
  text: string,
  signal?: AbortSignal,
): Promise<DetectedTorahSource[]> {
  const body = text.trim()
  if (body.length < 3) return []

  const lang = detectLanguage(body)
  logDiagnostic('start', {textLength: body.length, lang})

  let linkerResults: DetectedTorahSource[] = []
  let linkerFailed = false

  try {
    const response = await fetch(FIND_REFS_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: {title: '', body},
        lang,
      }),
      signal,
    })

    logDiagnostic('enqueue_response', {status: response.status})

    const queued = (await response.json()) as AsyncResponse
    if (response.status !== 202 || !queued.task_id) {
      throw new Error(
        queued.error || `Sefaria Linker could not enqueue (${response.status})`,
      )
    }

    logDiagnostic('task_queued', {taskId: queued.task_id})
    const result = await pollTask(queued.task_id, signal)
    const section = result.body

    if (section?.results?.length) {
      for (const match of section.results) {
        if (match.linkFailed || !match.refs?.length) continue
        const primaryRef = match.refs[0]
        const data = section.refData?.[primaryRef]

        const candidateRefs =
          match.refs.length > 1
            ? match.refs.map(r => {
                const d = section.refData?.[r]
                const heRef = formatHebrewRef(r, d?.heRef || r)
                return {
                  ref: r,
                  heRef,
                  uri: sefariaRefUrl(r),
                }
              })
            : undefined

        const heRef = formatHebrewRef(primaryRef, data?.heRef || primaryRef)
        linkerResults.push({
          ref: primaryRef,
          heRef,
          uri: sefariaRefUrl(primaryRef),
          category: data?.primaryCategory,
          matchedText: match.text || primaryRef,
          startChar: match.startChar ?? 0,
          endChar: match.endChar ?? 0,
          ambiguous: match.refs.length > 1,
          candidateRefs,
        })
      }
    }
    logDiagnostic('linker_success', {foundCount: linkerResults.length})
  } catch (err) {
    linkerFailed = true
    logDiagnostic('linker_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Fallback: If linker returned nothing or failed, run fallback detection
  if (linkerResults.length === 0 || linkerFailed) {
    try {
      const fallbackResults = await detectTorahSourcesFallback(body, signal)
      logDiagnostic('fallback_complete', {
        fallbackFound: fallbackResults.length,
      })
      if (fallbackResults.length > 0) {
        return fallbackResults
      }
    } catch (fbErr) {
      logDiagnostic('fallback_error', {
        error: fbErr instanceof Error ? fbErr.message : String(fbErr),
      })
    }
  }

  return linkerResults
}
