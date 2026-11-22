import {type ReactNode} from 'react'
import {Text} from 'react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react-native'

import {MessagesProvider} from '#/state/messages'
import {useGetConvoAvailabilityQuery} from '#/state/queries/messages/get-convo-availability'
import {useChatActorStatusQuery} from '#/state/queries/messages/get-status'
import {useUnreadCountsQuery} from '#/state/queries/messages/get-unread-counts'
import {ChatAvailability} from '#/components/dms/ChatAvailability'

let mockChatEnabled = false
let mockHasSession = true
const mockChatCall = jest.fn()
const mockBusMount = jest.fn()
const mockListMount = jest.fn()
const mockUnavailableMount = jest.fn()

jest.mock('#/env', () => ({
  get CHAT_ENABLED() {
    return mockChatEnabled
  },
}))
jest.mock('#/state/session', () => ({
  useChatClient: () => ({call: mockChatCall}),
  useSession: () => ({hasSession: mockHasSession}),
}))
jest.mock('#/ageAssurance', () => ({
  useAgeAssurance: () => ({flags: {groupChatDisabled: false}}),
}))
jest.mock('#/state/queries', () => ({
  STALE: {SECONDS: {FIFTEEN: 15000}, INFINITY: Infinity},
}))
jest.mock('#/state/queries/util', () => ({
  createQueryKey: (name: string) => [name],
}))
jest.mock('#/lexicons', () => ({
  chat: {
    bsky: {
      actor: {getStatus: 'chat.bsky.actor.getStatus'},
      convo: {
        getUnreadCounts: 'chat.bsky.convo.getUnreadCounts',
        getConvoAvailability: 'chat.bsky.convo.getConvoAvailability',
      },
    },
  },
}))
jest.mock('#/state/messages/events', () => ({
  MessagesEventBusProvider: ({children}: {children: ReactNode}) => {
    mockBusMount()
    return children
  },
}))
jest.mock('#/state/queries/messages/list-conversations', () => ({
  ListConvosProvider: ({children}: {children: ReactNode}) => {
    mockListMount()
    return children
  },
}))
jest.mock('#/components/dms/ChatUnavailable', () => ({
  ChatUnavailableScreen: () => {
    mockUnavailableMount()
    return null
  },
}))

let queryClient: QueryClient

function Wrapper({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  mockChatEnabled = false
  mockHasSession = true
  jest.clearAllMocks()
  mockChatCall.mockResolvedValue({
    unreadAcceptedConvos: 2,
    unreadRequestConvos: 1,
    canChat: true,
    chatDisabled: false,
  })
  queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false, gcTime: Infinity}},
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

describe('chat capability boundaries', () => {
  it('keeps the app mounted without starting the event bus or its dependent list provider', () => {
    const result = render(
      <MessagesProvider>
        <Text>App content</Text>
      </MessagesProvider>,
    )
    expect(result.getByText('App content')).toBeTruthy()
    expect(mockBusMount).not.toHaveBeenCalled()
    expect(mockListMount).not.toHaveBeenCalled()
  })

  it('preserves both providers for a configured chat service', () => {
    mockChatEnabled = true
    const result = render(
      <MessagesProvider>
        <Text>App content</Text>
      </MessagesProvider>,
    )
    expect(result.getByText('App content')).toBeTruthy()
    expect(mockBusMount).toHaveBeenCalled()
    expect(mockListMount).toHaveBeenCalled()
  })

  it('does not mount conversation actors behind an unavailable route', () => {
    const mountConversation = jest.fn()
    function Conversation() {
      mountConversation()
      return <Text>Conversation</Text>
    }
    const result = render(
      <ChatAvailability>
        <Conversation />
      </ChatAvailability>,
    )
    expect(mockUnavailableMount).toHaveBeenCalled()
    expect(mountConversation).not.toHaveBeenCalled()

    mockChatEnabled = true
    result.rerender(
      <ChatAvailability>
        <Conversation />
      </ChatAvailability>,
    )
    expect(result.getByText('Conversation')).toBeTruthy()
    expect(mountConversation).toHaveBeenCalled()
  })
})

describe.each([
  ['navigation unread counts', useUnreadCountsQuery],
  ['actor chat status', useChatActorStatusQuery],
  [
    'profile conversation availability',
    () => useGetConvoAvailabilityQuery('did:plc:abcdefghijklmnopqrstuvwx'),
  ],
] as const)('%s', (_name, useChatQuery) => {
  it('does not request unavailable chat endpoints, then resumes when configured', async () => {
    const result = renderHook(() => useChatQuery(), {wrapper: Wrapper})
    await act(async () => {})
    expect(result.result.current.fetchStatus).toBe('idle')
    expect(mockChatCall).not.toHaveBeenCalled()

    mockChatEnabled = true
    result.rerender({})
    await waitFor(() => expect(result.result.current.isSuccess).toBe(true))
    expect(mockChatCall).toHaveBeenCalledTimes(1)
  })

  it('still requires an authenticated session when chat is configured', async () => {
    mockChatEnabled = true
    mockHasSession = false
    const result = renderHook(() => useChatQuery(), {wrapper: Wrapper})
    await act(async () => {})
    expect(result.result.current.fetchStatus).toBe('idle')
    expect(mockChatCall).not.toHaveBeenCalled()
  })
})

it('respects an explicitly disabled profile availability query', async () => {
  mockChatEnabled = true
  renderHook(
    () =>
      useGetConvoAvailabilityQuery('did:plc:abcdefghijklmnopqrstuvwx', {
        enabled: false,
      }),
    {wrapper: Wrapper},
  )
  await act(async () => {})
  expect(mockChatCall).not.toHaveBeenCalled()
})
