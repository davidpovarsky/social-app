import {useEffect, useState} from 'react'
import {
  I18nManager,
  Pressable,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native'
import {Image} from 'expo-image'

import {atoms as a, useTheme} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {
  ChevronLeft_Stroke2_Corner0_Rounded as ChevronLeft,
  ChevronRight_Stroke2_Corner0_Rounded as ChevronRight,
} from '#/components/icons/Chevron'
import {Text} from '#/components/Typography'
import {resolveTorahSource} from '../sefaria/api'
import {type TorahSource} from '../sefaria/types'
import {SourceReaderDialog} from './SourceReaderDialog'
import {hasNoImageParam, refFromSefariaUri} from './url'

export function TorahSourceCard({
  uri,
  fallbackTitle,
  fallbackDescription,
  style,
  onOpen,
}: {
  uri: string
  fallbackTitle?: string
  fallbackDescription?: string
  style?: StyleProp<ViewStyle>
  onOpen?: () => void
}) {
  const t = useTheme()
  const reader = Dialog.useDialogControl()
  const sourceRef = refFromSefariaUri(uri)
  const [source, setSource] = useState<TorahSource>()
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    if (!sourceRef) return
    const abort = new AbortController()
    void resolveTorahSource(sourceRef, abort.signal)
      .then(setSource)
      .catch(() => {})
    return () => abort.abort()
  }, [sourceRef])

  if (!sourceRef) return null

  const title = source?.heRef || fallbackTitle || sourceRef
  const preview = source?.preview || fallbackDescription
  const allowImage = !hasNoImageParam(uri)
  const showImage = Boolean(allowImage && source?.imageUrl && !imageError)
  const ChevronIcon = I18nManager.isRTL ? ChevronLeft : ChevronRight

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`מקור: ${title}`}
        accessibilityHint="פותח את המקור התורני לקריאה"
        onPress={() => {
          onOpen?.()
          reader.open()
        }}
        style={({pressed}) => [
          a.mt_sm,
          a.rounded_sm,
          a.border,
          a.overflow_hidden,
          t.atoms.border_contrast_low,
          {
            backgroundColor: t.name === 'dark' ? '#181714' : '#faf9f6',
            borderRightWidth: 3,
            borderRightColor: t.palette.primary_500,
            opacity: pressed ? 0.75 : 1,
          },
          style,
        ]}>
        <View style={[a.p_md, a.gap_xs]}>
          <View style={[a.flex_row, a.gap_md, a.align_center]}>
            {showImage && source?.imageUrl ? (
              <View
                style={[
                  a.rounded_xs,
                  a.overflow_hidden,
                  a.border,
                  t.atoms.border_contrast_low,
                  {
                    width: 76,
                    height: 76,
                    backgroundColor: t.palette.contrast_50,
                  },
                ]}>
                <Image
                  source={{uri: source.imageUrl}}
                  style={[a.w_full, a.h_full]}
                  contentFit="cover"
                  accessibilityLabel={`תמונת מקור: ${title}`}
                  accessibilityHint="מציג תמונת מקור"
                  onError={() => setImageError(true)}
                />
              </View>
            ) : null}

            <View style={[a.flex_1, a.gap_2xs]}>
              <Text
                numberOfLines={1}
                style={[
                  a.text_md,
                  a.font_semi_bold,
                  {textAlign: 'right', writingDirection: 'rtl'},
                ]}>
                {title}
              </Text>

              {preview ? (
                <Text
                  numberOfLines={2}
                  style={[
                    a.text_sm,
                    a.leading_snug,
                    t.atoms.text_contrast_high,
                    {textAlign: 'right', writingDirection: 'rtl'},
                  ]}>
                  {preview}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Bottom metadata and quiet action row */}
          <View
            style={[
              a.flex_row,
              a.align_center,
              a.justify_between,
              a.pt_xs,
              a.border_t,
              t.atoms.border_contrast_low,
            ]}>
            <View style={[a.flex_row, a.align_center, a.gap_2xs]}>
              <Text style={[a.text_xs, t.atoms.text_contrast_medium]}>
                ספריא
              </Text>
              <ChevronIcon size="xs" style={t.atoms.text_contrast_medium} />
            </View>

            {source?.category ? (
              <Text
                numberOfLines={1}
                style={[a.text_xs, t.atoms.text_contrast_medium]}>
                {source.category}
              </Text>
            ) : (
              <View />
            )}
          </View>
        </View>
      </Pressable>
      <SourceReaderDialog control={reader} sourceRef={sourceRef} />
    </>
  )
}
