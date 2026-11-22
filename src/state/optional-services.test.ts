const originalFetch = globalThis.fetch
const mockFetch = jest.fn()
const mockSetQueryData = jest.fn()
const mockDeviceSet = jest.fn()
const mockNetworkRetry = jest.fn()
let mockServiceUrl: string | undefined

jest.mock('#/env', () => ({
  get APP_CONFIG_URL() {
    return mockServiceUrl
  },
  get LIVE_EVENTS_URL() {
    return mockServiceUrl
  },
  get GEOLOCATION_URL() {
    return mockServiceUrl
  },
  IS_DEV: false,
}))
jest.mock('@tanstack/react-query', () => ({
  QueryClient: jest.fn(() => ({setQueryData: mockSetQueryData})),
}))
jest.mock('@bsky/sdk/moderation', () => ({}))
jest.mock('#/lib/appState', () => ({}))
jest.mock('#/lib/hooks/useIsBskyTeam', () => ({}))
jest.mock('#/lib/strings/url-helpers', () => ({}))
jest.mock('#/state/queries/preferences', () => ({}))
jest.mock('#/features/liveEvents/preferences', () => ({}))
jest.mock('#/storage/hooks/dev-mode', () => ({}))
jest.mock('#/storage', () => ({
  device: {get: jest.fn(), set: mockDeviceSet},
}))
jest.mock('#/lib/async/retry', () => ({networkRetry: mockNetworkRetry}))
jest.mock('#/geolocation/debug', () => ({enabled: false}))
jest.mock('#/geolocation/logger', () => ({
  logger: {debug: jest.fn(), info: jest.fn()},
}))

beforeEach(() => {
  jest.resetModules()
  mockFetch.mockReset()
  mockSetQueryData.mockClear()
  mockDeviceSet.mockClear()
  mockNetworkRetry.mockClear()
  mockServiceUrl = undefined
  globalThis.fetch = mockFetch as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe.each(['', undefined])('disabled optional worker base %p', base => {
  it('caches an empty live-status allowlist without fetching /config', async () => {
    mockServiceUrl = base
    const {prefetchAppConfig} = await import('#/state/appConfig')
    await prefetchAppConfig()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockSetQueryData).toHaveBeenCalledWith(['app-config'], {
      liveNow: {allow: [], exceptions: []},
    })
  })

  it('caches an empty live-events list without fetching /config', async () => {
    mockServiceUrl = base
    const {prefetchLiveEvents} = await import('#/features/liveEvents/context')
    await prefetchLiveEvents()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockSetQueryData).toHaveBeenCalledWith(['live-events'], {feeds: []})
  })

  it('resolves with unknown location without requesting or inventing a region', async () => {
    mockServiceUrl = base
    const {resolve} = await import('#/geolocation/service')
    await resolve()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockNetworkRetry).not.toHaveBeenCalled()
    expect(mockDeviceSet).toHaveBeenCalledWith(['geolocationServiceResponse'], {
      countryCode: undefined,
      regionCode: undefined,
      city: undefined,
    })
  })
})

describe('configured optional workers', () => {
  beforeEach(() => {
    mockServiceUrl = 'https://worker.example.test'
  })

  it('preserves the configured app-config endpoint and returned schema', async () => {
    const response = {
      liveNow: {
        allow: ['https://live.example.test'],
        exceptions: [{did: 'did:plc:fixture', allow: []}],
      },
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    })
    const {prefetchAppConfig} = await import('#/state/appConfig')
    await prefetchAppConfig()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://worker.example.test/config')
    expect(mockSetQueryData).toHaveBeenCalledWith(['app-config'], response)
  })

  it('preserves the configured live-event endpoint and feed payload', async () => {
    const layout = {
      title: 'Existing event',
      overlayColor: '#000000',
      textColor: '#ffffff',
      image: 'https://worker.example.test/event.jpg',
      blurhash: '',
    }
    const response = {
      feeds: [
        {
          id: 'fixture-event',
          title: 'Existing event',
          preview: false,
          url: 'https://app.example.test/profile/did:plc:fixture/feed/event',
          layouts: {wide: layout, compact: layout},
        },
      ],
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    })
    const {prefetchLiveEvents} = await import('#/features/liveEvents/context')
    await prefetchLiveEvents()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://worker.example.test/config')
    expect(mockSetQueryData).toHaveBeenCalledWith(['live-events'], response)
  })

  it('preserves actual location returned by a configured service', async () => {
    const response = {countryCode: 'US', regionCode: 'CA', city: 'Oakland'}
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    })
    const {resolve} = await import('#/geolocation/service')
    await resolve()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://worker.example.test/geolocation',
    )
    expect(mockDeviceSet).toHaveBeenCalledWith(
      ['geolocationServiceResponse'],
      response,
    )
  })
})
