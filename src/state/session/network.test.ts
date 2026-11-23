import {createPageLifecycleFetch} from '#/lib/page-lifecycle-fetch/web'
import {isRequestAborted} from '#/lib/request-cancellation'

let mockTransport: ReturnType<typeof createPageLifecycleFetch>
const mockConfirmed = jest.fn()
const mockLost = jest.fn()

jest.mock('#/lib/page-lifecycle-fetch', () => ({
  getPageSignal: () => mockTransport.getSignal(),
  pageLifecycleFetch: (...args: Parameters<typeof fetch>) =>
    mockTransport.fetch(...args),
}))
jest.mock('#/state/events', () => ({
  emitNetworkConfirmed: () => mockConfirmed(),
  emitNetworkLost: () => mockLost(),
}))

import {networkAwareFetch} from './network'

// The abort fixtures below use Error or DOMException reasons.
const url = 'https://appview.torah.test/xrpc/app.bsky.actor.getProfile'

beforeEach(() => {
  mockConfirmed.mockClear()
  mockLost.mockClear()
})
afterEach(() => {
  mockTransport.dispose()
})

it('confirms resolved HTTP errors but reports genuine transport failures', async () => {
  const response = {status: 500} as Response
  const error = new TypeError('Failed to fetch')
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce(response)
    .mockRejectedValueOnce(error)
  mockTransport = createPageLifecycleFetch(new EventTarget(), fetchImpl)
  await expect(networkAwareFetch(url)).resolves.toBe(response)
  await expect(networkAwareFetch(url)).rejects.toBe(error)
  expect(mockConfirmed).toHaveBeenCalledTimes(1)
  expect(mockLost).toHaveBeenCalledTimes(1)
})

it('cancels navigation work without reporting lost connectivity or confirming stale results', async () => {
  const page = new EventTarget()
  const fetchImpl = jest.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init?.signal?.reason as Error),
        )
      }),
  )
  mockTransport = createPageLifecycleFetch(page, fetchImpl)
  const pending = networkAwareFetch(url)
  const result = expect(pending).rejects.toMatchObject({name: 'AbortError'})
  page.dispatchEvent(new Event('pagehide'))
  page.dispatchEvent(new Event('pageshow'))
  await result
  expect(mockLost).not.toHaveBeenCalled()
  expect(mockConfirmed).not.toHaveBeenCalled()
})

it('preserves an explicit caller abort reason and identifies it through XRPC wrapping', async () => {
  const caller = new AbortController()
  const reason = new TypeError('Failed to fetch')
  const fetchImpl = jest.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init?.signal?.reason as Error),
        )
      }),
  )
  mockTransport = createPageLifecycleFetch(new EventTarget(), fetchImpl)
  const pending = networkAwareFetch(url, {signal: caller.signal})
  const result = expect(pending).rejects.toBe(reason)
  caller.abort(reason)
  await result
  expect(isRequestAborted(new Error('XRPC failed', {cause: reason}))).toBe(true)
  expect(mockLost).not.toHaveBeenCalled()
})

it('does not report a late keepalive response as evidence for the restored page', async () => {
  const page = new EventTarget()
  let resolve!: (value: Response) => void
  const fetchImpl = jest.fn(
    () =>
      new Promise<Response>(done => {
        resolve = done
      }),
  )
  mockTransport = createPageLifecycleFetch(page, fetchImpl)
  const pending = networkAwareFetch(url, {keepalive: true})
  page.dispatchEvent(new Event('pagehide'))
  page.dispatchEvent(new Event('pageshow'))
  resolve({ok: true} as Response)
  await pending
  expect(mockConfirmed).not.toHaveBeenCalled()
  expect(mockLost).not.toHaveBeenCalled()
})
