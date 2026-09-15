import {useCallback} from 'react'
import {useQueryClient} from '@tanstack/react-query'

import {type ResolvedLink, imageToThumb} from '#/lib/api/resolve'
import {precacheResolveLinkQuery} from '#/state/queries/resolve-link'
import {getTorahSourceImageUrl} from '../sefaria/api'
import {refFromSefariaUri} from '../sources/url'

/**
 * Keeps all Sefaria-specific link metadata outside the upstream composer.
 * The selected source is still stored as a standard app.bsky.embed.external
 * URI; we only pre-cache the metadata so the composer never needs Bluesky's
 * link metadata service for a Torah source preview.
 */
export function useTorahSourceSelection(
  onSelectUri: (uri: string) => void,
) {
  const queryClient = useQueryClient()

  return useCallback(
    (uri: string) => {
      const ref = refFromSefariaUri(uri)
      const imageUrl = ref
        ? getTorahSourceImageUrl(ref, {lang: 'he', platform: 'twitter'})
        : undefined

      const initialResolved: ResolvedLink = {
        type: 'external',
        uri,
        title: ref || 'Sefaria',
        description: 'מקור תורני ב־Sefaria',
        thumb: undefined,
        view: imageUrl
          ? {
              $type: 'app.bsky.embed.external#view',
              external: {
                uri,
                title: ref || 'Sefaria',
                description: 'מקור תורני ב־Sefaria',
                thumb: imageUrl,
              },
            }
          : undefined,
      }

      precacheResolveLinkQuery(queryClient, uri, initialResolved)
      onSelectUri(uri)

      if (imageUrl) {
        void imageToThumb(imageUrl)
          .then(composerImage => {
            if (composerImage) {
              precacheResolveLinkQuery(queryClient, uri, {
                ...initialResolved,
                thumb: composerImage,
              })
            }
          })
          .catch(() => {})
      }
    },
    [onSelectUri, queryClient],
  )
}

