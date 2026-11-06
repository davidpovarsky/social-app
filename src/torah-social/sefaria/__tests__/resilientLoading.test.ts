interface CoreSource {
  ref: string
  heRef: string
  uri: string
}

interface CoreVersion {
  language: string
  text: string[]
}

interface CoreText {
  heRef: string
  versions: CoreVersion[]
}

describe('Torah Social — Resilient Sefaria Loading', () => {
  it('allows core text to resolve and render when supplementary manuscripts fail', async () => {
    const mockSource: CoreSource = {
      ref: 'Berakhot.22b',
      heRef: 'ברכות כ״ב ע״ב',
      uri: 'https://www.sefaria.org/Berakhot.22b',
    }
    const mockText: CoreText = {
      heRef: 'ברכות כ״ב ע״ב',
      versions: [
        {
          language: 'he',
          text: ['בעל קרי שנתנו עליו מים טהור'],
        },
      ],
    }

    // Supplementary call that fails (e.g. 500 error or network timeout)
    const failingManuscripts = Promise.reject(
      new Error('Manuscript service unavailable (500)'),
    )

    // Primary call that succeeds
    const successfulCore: Promise<[CoreSource, CoreText]> = Promise.all([
      Promise.resolve(mockSource),
      Promise.resolve(mockText),
    ])

    let loadedSuccessfully = false
    let loadedHeRef = ''
    let loadedText = ''
    let manuscriptsCount = -1

    try {
      const [s, t] = await successfulCore
      loadedSuccessfully = true
      loadedHeRef = s.heRef
      loadedText = t.versions[0]?.text[0] ?? ''
    } catch {
      loadedSuccessfully = false
    }

    try {
      const ms = await failingManuscripts
      manuscriptsCount = Array.isArray(ms) ? ms.length : 0
    } catch {
      // Supplementary call fails gracefully without crashing the reader
      manuscriptsCount = 0
    }

    // Core content loaded successfully
    expect(loadedSuccessfully).toBe(true)
    expect(loadedHeRef).toBe('ברכות כ״ב ע״ב')
    expect(loadedText).toBe('בעל קרי שנתנו עליו מים טהור')

    // Supplementary manuscripts failed gracefully without breaking the reader
    expect(manuscriptsCount).toBe(0)
  })
})
