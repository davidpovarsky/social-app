import {describe, expect, it, jest} from '@jest/globals'

import {
  convertBskyAppUrlIfNeeded,
  getChatInviteCodeFromUrl,
  isBskyAppUrl,
  isBskyPostUrl,
  isBskyRSSUrl,
  isExternalUrl,
  isTrustedUrl,
  linkRequiresWarning,
  toNiceDomain,
  toShareUrl,
} from '#/lib/strings/url-helpers'

jest.mock('#/env', () => ({
  ...jest.requireActual<object>('#/env'),
  TORAH_ISOLATED_NETWORK: true,
  TORAH_WEB_HOST: 'https://torah.example',
  TORAH_PDS_HOST: 'https://pds.torah.example',
}))

describe('independent Torah network URLs', () => {
  it('shares relative paths on the configured Torah website', () => {
    expect(toShareUrl('/profile/alice.test')).toBe(
      'https://torah.example/profile/alice.test',
    )
    expect(toShareUrl('https://example.org/article')).toBe(
      'https://example.org/article',
    )
  })

  it('opens Torah post and chat links inside the app', () => {
    const post = 'https://torah.example/profile/alice.test/post/3abc'
    expect(isBskyAppUrl(post)).toBe(true)
    expect(isBskyPostUrl(post)).toBe(true)
    expect(isExternalUrl(post)).toBe(false)
    expect(convertBskyAppUrlIfNeeded(post)).toBe(
      '/profile/alice.test/post/3abc',
    )
    expect(getChatInviteCodeFromUrl('https://torah.example/chat/abcdefg')).toBe(
      'abcdefg',
    )
    expect(isBskyRSSUrl('https://torah.example/profile/alice.test/rss')).toBe(
      true,
    )
  })

  it('leaves public Bluesky links external to the independent network', () => {
    const post = 'https://bsky.app/profile/alice.test/post/3abc'
    expect(isBskyAppUrl(post)).toBe(false)
    expect(isBskyPostUrl(post)).toBe(false)
    expect(isExternalUrl(post)).toBe(true)
    expect(convertBskyAppUrlIfNeeded(post)).toBe(post)
    expect(
      getChatInviteCodeFromUrl('https://bsky.app/chat/abcdefg'),
    ).toBeUndefined()
    expect(linkRequiresWarning(post, 'my post')).toBe(true)
  })

  it.each([
    ['https://torah.example', true],
    ['https://torah.example/profile/alice.test', true],
    ['/profile/alice.test', true],
    ['#profile', true],
    ['https://bsky.app', false],
    ['https://bsky.social', false],
    ['https://torah.example.evil.test/profile', false],
    ['https://torah.example@evil.test/profile', false],
    ['//evil.test/profile', false],
  ])('trusts only the intended URL boundary: %s', (url, expected) => {
    expect(isTrustedUrl(url as string)).toBe(expected)
  })

  it('keeps local content labels safe without requiring a URL as the label', () => {
    expect(
      linkRequiresWarning(
        'https://torah.example/profile/alice.test',
        'my profile',
      ),
    ).toBe(false)
    expect(
      linkRequiresWarning(
        'https://torah.example/profile/alice.test',
        'https://other.test',
      ),
    ).toBe(true)
  })

  it('labels each provider accurately', () => {
    expect(toNiceDomain('https://pds.torah.example')).toBe('Torah Social')
    expect(toNiceDomain('https://bsky.social')).toBe('Bluesky Social')
    expect(toNiceDomain('https://unrelated.test')).toBe('unrelated.test')
  })
})
