import {AppState, type AppStateStatus} from 'react-native'
import {act, cleanup, render} from '@testing-library/react-native'

import {MessagesEventBusProviderInner} from '#/state/messages/events'

let mockIsWeb = true
const mockChatClient = {}
const mockBus = {
  updateClient: jest.fn(),
  resume: jest.fn(),
  suspend: jest.fn(),
  background: jest.fn(),
}
const mockRemoveAppStateListener = jest.fn()
const pageListeners = new Map<string, Set<() => void>>()
const mockPage = {
  addEventListener: jest.fn((name: string, handler: () => void) => {
    const handlers = pageListeners.get(name) ?? new Set<() => void>()
    handlers.add(handler)
    pageListeners.set(name, handlers)
  }),
  removeEventListener: jest.fn((name: string, handler: () => void) => {
    pageListeners.get(name)?.delete(handler)
  }),
}

jest.mock('#/env', () => ({
  get IS_WEB() {
    return mockIsWeb
  },
}))
jest.mock('#/state/session', () => ({
  useChatClient: () => mockChatClient,
}))
jest.mock('#/state/messages/events/agent', () => ({
  MessagesEventBus: jest.fn().mockImplementation(() => mockBus),
}))

let originalWindow: PropertyDescriptor | undefined
let originalAppState: AppStateStatus
let onAppStateChange: (state: AppStateStatus) => void

beforeEach(() => {
  jest.clearAllMocks()
  mockIsWeb = true
  pageListeners.clear()
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: mockPage,
  })
  originalAppState = AppState.currentState
  AppState.currentState = 'active'
  onAppStateChange = () => {
    throw new Error('AppState subscription is missing')
  }
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
    onAppStateChange = handler
    return {remove: mockRemoveAppStateListener}
  })
})

afterEach(() => {
  cleanup()
  AppState.currentState = originalAppState
  jest.restoreAllMocks()
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

function mountProvider() {
  const result = render(
    <MessagesEventBusProviderInner>{null}</MessagesEventBusProviderInner>,
  )
  mockBus.resume.mockClear()
  mockBus.suspend.mockClear()
  mockBus.background.mockClear()
  return result
}

function changeAppState(state: AppStateStatus) {
  act(() => {
    AppState.currentState = state
    onAppStateChange(state)
  })
}

function dispatchPageEvent(name: string) {
  act(() => {
    for (const handler of pageListeners.get(name) ?? []) handler()
  })
}

describe('chat event bus page lifecycle', () => {
  it('preserves ordinary tab background and foreground refreshes', () => {
    mountProvider()

    changeAppState('background')
    changeAppState('active')

    expect(mockBus.background).toHaveBeenCalledTimes(1)
    expect(mockBus.resume).toHaveBeenCalledTimes(1)
    expect(mockBus.suspend).not.toHaveBeenCalled()
  })

  it('suspends on pagehide before the unload visibility change can start a poll', () => {
    mountProvider()

    dispatchPageEvent('pagehide')
    changeAppState('background')
    changeAppState('active')

    expect(mockBus.suspend).toHaveBeenCalledTimes(1)
    expect(mockBus.background).not.toHaveBeenCalled()
    expect(mockBus.resume).not.toHaveBeenCalled()
  })

  it('resumes a restored visible page and handles subsequent tab changes', () => {
    mountProvider()

    dispatchPageEvent('pageshow')
    expect(mockBus.resume).not.toHaveBeenCalled()

    dispatchPageEvent('pagehide')
    changeAppState('background')
    AppState.currentState = 'active'
    dispatchPageEvent('pageshow')

    expect(mockBus.resume).toHaveBeenCalledTimes(1)
    changeAppState('background')
    expect(mockBus.background).toHaveBeenCalledTimes(1)
  })

  it('reconciles a restored page that is still in the background', () => {
    mountProvider()

    dispatchPageEvent('pagehide')
    changeAppState('background')
    dispatchPageEvent('pageshow')

    expect(mockBus.background).toHaveBeenCalledTimes(1)
    expect(mockBus.resume).not.toHaveBeenCalled()
    changeAppState('active')
    expect(mockBus.resume).toHaveBeenCalledTimes(1)
  })

  it('removes the AppState and page listeners on unmount', () => {
    const result = mountProvider()
    result.unmount()

    expect(mockRemoveAppStateListener).toHaveBeenCalledTimes(1)
    expect(mockPage.removeEventListener).toHaveBeenCalledTimes(2)
    expect(pageListeners.get('pagehide')?.size).toBe(0)
    expect(pageListeners.get('pageshow')?.size).toBe(0)
  })

  it('keeps native AppState transitions without installing browser listeners', () => {
    mockIsWeb = false
    mountProvider()

    expect(mockPage.addEventListener).not.toHaveBeenCalled()
    dispatchPageEvent('pagehide')
    changeAppState('background')
    changeAppState('active')

    expect(mockBus.background).toHaveBeenCalledTimes(1)
    expect(mockBus.resume).toHaveBeenCalledTimes(1)
    expect(mockBus.suspend).not.toHaveBeenCalled()
  })
})
