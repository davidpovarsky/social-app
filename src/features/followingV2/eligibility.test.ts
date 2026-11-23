import {type AnalyticsContextType} from '#/analytics'
import {Features} from '#/analytics/features/types'
import {
  isFollowingV2Eligible,
  isFollowingV2HomeDotEnabled,
  isFollowingV2HomeForkEnabled,
} from './eligibility'

let mockIsolated = true
let mockNative = true
let mockE2E = false
jest.mock('#/env', () => ({
  get TORAH_ISOLATED_NETWORK() {
    return mockIsolated
  },
  get IS_NATIVE() {
    return mockNative
  },
  get IS_E2E() {
    return mockE2E
  },
}))
const enabled = jest.fn()
const ax = {
  features: {...Features, enabled, getValue: jest.fn()},
} as Pick<AnalyticsContextType, 'features'>

beforeEach(() => {
  mockIsolated = true
  mockNative = true
  mockE2E = false
  enabled.mockReset().mockReturnValue(true)
})

it.each([false, true])(
  'does not enable unsupported Following v2 through public flags or e2e=%s',
  e2e => {
    mockE2E = e2e
    expect(isFollowingV2Eligible(ax)).toBe(false)
    expect(isFollowingV2HomeDotEnabled(ax)).toBe(false)
    expect(isFollowingV2HomeForkEnabled(ax)).toBe(false)
    expect(enabled).not.toHaveBeenCalled()
  },
)

it('preserves native public rollout behavior', () => {
  mockIsolated = false
  expect(isFollowingV2Eligible(ax)).toBe(true)
  expect(isFollowingV2HomeForkEnabled(ax)).toBe(true)
  enabled.mockReturnValue(false)
  expect(isFollowingV2Eligible(ax)).toBe(false)
})

it('preserves the public web fork without native-only behavior', () => {
  mockIsolated = false
  mockNative = false
  expect(isFollowingV2Eligible(ax)).toBe(false)
  expect(isFollowingV2HomeForkEnabled(ax)).toBe(true)
  expect(isFollowingV2HomeDotEnabled(ax)).toBe(true)
})

it('preserves public e2e coverage without a remote rollout', () => {
  mockIsolated = false
  mockE2E = true
  enabled.mockReturnValue(false)
  expect(isFollowingV2Eligible(ax)).toBe(true)
  expect(enabled).not.toHaveBeenCalled()
})
