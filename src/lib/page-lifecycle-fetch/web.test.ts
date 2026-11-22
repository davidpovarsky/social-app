import {isRequestAborted} from '#/lib/request-cancellation'
import {createPageLifecycleFetch} from './web'

const url = 'https://appview.torah.test/xrpc/app.bsky.actor.getProfile'

function pendingFetch(): jest.MockedFunction<typeof fetch> {
  return jest.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(signal.reason)
        } else {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
        }
      }),
  )
}

describe('document-owned fetch', () => {
  it('aborts pending requests on pagehide and never calls fetch while hidden', async () => {
    const page = new EventTarget()
    const fetchImpl = pendingFetch()
    const transport = createPageLifecycleFetch(page, fetchImpl)
    const pending = transport.fetch(url)
    const result = expect(pending).rejects.toMatchObject({name: 'AbortError'})
    const signal = fetchImpl.mock.calls[0][1]?.signal
    expect(signal).toBe(transport.getSignal())

    page.dispatchEvent(new Event('pagehide'))
    expect(signal?.aborted).toBe(true)
    await result
    await expect(transport.fetch(url)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    transport.dispose()
  })

  it('creates a fresh signal only after pageshow restores a hidden page', async () => {
    const page = new EventTarget()
    const response = {ok: true} as Response
    const fetchImpl = jest.fn(() => Promise.resolve(response))
    const transport = createPageLifecycleFetch(page, fetchImpl)
    const first = transport.getSignal()
    page.dispatchEvent(new Event('pageshow'))
    expect(transport.getSignal()).toBe(first)
    page.dispatchEvent(new Event('pagehide'))
    page.dispatchEvent(new Event('pageshow'))
    expect(first.aborted).toBe(true)
    expect(transport.getSignal()).not.toBe(first)
    expect(transport.getSignal().aborted).toBe(false)
    await expect(transport.fetch(url)).resolves.toBe(response)
    transport.dispose()
  })

  it('does not cancel or block requests when a tab becomes hidden or blurred', async () => {
    const page = new EventTarget()
    const fetchImpl = pendingFetch()
    const transport = createPageLifecycleFetch(page, fetchImpl)
    const pending = transport.fetch(url)
    const result = expect(pending).rejects.toMatchObject({name: 'AbortError'})
    page.dispatchEvent(new Event('visibilitychange'))
    page.dispatchEvent(new Event('blur'))
    expect(transport.getSignal().aborted).toBe(false)
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(false)
    transport.dispose()
    await result
  })

  it.each(['caller', 'page'] as const)(
    'keeps response bodies connected to %s cancellation after headers',
    async source => {
      const page = new EventTarget()
      const caller = new AbortController()
      const reason = new Error('Caller stopped reading')
      let requestSignal: AbortSignal | null | undefined
      const response = {
        json: () =>
          new Promise((_resolve, reject) => {
            requestSignal?.addEventListener(
              'abort',
              () => reject(requestSignal?.reason),
              {once: true},
            )
          }),
      } as Response
      const fetchImpl = jest.fn(
        (_input: RequestInfo | URL, init?: RequestInit) => {
          requestSignal = init?.signal
          return Promise.resolve(response)
        },
      )
      const transport = createPageLifecycleFetch(page, fetchImpl)
      const received = await transport.fetch(url, {signal: caller.signal})
      expect(received).toBe(response)
      const body = received.json()
      const result = expect(body).rejects.toMatchObject({
        name: source === 'caller' ? 'Error' : 'AbortError',
      })
      if (source === 'caller') caller.abort(reason)
      else page.dispatchEvent(new Event('pagehide'))
      await result
      expect(requestSignal?.aborted).toBe(true)
      if (source === 'caller') {
        expect(requestSignal?.reason).toBe(reason)
        expect(isRequestAborted(reason)).toBe(true)
      }
      transport.dispose()
    },
  )

  it('honors a Request signal and explicit RequestInit signal overrides', async () => {
    const page = new EventTarget()
    const inherited = new AbortController()
    const replacement = new AbortController()
    const request = new Request(url, {signal: inherited.signal})
    const fetchImpl = pendingFetch()
    const transport = createPageLifecycleFetch(page, fetchImpl)
    const first = transport.fetch(request)
    const second = transport.fetch(request, {signal: replacement.signal})
    const third = transport.fetch(request, {signal: null})
    const results = [first, second, third].map(promise =>
      expect(promise).rejects.toMatchObject({name: 'AbortError'}),
    )
    inherited.abort()
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(fetchImpl.mock.calls[1][1]?.signal?.aborted).toBe(false)
    expect(fetchImpl.mock.calls[2][1]?.signal?.aborted).toBe(false)
    replacement.abort()
    expect(fetchImpl.mock.calls[1][1]?.signal?.aborted).toBe(true)
    page.dispatchEvent(new Event('pagehide'))
    await Promise.all(results)
    transport.dispose()
  })

  it('preserves keepalive and caller cancellation, including Request inheritance', async () => {
    const page = new EventTarget()
    const caller = new AbortController()
    const request = new Request(url, {
      keepalive: true,
      signal: caller.signal,
    })
    const fetchImpl = jest.fn(() => Promise.resolve({} as Response))
    const transport = createPageLifecycleFetch(page, fetchImpl)
    page.dispatchEvent(new Event('pagehide'))
    await transport.fetch(request)
    expect(fetchImpl).toHaveBeenLastCalledWith(request, undefined)
    const init = {keepalive: true, signal: caller.signal}
    await transport.fetch(url, init)
    expect(fetchImpl).toHaveBeenLastCalledWith(url, init)
    await expect(
      transport.fetch(request, {keepalive: false}),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    transport.dispose()
  })

  it('forwards an already aborted caller signal and removes parent listeners on abort', async () => {
    const page = new EventTarget()
    const caller = new AbortController()
    const fetchImpl = pendingFetch()
    const transport = createPageLifecycleFetch(page, fetchImpl)
    const removePage = jest.spyOn(transport.getSignal(), 'removeEventListener')
    const removeCaller = jest.spyOn(caller.signal, 'removeEventListener')
    const reason = new Error('Caller cancellation')
    const pending = transport.fetch(url, {signal: caller.signal})
    const result = expect(pending).rejects.toBe(reason)
    caller.abort(reason)
    await result
    expect(removePage).toHaveBeenCalledWith('abort', expect.anything())
    expect(removeCaller).toHaveBeenCalledWith('abort', expect.anything())
    await expect(transport.fetch(url, {signal: caller.signal})).rejects.toBe(
      reason,
    )
    expect(fetchImpl.mock.calls[1][1]?.signal).toBe(caller.signal)
    transport.dispose()
  })
})
