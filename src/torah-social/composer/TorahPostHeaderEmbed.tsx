import {useEffect, useState} from 'react'
import {I18nManager, View} from 'react-native'

import {ExternalEmbedRemoveBtn} from '#/view/com/composer/ExternalEmbedRemoveBtn'
import {type EmbedDraft} from '#/view/com/composer/state/composer'
import {atoms as a, useTheme} from '#/alf'
import {Text} from '#/components/Typography'
import {resolveTorahSource} from '../sefaria/api'
import {isSefariaSourceUri, refFromSefariaUri} from '../sources/url'
import {formatCanonicalHebrewRef} from '../util/bidi'

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
  const isRTL = I18nManager.isRTL
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
          setHeRef(formatCanonicalHebrewRef(source.ref, source.heRef))
        }
      })
      .catch(() => {})
    return () => abort.abort()
  }, [sourceRef])

  if (!sourceRef) return null
  const title = heRef || sourceRef

  return (
    <View
      testID="torahPostHeaderEmbed"
      style={[
        a.relative,
        a.mb_xs,
        a.w_full,
        a.rounded_sm,
        a.border,
        t.atoms.border_contrast_low,
        {
          backgroundColor: t.name === 'dark' ? '#181714' : '#faf9f6',
          borderRightWidth: isRTL ? 3 : 1,
          borderLeftWidth: isRTL ? 1 : 3,
          borderRightColor: isRTL
            ? t.palette.primary_500
            : t.atoms.border_contrast_low.borderColor,
          borderLeftColor: isRTL
            ? t.atoms.border_contrast_low.borderColor
            : t.palette.primary_500,
          paddingHorizontal: 10,
          paddingVertical: 6,
          paddingRight: isRTL ? 48 : 10,
          paddingLeft: isRTL ? 10 : 48,
          minHeight: 44,
          justifyContent: 'center',
        },
      ]}>
      <Text
        style={[
          a.text_2xs,
          t.atoms.text_contrast_medium,
          {
            textAlign: isRTL ? 'right' : 'left',
            writingDirection: isRTL ? 'rtl' : 'ltr',
          },
        ]}>
        מקור תורני מצורף · ספריא
      </Text>
      <Text
        numberOfLines={1}
        style={[
          a.text_sm,
          a.font_semi_bold,
          {
            textAlign: isRTL ? 'right' : 'left',
            writingDirection: isRTL ? 'rtl' : 'ltr',
          },
        ]}>
        {title}
      </Text>
      <ExternalEmbedRemoveBtn onRemove={onRemove} />
    </View>
  )
}
