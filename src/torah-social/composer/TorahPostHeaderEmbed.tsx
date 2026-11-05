import {useEffect, useState} from 'react'
import {View} from 'react-native'

import {atoms as a, useTheme} from '#/alf'
import {Text} from '#/components/Typography'
import {ExternalEmbedRemoveBtn} from '#/view/com/composer/ExternalEmbedRemoveBtn'
import {type EmbedDraft} from '#/view/com/composer/state/composer'
import {formatHebrewRef, resolveTorahSource} from '../sefaria/api'
import {isSefariaSourceUri, refFromSefariaUri} from '../sources/url'

/**
 * Published Torah cards are full-size. A compact attachment in the composer
 * leaves enough space for writing when the on-screen keyboard is visible.
 */
export function TorahPostHeaderEmbed({
  embed,
  onRemove,
}: {
  embed: EmbedDraft
  onRemove: () => void
}) {
  const t = useTheme()
  const sourceRef =
    embed.link && isSefariaSourceUri(embed.link.uri)
      ? refFromSefariaUri(embed.link.uri)
      : undefined
  const [heRef, setHeRef] = useState<string>()

  useEffect(() => {
    setHeRef(undefined)
    if (!sourceRef) return
    const abort = new AbortController()
    void resolveTorahSource(sourceRef, abort.signal)
      .then(source => {
        if (!abort.signal.aborted) {
          setHeRef(formatHebrewRef(source.ref, source.heRef))
        }
      })
      .catch(() => {})
    return () => abort.abort()
  }, [sourceRef])

  if (!sourceRef) return null
  const title = heRef || sourceRef

  return (
    <View
      style={[
        a.relative,
        a.mb_sm,
        a.w_full,
        a.rounded_sm,
        a.border,
        t.atoms.border_contrast_low,
        {
          backgroundColor: t.name === 'dark' ? '#181714' : '#faf9f6',
          borderRightWidth: 3,
          borderRightColor: t.palette.primary_500,
          paddingHorizontal: 12,
          paddingVertical: 8,
          paddingRight: 52,
          minHeight: 58,
          justifyContent: 'center',
        },
      ]}>
      <Text
        style={[
          a.text_xs,
          t.atoms.text_contrast_medium,
          {textAlign: 'right', writingDirection: 'rtl'},
        ]}>
        מקור תורני מצורף · ספריא
      </Text>
      <Text
        numberOfLines={1}
        style={[
          a.text_sm,
          a.font_semi_bold,
          {textAlign: 'right', writingDirection: 'rtl'},
        ]}>
        {title}
      </Text>
      <ExternalEmbedRemoveBtn onRemove={onRemove} />
    </View>
  )
}
