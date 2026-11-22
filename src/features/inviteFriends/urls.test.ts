import {afterEach, beforeEach, describe, expect, it} from '@jest/globals'

import {getInviteDisplayUrl, getInviteShareUrl} from './urls'

describe.each([
  {
    name: 'public Bluesky',
    isolated: false,
    webHost: undefined,
    origin: 'https://bsky.app',
  },
  {
    name: 'configured Torah network',
    isolated: true,
    webHost: 'https://torah.example',
    origin: 'https://torah.example',
  },
  {
    name: 'Torah default website',
    isolated: true,
    webHost: undefined,
    origin: 'https://torah-130-110-238-163.nip.io',
  },
])('invite URLs: $name', ({isolated, webHost, origin}) => {
  const originalIsolated = process.env.EXPO_PUBLIC_TORAH_ISOLATED_NETWORK
  const originalWebHost = process.env.EXPO_PUBLIC_TORAH_WEB_HOST
  const displayOrigin = origin.replace(/^https:\/\//, '')

  beforeEach(() => {
    process.env.EXPO_PUBLIC_TORAH_ISOLATED_NETWORK = String(isolated)
    if (webHost === undefined) delete process.env.EXPO_PUBLIC_TORAH_WEB_HOST
    else process.env.EXPO_PUBLIC_TORAH_WEB_HOST = webHost
  })

  afterEach(() => {
    if (originalIsolated === undefined)
      delete process.env.EXPO_PUBLIC_TORAH_ISOLATED_NETWORK
    else process.env.EXPO_PUBLIC_TORAH_ISOLATED_NETWORK = originalIsolated
    if (originalWebHost === undefined)
      delete process.env.EXPO_PUBLIC_TORAH_WEB_HOST
    else process.env.EXPO_PUBLIC_TORAH_WEB_HOST = originalWebHost
  })
  describe('getInviteShareUrl', () => {
    it('returns the canonical profile URL for a handle', () => {
      expect(getInviteShareUrl('alice.bsky.social')).toBe(
        `${origin}/profile/alice.bsky.social`,
      )
    })

    it('preserves custom domains', () => {
      expect(getInviteShareUrl('thepope.dev')).toBe(
        `${origin}/profile/thepope.dev`,
      )
    })

    it('strips a leading @ if present', () => {
      expect(getInviteShareUrl('@alice.bsky.social')).toBe(
        `${origin}/profile/alice.bsky.social`,
      )
    })

    it('passes the handle through verbatim (handles are API-normalized, like makeProfileLink)', () => {
      expect(getInviteShareUrl('Alice.Bsky.Social')).toBe(
        `${origin}/profile/Alice.Bsky.Social`,
      )
    })

    it('returns empty string for empty handle (EDGE-001)', () => {
      expect(getInviteShareUrl('')).toBe('')
      expect(getInviteShareUrl('@')).toBe('')
    })
  })

  describe('getInviteDisplayUrl', () => {
    it('returns the scheme-stripped canonical profile URL', () => {
      expect(getInviteDisplayUrl('danielle.bsky.team')).toBe(
        `${displayOrigin}/profile/danielle.bsky.team`,
      )
    })

    it('uses the bare handle when there is no dot', () => {
      expect(getInviteDisplayUrl('alice')).toBe(
        `${displayOrigin}/profile/alice`,
      )
    })

    it('passes the handle through verbatim (handles are API-normalized, like makeProfileLink)', () => {
      expect(getInviteDisplayUrl('Danielle.bsky.team')).toBe(
        `${displayOrigin}/profile/Danielle.bsky.team`,
      )
    })

    it('strips a leading @ if present', () => {
      expect(getInviteDisplayUrl('@alice.bsky.social')).toBe(
        `${displayOrigin}/profile/alice.bsky.social`,
      )
    })

    it('returns empty string for empty handle (EDGE-001)', () => {
      expect(getInviteDisplayUrl('')).toBe('')
      expect(getInviteDisplayUrl('@')).toBe('')
    })

    it('mirrors getInviteShareUrl exactly minus the scheme', () => {
      expect(getInviteDisplayUrl('alice.bsky.social')).toBe(
        getInviteShareUrl('alice.bsky.social').replace(/^https:\/\//, ''),
      )
    })
  })
})
