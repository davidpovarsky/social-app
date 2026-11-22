import {checkServiceHealth} from './network-health'

const service = 'https://appview.torah.test'

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

it('uses the configured AppView and releases the timeout after success', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({version: '1'}),
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
    json: async () => ({version: '1'}),
  } as Response)
  await expect(checkServiceHealth(service)).resolves.toBe(false)
  expect(jest.getTimerCount()).toBe(0)
})

it('rejects malformed health responses without retaining a timer', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({}),
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
    json: async () => ({version: 'recovered'}),
  } as Response)
  await expect(checkServiceHealth(service)).resolves.toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})
