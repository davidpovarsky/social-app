import {View} from 'react-native'

import {atoms as a} from '#/alf'
import {ExternalEmbedLink} from '#/view/com/composer/ExternalEmbed'
import {isSefariaSourceUri} from '../sources/url'
import type {ComposerPostEmbed} from '#/view/com/composer/state/composer'

export function TorahPostHeaderEmbed({
  embed,
  onRemove,
}: {
  embed: ComposerPostEmbed
  onRemove: () => void
}) {
  if (!embed.link || !isSefariaSourceUri(embed.link.uri)) {
    return null
  }

  return (
    <View style={[a.relative, a.mb_sm, a.w_full]}>
      <ExternalEmbedLink
        uri={embed.link.uri}
        hasQuote={!!embed.quote}
        onRemove={onRemove}
      />
    </View>
  )
}
