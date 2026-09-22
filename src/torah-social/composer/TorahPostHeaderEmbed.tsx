import {View} from 'react-native'

import {ExternalEmbedLink} from '#/view/com/composer/ExternalEmbed'
import {type EmbedDraft} from '#/view/com/composer/state/composer'
import {atoms as a} from '#/alf'
import {isSefariaSourceUri} from '../sources/url'

export function TorahPostHeaderEmbed({
  embed,
  onRemove,
}: {
  embed: EmbedDraft
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
