import {createPageLifecycleFetch} from '#/lib/page-lifecycle-fetch/web'

let mockTransport: ReturnType<typeof createPageLifecycleFetch> | undefined
jest.mock('#/lib/page-lifecycle-fetch', () => ({
  getPageSignal: () => mockTransport?.getSignal(),
  pageLifecycleFetch: (...args: Parameters<typeof fetch>) =>
    mockTransport ? mockTransport.fetch(...args) : globalThis.fetch(...args),
}))

import {checkServiceHealth} from './network-health'

const service = 'https://appview.torah.test'

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  mockTransport?.dispose()
  mockTransport = undefined
  jest.restoreAllMocks()
  jest.useRealTimers()
})

it('cancels a pending response body on pagehide, releases its timer, and recovers after pageshow', async () => {
  const page = new EventTarget()
  let signal: AbortSignal | null | undefined
  let started!: () => void
  const bodyStarted = new Promise<void>(resolve => {
    started = resolve
  })
  const fetchMock = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal
    return Promise.resolve({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal?.reason))
          started()
        }),
    } as Response)
  })
  mockTransport = createPageLifecycleFetch(page, fetchMock)
  const pending = checkServiceHealth(service)
  await bodyStarted
  page.dispatchEvent(new Event('pagehide'))
  await expect(pending).resolves.toBe(false)
  expect(signal?.aborted).toBe(true)
  expect(jest.getTimerCount()).toBe(0)
  await expect(checkServiceHealth(service)).resolves.toBe(false)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
  page.dispatchEvent(new Event('pageshow'))
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({version: 'restored'}),
  } as Response)
  await expect(checkServiceHealth(service)).resolves.toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})

it('uses the configured AppView and releases the timeout after success', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({version: '1'}),
  } as Response)
  await expect(checkServiceHealth(service + '/')).resolves.toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    service + '/xrpc/_health',
    expect.objectContaining({cache: 'no-store'}),
  )
  expect(jest.getTimerCount()).toBe(0)
})

it('does not treat an error page as a healthy AppView', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({version: '1'}),
  } as Response)
  await expect(checkServiceHealth(service)).resolves.toBe(false)
  expect(jest.getTimerCount()).toBe(0)
})

it('rejects malformed health responses without retaining a timer', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response)
  await expect(checkServiceHealth(service)).resolves.toBe(false)
  expect(jest.getTimerCount()).toBe(0)
})

it('aborts a stalled request and allows the next probe to recover', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        )
      }),
  )
  const stalled = checkServiceHealth(service, 100)
  await jest.advanceTimersByTimeAsync(100)
  await expect(stalled).resolves.toBe(false)
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({version: 'recovered'}),
  } as Response)
  await expect(checkServiceHealth(service)).resolves.toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})
