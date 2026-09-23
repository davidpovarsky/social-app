import {useCallback} from 'react'
import {useQueryClient} from '@tanstack/react-query'

import {imageToThumb, type ResolvedExternalLink} from '#/lib/api/resolve'
import {precacheResolveLinkQuery} from '#/state/queries/resolve-link'
import {type app} from '#/lexicons'
import {getTorahSourceImageUrl} from '../sefaria/api'
import {
  buildSefariaSourceUri,
  hasNoImageParam,
  refFromSefariaUri,
} from '../sources/url'

export type TorahSourceSelectionOptions = {
  includeImage?: boolean
}

/**
 * Keeps all Sefaria-specific link metadata outside the upstream composer.
 * The selected source is still stored as a standard app.bsky.embed.external
 * URI; we only pre-cache the metadata so the composer never needs Bluesky's
 * link metadata service for a Torah source preview.
 */
export function useTorahSourceSelection(onSelectUri: (uri: string) => void) {
  const queryClient = useQueryClient()

  return useCallback(
    (rawUri: string, options?: TorahSourceSelectionOptions) => {
      const includeImage = options?.includeImage ?? !hasNoImageParam(rawUri)
      const targetUri = buildSefariaSourceUri(rawUri, includeImage)
      const ref = refFromSefariaUri(targetUri)
      const imageUrl =
        includeImage && ref
          ? getTorahSourceImageUrl(ref, {lang: 'he', platform: 'twitter'})
          : undefined

      const initialResolved: ResolvedExternalLink = {
        type: 'external',
        uri: targetUri,
        title: ref || 'Sefaria',
        description: 'מקור תורני ב־Sefaria',
        thumb: undefined,
        view: imageUrl
          ? ({
              $type: 'app.bsky.embed.external#view',
              external: {
                uri: targetUri,
                title: ref || 'Sefaria',
                description: 'מקור תורני ב־Sefaria',
                thumb: imageUrl,
              },
            } as app.bsky.embed.external.View)
          : undefined,
      }

      precacheResolveLinkQuery(queryClient, targetUri, initialResolved)
      onSelectUri(targetUri)

      if (imageUrl) {
        void imageToThumb(imageUrl)
          .then(composerImage => {
            if (composerImage) {
              precacheResolveLinkQuery(queryClient, targetUri, {
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
