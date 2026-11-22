type Api = typeof import('../api')

const START = Date.UTC(2026, 10, 22, 12, 0, 0)

function response(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  // The application suite uses the Expo preset. Mock the consumed response
  // contract directly instead of relying on its platform Response constructor.
  const values = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  )
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {get: (name: string) => values.get(name.toLowerCase()) ?? null},
    json: () => Promise.resolve(data),
  } as unknown as Response
}

function refData(ref: string, addressTypes = ['Talmud', 'Integer']) {
  return {
    is_ref: true,
    normalized: ref,
    hebrew: ref,
    address_types: addressTypes,
  }
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input !== 'string') throw new Error('Expected a string API URL')
  return input
}

function capture<T>(promise: Promise<T>) {
  return promise.then(
    value => ({ok: true as const, value}),
    error => ({ok: false as const, error: error as unknown}),
  )
}

async function resolved<T>(promise: Promise<T>): Promise<T> {
  const pending = capture(promise)
  await jest.runAllTimersAsync()
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  const pending = capture(promise)
  await jest.runAllTimersAsync()
  const result = await pending
  if (result.ok) throw new Error('Expected the operation to reject')
  return result.error
}

describe('Sefaria request resilience — real API module, fake clock and fetch', () => {
  let api: Api
  let fetchMock: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >

  beforeEach(() => {
    jest.useFakeTimers({now: START})
    jest.resetModules()
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected test request'))
    api = jest.requireActual<Api>('../api')
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('recovers from 429 only after the integer Retry-After delay', async () => {
    const starts: number[] = []
    fetchMock.mockImplementation(() => {
      starts.push(Date.now())
      return Promise.resolve(
        starts.length === 1
          ? response({}, 429, {'Retry-After': '2'})
          : response(refData('Berakhot 2a')),
      )
    })
    const pending = capture(api.validateRef('Berakhot 2a'))
    await jest.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result.ok).toBe(true)
    expect(starts).toEqual([START, START + 2_000])
  })

  it('honors an HTTP-date Retry-After without starting early', async () => {
    const starts: number[] = []
    fetchMock.mockImplementation(() => {
      starts.push(Date.now())
      return Promise.resolve(
        starts.length === 1
          ? response({}, 429, {
              'Retry-After': new Date(START + 4_000).toUTCString(),
            })
          : response(refData('Berakhot 2a')),
      )
    })
    const pending = capture(api.validateRef('Berakhot 2a'))
    await jest.advanceTimersByTimeAsync(3_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    expect((await pending).ok).toBe(true)
    expect(starts).toEqual([START, START + 4_000])
  })

  it('exhausts at most two 429 retries and never caches the failure', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({}, 429, {'Retry-After': '1'})),
    )
    expect(await rejected(api.validateRef('Berakhot 2a'))).toBeInstanceOf(
      api.SefariaRateLimitError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    fetchMock.mockImplementation(() =>
      Promise.resolve(response(refData('Berakhot 2a'))),
    )
    expect((await resolved(api.validateRef('Berakhot 2a'))).ref).toBe(
      'Berakhot 2a',
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('refuses a long Retry-After rather than clamping it and respects shared cooldown', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({}, 429, {'Retry-After': '60'})),
    )
    const first = await rejected(api.validateRef('Berakhot 2a'))
    expect(first).toBeInstanceOf(api.SefariaRateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const second = await rejected(api.validateRef('Berakhot 2b'))
    expect(second).toBeInstanceOf(api.SefariaRateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(60_000)
    fetchMock.mockImplementation(() =>
      Promise.resolve(response(refData('Berakhot 2b'))),
    )
    expect((await resolved(api.validateRef('Berakhot 2b'))).ref).toBe(
      'Berakhot 2b',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses bounded local pacing for a missing or malformed Retry-After', async () => {
    const starts: number[] = []
    fetchMock.mockImplementation(() => {
      starts.push(Date.now())
      if (starts.length === 1) return Promise.resolve(response({}, 429))
      if (starts.length === 2)
        return Promise.resolve(response({}, 429, {'Retry-After': 'not-a-date'}))
      return Promise.resolve(response(refData('Berakhot 2a')))
    })
    await resolved(api.validateRef('Berakhot 2a'))
    expect(starts).toEqual([START, START + 1_000, START + 2_000])
  })

  it.each([
    ['overflowing integer', '9'.repeat(400)],
    ['unrepresentable HTTP date', 'Sun, 22 Nov 999999999999999999 GMT'],
  ])(
    'refuses an unrepresentable Retry-After without poisoning later calls (%s)',
    async (_label, header) => {
      fetchMock
        .mockImplementationOnce(() =>
          Promise.resolve(response({}, 429, {'Retry-After': header})),
        )
        .mockImplementation(() =>
          Promise.resolve(response(refData('Berakhot 2a'))),
        )
      const error = await rejected(api.validateRef('Berakhot 2a'))
      expect(error).toBeInstanceOf(api.SefariaRateLimitError)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect((await resolved(api.validateRef('Berakhot 2a'))).ref).toBe(
        'Berakhot 2a',
      )
      expect(fetchMock).toHaveBeenCalledTimes(2)
    },
  )

  it.each([429, 503])(
    'ends the owned transport for unread error bodies without aborting the caller (%s)',
    async status => {
      let owned: AbortSignal | undefined
      const caller = new AbortController()
      fetchMock.mockImplementation((_input, init) => {
        owned = init?.signal ?? undefined
        return Promise.resolve(response({}, status, {'Retry-After': '1'}))
      })
      const error = await rejected(api.getText('Genesis 1', caller.signal))
      expect(error).toBeInstanceOf(Error)
      expect(owned).not.toBe(caller.signal)
      expect(owned?.aborted).toBe(true)
      expect(caller.signal.aborted).toBe(false)
      if (status === 429)
        expect(error).toBeInstanceOf(api.SefariaRateLimitError)
      else expect(String(error)).toContain('Sefaria request failed (503)')
    },
  )

  it('does not retry other HTTP failures or invalid refs', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response({}, 500)))
    await rejected(api.validateRef('Berakhot 2a'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({is_ref: false})),
    )
    await rejected(api.validateRef('not a ref'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serializes requests and spaces successful starts by at least one second', async () => {
    const starts: number[] = []
    fetchMock.mockImplementation(() => {
      starts.push(Date.now())
      return Promise.resolve(response({versions: []}))
    })
    await resolved(
      Promise.all([
        api.getText('Genesis 1'),
        api.getText('Genesis 2'),
        api.getText('Genesis 3'),
      ]),
    )
    expect(starts).toEqual([START, START + 1_000, START + 2_000])
  })

  it('bounds an unresponsive fetch and a queued caller within their original deadlines', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    const first = capture(api.getText('Genesis 1'))
    const second = capture(api.getText('Genesis 2'))
    await jest.advanceTimersByTimeAsync(15_000)
    const a = await first
    const b = await second
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    if (a.ok || b.ok) throw new Error('Deadlines did not reject')
    expect(a.error).toBeInstanceOf(api.SefariaTimeoutError)
    expect(b.error).toBeInstanceOf(api.SefariaTimeoutError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('includes a stalled JSON body in the request deadline', async () => {
    const result = response(refData('Berakhot 2a'))
    jest.spyOn(result, 'json').mockImplementation(() => new Promise(() => {}))
    fetchMock.mockResolvedValue(result)
    expect(await rejected(api.validateRef('Berakhot 2a'))).toBeInstanceOf(
      api.SefariaTimeoutError,
    )
    expect(Date.now()).toBe(START + 15_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves an opaque caller abort reason while queued and never starts its request', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    const activeController = new AbortController()
    const queuedController = new AbortController()
    const first = capture(api.getText('Genesis 1', activeController.signal))
    const second = capture(api.getText('Genesis 2', queuedController.signal))
    await jest.advanceTimersByTimeAsync(100)
    const reason = {kind: 'caller-cancelled'}
    queuedController.abort(reason)
    const result = await second
    if (result.ok) throw new Error('Cancelled queue entry resolved')
    expect(result.error).toBe(reason)
    activeController.abort('finish active test')
    await first
    await jest.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels backoff immediately with the original reason and no later retry', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({}, 429, {'Retry-After': '5'})),
    )
    const controller = new AbortController()
    const pending = capture(api.validateRef('Berakhot 2a', controller.signal))
    await jest.advanceTimersByTimeAsync(100)
    const reason = new Error('caller abandoned this query')
    controller.abort(reason)
    const result = await pending
    if (result.ok) throw new Error('Cancelled backoff resolved')
    expect(result.error).toBe(reason)
    await jest.advanceTimersByTimeAsync(6_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not let one caller cancel another caller for the same uncached ref', async () => {
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockImplementation(() =>
        Promise.resolve(response(refData('Berakhot 2a'))),
      )
    const a = new AbortController()
    const b = new AbortController()
    const first = capture(api.validateRef('Berakhot 2a', a.signal))
    const second = api.validateRef('Berakhot 2a', b.signal)
    await jest.advanceTimersByTimeAsync(100)
    a.abort('first caller only')
    const firstResult = await first
    if (firstResult.ok) throw new Error('First caller unexpectedly resolved')
    expect(firstResult.error).toBe('first caller only')
    expect((await resolved(second)).ref).toBe('Berakhot 2a')
    expect(b.signal.aborted).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cancels during JSON-body reading without caching a late response', async () => {
    let finish: ((value: unknown) => void) | undefined
    const body = response({})
    jest.spyOn(body, 'json').mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    fetchMock
      .mockResolvedValueOnce(body)
      .mockImplementation(() =>
        Promise.resolve(response(refData('Berakhot 2a'))),
      )
    const controller = new AbortController()
    const pending = capture(api.validateRef('Berakhot 2a', controller.signal))
    await jest.advanceTimersByTimeAsync(10)
    const reason = {cancel: 'body'}
    controller.abort(reason)
    const result = await pending
    if (result.ok) throw new Error('Cancelled body resolved')
    expect(result.error).toBe(reason)
    if (!finish) throw new Error('JSON body was not entered')
    finish(refData('Berakhot 2a'))
    expect((await resolved(api.validateRef('Berakhot 2a'))).ref).toBe(
      'Berakhot 2a',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reuses only successful refs through their actual canonical alias and returns copies', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response(refData('Berakhot 2a'))),
    )
    const first = await resolved(api.validateRef('ברכות ב ע״א'))
    first.ref = 'caller mutation'
    first.addressTypes?.push('caller mutation')
    const second = await resolved(api.validateRef('Berakhot 2a'))
    expect(second.ref).toBe('Berakhot 2a')
    expect(second.addressTypes).toEqual(['Talmud', 'Integer'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('expires successful cache entries after five minutes', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response(refData('Berakhot 2a'))),
    )
    await resolved(api.validateRef('Berakhot 2a'))
    await jest.advanceTimersByTimeAsync(299_999)
    await resolved(api.validateRef('Berakhot 2a'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    await resolved(api.validateRef('Berakhot 2a'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bounds positive cache keys and evicts the oldest entry', async () => {
    fetchMock.mockImplementation(input =>
      Promise.resolve(
        response(
          refData(
            decodeURIComponent(requestUrl(input).split('/').pop() ?? ''),
            ['Integer'],
          ),
        ),
      ),
    )
    for (let n = 1; n <= 129; n++) await resolved(api.validateRef('Test ' + n))
    expect(fetchMock).toHaveBeenCalledTimes(129)
    await resolved(api.validateRef('Test 1'))
    expect(fetchMock).toHaveBeenCalledTimes(130)
  })

  it('rejects an already-aborted caller even when the positive ref is cached', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response(refData('Berakhot 2a'))),
    )
    await resolved(api.validateRef('Berakhot 2a'))
    const controller = new AbortController()
    const reason = {aborted: 'before cache lookup'}
    controller.abort(reason)
    expect(
      await rejected(api.validateRef('Berakhot 2a', controller.signal)),
    ).toBe(reason)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not generate a/b requests for a documented non-Talmud address', async () => {
    const refs: string[] = []
    fetchMock.mockImplementation(input => {
      const url = requestUrl(input)
      if (url.includes('/api/name/'))
        return Promise.resolve(response({completion_objects: []}))
      refs.push(decodeURIComponent(url.split('/').pop() ?? ''))
      return Promise.resolve(
        response(refData('Genesis 1', ['Integer', 'Integer'])),
      )
    })
    expect(
      (await resolved(api.searchTorahSources('Genesis 1'))).map(
        item => item.key,
      ),
    ).toEqual(['Genesis 1'])
    expect(refs).toEqual(['Genesis 1'])
  })

  it('still validates Talmud children and skips a nonexistent final half-page', async () => {
    const refs: string[] = []
    fetchMock.mockImplementation(input => {
      const url = requestUrl(input)
      if (url.includes('/api/name/'))
        return Promise.resolve(response({completion_objects: []}))
      const ref = decodeURIComponent(url.split('/').pop() ?? '')
      refs.push(ref)
      return Promise.resolve(
        ref.endsWith('b') ? response({is_ref: false}) : response(refData(ref)),
      )
    })
    expect(
      (await resolved(api.searchTorahSources('Berakhot 64'))).map(
        item => item.key,
      ),
    ).toEqual(['Berakhot 64', 'Berakhot 64a'])
    expect(refs).toEqual(['Berakhot 64', 'Berakhot 64a', 'Berakhot 64b'])
  })

  it('does not turn an exhausted child429 into an incomplete successful search', async () => {
    fetchMock.mockImplementation(input => {
      const url = requestUrl(input)
      if (url.includes('/api/name/'))
        return Promise.resolve(response({completion_objects: []}))
      const ref = decodeURIComponent(url.split('/').pop() ?? '')
      return Promise.resolve(
        ref.endsWith('a')
          ? response({}, 429, {'Retry-After': '1'})
          : response(refData(ref)),
      )
    })
    expect(await rejected(api.searchTorahSources('Berakhot 2'))).toBeInstanceOf(
      api.SefariaRateLimitError,
    )
  })

  it('does not turn a primary timeout into empty successful search results', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    expect(await rejected(api.searchTorahSources('Berakhot 2'))).toBeInstanceOf(
      api.SefariaTimeoutError,
    )
  })

  it('preserves caller cancellation during child validation across allSettled', async () => {
    fetchMock.mockImplementation(input => {
      const url = requestUrl(input)
      if (url.includes('/api/name/'))
        return Promise.resolve(response({completion_objects: []}))
      const ref = decodeURIComponent(url.split('/').pop() ?? '')
      if (ref.endsWith('a'))
        return Promise.resolve(new Promise<Response>(() => {}))
      return Promise.resolve(response(refData(ref)))
    })
    const controller = new AbortController()
    const pending = capture(
      api.searchTorahSources('Berakhot 2', controller.signal),
    )
    await jest.advanceTimersByTimeAsync(2_100)
    const reason = {cancel: 'child validation'}
    controller.abort(reason)
    const result = await pending
    if (result.ok) throw new Error('Cancelled child search resolved')
    expect(result.error).toBe(reason)
    await jest.runAllTimersAsync()
  })

  it('preserves caller abort during optional preview text instead of returning attachable metadata', async () => {
    fetchMock.mockImplementation(input =>
      Promise.resolve(
        requestUrl(input).includes('/api/ref/')
          ? response(refData('Berakhot 2a'))
          : new Promise<Response>(() => {}),
      ),
    )
    const controller = new AbortController()
    const pending = capture(
      api.resolveTorahSource('Berakhot 2a', controller.signal),
    )
    await jest.advanceTimersByTimeAsync(1_100)
    const reason = {cancel: 'preview'}
    controller.abort(reason)
    const result = await pending
    if (result.ok) throw new Error('Cancelled preview resolved')
    expect(result.error).toBe(reason)
  })

  it('propagates429 from optional preview and manuscripts, without swallowing it', async () => {
    fetchMock.mockImplementation(input =>
      Promise.resolve(
        requestUrl(input).includes('/api/ref/')
          ? response(refData('Berakhot 2a'))
          : response({}, 429, {'Retry-After': '1'}),
      ),
    )
    expect(
      await rejected(api.resolveTorahSource('Berakhot 2a')),
    ).toBeInstanceOf(api.SefariaRateLimitError)
    expect(await rejected(api.getManuscripts('Berakhot 2a'))).toBeInstanceOf(
      api.SefariaRateLimitError,
    )
  })

  it('retains intended optional-text and manuscript fallback for ordinary server errors', async () => {
    fetchMock.mockImplementation(input =>
      Promise.resolve(
        requestUrl(input).includes('/api/ref/')
          ? response(refData('Berakhot 2a'))
          : response({}, 500),
      ),
    )
    const source = await resolved(api.resolveTorahSource('Berakhot 2a'))
    expect(source.ref).toBe('Berakhot 2a')
    expect(source.preview).toBeUndefined()
    expect(await resolved(api.getManuscripts('Berakhot 2a'))).toEqual([])
  })
})
