import {createPageLifecycleFetch} from '#/lib/page-lifecycle-fetch/web'

let mockTransport: ReturnType<typeof createPageLifecycleFetch> | undefined
let mockOnline = false
let mockLost: () => void
let mockConfirmed: () => void
const mockAppState = {currentState: 'active'}
const mockProbe = jest.fn<Promise<boolean>, []>()
const mockSetOnline = jest.fn((online: boolean) => {
  mockOnline = online
})

jest.mock('react-native', () => ({AppState: mockAppState}))
jest.mock('@tanstack/query-async-storage-persister', () => ({}))
jest.mock('@tanstack/react-query-persist-client', () => ({}))
jest.mock('@tanstack/react-query', () => ({
  QueryClient: jest.fn(),
  focusManager: {setEventListener: jest.fn()},
  onlineManager: {
    isOnline: () => mockOnline,
    setOnline: (value: boolean) => mockSetOnline(value),
  },
}))
jest.mock('#/lib/constants', () => ({
  PUBLIC_BSKY_SERVICE: 'https://torah.test',
}))
jest.mock('#/lib/network-health', () => ({
  checkServiceHealth: () => mockProbe(),
}))
jest.mock('#/lib/page-lifecycle-fetch', () => ({
  getPageSignal: () => mockTransport?.getSignal(),
}))
jest.mock('#/lib/persisted-query-storage', () => ({}))
jest.mock('#/state/queries/util', () => ({}))
jest.mock('#/features/followingV2/home/queries/followingSnapshot', () => ({}))
jest.mock('#/state/events', () => ({
  listenNetworkLost: (listener: () => void) => {
    mockLost = listener
  },
  listenNetworkConfirmed: (listener: () => void) => {
    mockConfirmed = listener
  },
}))
jest.mock('#/env', () => ({IS_NATIVE: false, IS_WEB: true}))

function deferredProbe() {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>(done => {
    resolve = done
  })
  return {promise, resolve}
}

beforeEach(() => {
  jest.useFakeTimers()
  mockOnline = false
  mockAppState.currentState = 'active'
  mockProbe.mockReset()
  mockSetOnline.mockClear()
  jest.isolateModules(() => {
    require('./react-query')
  })
})

afterEach(() => {
  mockTransport?.dispose()
  mockTransport = undefined
  jest.clearAllTimers()
  jest.useRealTimers()
})

it('clears uncertainty after a conflicting check is followed by an unambiguous healthy check', async () => {
  const conflicting = deferredProbe()
  mockProbe.mockReturnValueOnce(conflicting.promise).mockResolvedValueOnce(true)
  await jest.advanceTimersByTimeAsync(2000)
  mockLost()
  conflicting.resolve(true)
  await jest.advanceTimersByTimeAsync(0)
  expect(mockOnline).toBe(false)
  expect(mockProbe).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(2000)
  expect(mockOnline).toBe(true)
  expect(mockProbe).toHaveBeenCalledTimes(2)
  await jest.advanceTimersByTimeAsync(6000)
  expect(mockProbe).toHaveBeenCalledTimes(2)
})

it('does not let an aborted old probe change the restored page or retain its pending lock', async () => {
  const page = new EventTarget()
  mockTransport = createPageLifecycleFetch(page, fetch)
  const old = deferredProbe()
  const fresh = deferredProbe()
  mockProbe.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  await jest.advanceTimersByTimeAsync(2000)
  page.dispatchEvent(new Event('pagehide'))
  await jest.advanceTimersByTimeAsync(4000)
  expect(mockProbe).toHaveBeenCalledTimes(1)
  page.dispatchEvent(new Event('pageshow'))
  await jest.advanceTimersByTimeAsync(2000)
  expect(mockProbe).toHaveBeenCalledTimes(2)
  fresh.resolve(true)
  await jest.advanceTimersByTimeAsync(0)
  expect(mockOnline).toBe(true)
  old.resolve(false)
  await jest.advanceTimersByTimeAsync(0)
  expect(mockSetOnline.mock.calls).toEqual([[true]])
  await jest.advanceTimersByTimeAsync(4000)
  expect(mockProbe).toHaveBeenCalledTimes(2)
})

it('does not apply a result while the document remains hidden', async () => {
  const page = new EventTarget()
  mockTransport = createPageLifecycleFetch(page, fetch)
  const old = deferredProbe()
  mockProbe.mockReturnValueOnce(old.promise)
  await jest.advanceTimersByTimeAsync(2000)
  page.dispatchEvent(new Event('pagehide'))
  old.resolve(false)
  await jest.advanceTimersByTimeAsync(4000)
  expect(mockSetOnline).not.toHaveBeenCalled()
  expect(mockProbe).toHaveBeenCalledTimes(1)
})

it('retains active-app gating and normal recovery when there is no document lifecycle', async () => {
  mockAppState.currentState = 'background'
  mockProbe.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await jest.advanceTimersByTimeAsync(2000)
  expect(mockProbe).not.toHaveBeenCalled()
  mockAppState.currentState = 'active'
  await jest.advanceTimersByTimeAsync(2000)
  expect(mockOnline).toBe(false)
  await jest.advanceTimersByTimeAsync(2000)
  expect(mockOnline).toBe(true)
  await jest.advanceTimersByTimeAsync(4000)
  expect(mockProbe).toHaveBeenCalledTimes(2)
})

it('keeps newer confirmed connectivity when an overlapping probe reports failure', async () => {
  const conflicting = deferredProbe()
  mockProbe.mockReturnValueOnce(conflicting.promise).mockResolvedValueOnce(true)
  await jest.advanceTimersByTimeAsync(2000)
  mockConfirmed()
  conflicting.resolve(false)
  await jest.advanceTimersByTimeAsync(0)
  expect(mockOnline).toBe(true)
  expect(mockSetOnline.mock.calls).toEqual([[true]])
  await jest.advanceTimersByTimeAsync(2000)
  expect(mockProbe).toHaveBeenCalledTimes(2)
  await jest.advanceTimersByTimeAsync(4000)
  expect(mockProbe).toHaveBeenCalledTimes(2)
})
