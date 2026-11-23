import {type Client} from '@atproto/lex'

import {HomeFeedAPI as V2HomeFeedAPI} from '#/features/followingV2/home/api/home'
import {app} from '#/lexicons'
import {HomeFeedAPI as LegacyHomeFeedAPI} from './home'

let mockIsolated = true
jest.mock('#/env', () => {
  const env = {...jest.requireActual<typeof import('#/env')>('#/env')}
  // Define the getter after copying exports so object spread cannot snapshot it.
  Object.defineProperty(env, 'TORAH_ISOLATED_NETWORK', {
    get: () => mockIsolated,
  })
  return env
})
jest.mock('#/state/preferences/languages', () => ({
  getAppLanguageAsContentLanguage: () => '',
  getContentLanguages: () => [],
}))

const originalDev = __DEV__
beforeEach(() => {
  mockIsolated = true
  Object.assign(globalThis, {__DEV__: false})
})
afterEach(() => {
  Object.assign(globalThis, {__DEV__: originalDev})
})

function post(uri: string) {
  return {post: {uri}} as unknown as app.bsky.feed.defs.FeedViewPost
}

describe.each([
  ['legacy', LegacyHomeFeedAPI],
  ['following v2', V2HomeFeedAPI],
] as const)('isolated Home feed (%s)', (_name, HomeFeedAPI) => {
  it.each([{feed: [post('one'), post('two')]}, {feed: []}])(
    'retains the final timeline page without requesting a missing feed generator',
    async ({feed}) => {
      const call = jest.fn((method: unknown) => {
        if (method !== app.bsky.feed.getTimeline) {
          throw new Error('Could not find feed-generator repository')
        }
        return Promise.resolve({feed})
      })
      const api = new HomeFeedAPI({
        client: {did: 'did:plc:viewer', call} as unknown as Client,
      })

      const response = await api.fetch({cursor: undefined, limit: 30})

      expect(response.feed).toEqual(feed)
      expect(response.cursor).toBeUndefined()
      expect(call).toHaveBeenCalledTimes(1)
      expect(call).toHaveBeenCalledWith(
        app.bsky.feed.getTimeline,
        expect.objectContaining({cursor: undefined, limit: 30}),
      )
    },
  )

  it('paginates the timeline and stops at its own end', async () => {
    const call = jest
      .fn(
        (
          _method: unknown,
          _params: {cursor?: string; limit: number},
        ): Promise<app.bsky.feed.getTimeline.$OutputBody> =>
          Promise.resolve({feed: []}),
      )
      .mockResolvedValueOnce({cursor: 'timeline-next', feed: [post('first')]})
      .mockResolvedValueOnce({feed: [post('last')]})
    const api = new HomeFeedAPI({
      client: {did: 'did:plc:viewer', call} as unknown as Client,
    })

    const first = await api.fetch({cursor: undefined, limit: 30})
    const last = await api.fetch({cursor: first.cursor, limit: 30})

    expect(last.feed).toEqual([post('last')])
    expect(last.cursor).toBeUndefined()
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      app.bsky.feed.getTimeline,
      app.bsky.feed.getTimeline,
    ])
    expect(call.mock.calls[1][1]).toMatchObject({cursor: 'timeline-next'})
  })

  it('preserves real timeline errors instead of returning an empty success', async () => {
    const failure = new Error('Timeline unavailable')
    const call = jest.fn().mockRejectedValue(failure)
    const api = new HomeFeedAPI({
      client: {did: 'did:plc:viewer', call} as unknown as Client,
    })

    await expect(api.fetch({cursor: undefined, limit: 30})).rejects.toBe(
      failure,
    )
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('checks for new posts with getTimeline', async () => {
    const call = jest.fn().mockResolvedValue({feed: [post('latest')]})
    const api = new HomeFeedAPI({
      client: {did: 'did:plc:viewer', call} as unknown as Client,
    })

    await expect(api.peekLatest()).resolves.toEqual(post('latest'))
    expect(call).toHaveBeenCalledWith(app.bsky.feed.getTimeline, {limit: 1})
  })

  it('preserves the public-network Discover fallback', async () => {
    mockIsolated = false
    const call = jest.fn((method: unknown) =>
      Promise.resolve(
        method === app.bsky.feed.getTimeline
          ? {feed: [post('following')]}
          : {cursor: 'discover-next', feed: [post('discover')]},
      ),
    )
    const api = new HomeFeedAPI({
      client: {did: 'did:plc:viewer', call} as unknown as Client,
    })

    const response = await api.fetch({cursor: undefined, limit: 30})

    expect(response.feed.map(item => item.post.uri)).toEqual([
      'following',
      'fallback-marker-post',
      'discover',
    ])
    expect(response.cursor).toBe('discover-next')
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      app.bsky.feed.getTimeline,
      app.bsky.feed.getFeed,
    ])
  })
})
