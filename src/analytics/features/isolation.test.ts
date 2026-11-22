import {type FeatureApiResponse} from '@growthbook/growthbook'

let mockIsolated = true
const mockReadBootstrap = jest.fn()
const mockReadCache = jest.fn()
jest.mock('#/env', () => ({
  get TORAH_ISOLATED_NETWORK() {
    return mockIsolated
  },
  GROWTHBOOK_API_HOST: 'https://rollouts.example',
  GROWTHBOOK_CLIENT_KEY: 'sdk-test',
  IS_INTERNAL: false,
}))
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString(key: string) {
      return mockReadCache(key)
    }
    set = jest.fn()
  },
}))
jest.mock('#/logger', () => ({
  Logger: {
    Context: {Growthbook: 'growthbook'},
    create: () => ({info: jest.fn(), warn: jest.fn()}),
  },
}))
jest.mock('#/analytics/features/bootstrap', () => ({
  readFeatureBootstrap: (...args: unknown[]) => mockReadBootstrap(...args),
}))
jest.mock('#/analytics/metadata', () => ({
  getNavigationMetadata: () => undefined,
}))

const fetchMock = jest.fn()
const payload: FeatureApiResponse = {
  dateUpdated: '2026-11-22T00:00:00Z',
  features: {'following_v2:enable': {defaultValue: true}},
}

function loadFeatures() {
  const sdk = jest.requireActual<typeof import('@growthbook/growthbook')>(
    '@growthbook/growthbook',
  )
  sdk.setPolyfills({
    fetch: fetchMock,
    EventSource: undefined,
  })
  return jest.requireActual<typeof import('./index')>('./index')
}

beforeEach(() => {
  jest.resetModules()
  mockIsolated = true
  mockReadBootstrap.mockReset().mockReturnValue(payload)
  mockReadCache.mockReset().mockReturnValue(undefined)
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    headers: {get: () => null},
    json: () => Promise.resolve(payload),
  })
})

it('uses local capabilities without initializing, refreshing, or restoring public rollouts', async () => {
  const featureModule = loadFeatures()
  try {
    await featureModule.init
    await featureModule.refresh({strategy: 'prefer-low-latency'})
    await featureModule.refresh({strategy: 'prefer-fresh-gates'})
    await featureModule.features.setAttributes({did: 'did:plc:local-user'})

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockReadBootstrap).not.toHaveBeenCalled()
    expect(mockReadCache).not.toHaveBeenCalled()
    expect(
      featureModule.features.isOn(featureModule.Features.FollowingV2Enable),
    ).toBe(false)
    expect(
      featureModule.features.isOn(featureModule.Features.GroupChatsDisable),
    ).toBe(true)
    expect(
      featureModule.features.isOn(
        featureModule.Features.ImportContactsOnboardingDisable,
      ),
    ).toBe(true)
    expect(
      featureModule.features.isOn(featureModule.Features.LiveNowBetaDisable),
    ).toBe(true)
  } finally {
    featureModule.features.destroy()
  }
})

it('retains remote initialization and refresh for public deployments', async () => {
  mockIsolated = false
  mockReadBootstrap.mockReturnValue(undefined)
  const featureModule = loadFeatures()
  try {
    await featureModule.init
    await featureModule.refresh({strategy: 'prefer-fresh-gates'})

    expect(mockReadBootstrap).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rollouts.example/api/features/sdk-test',
      expect.anything(),
    )
    expect(
      featureModule.features.isOn(featureModule.Features.FollowingV2Enable),
    ).toBe(true)
  } finally {
    featureModule.features.destroy()
  }
})
