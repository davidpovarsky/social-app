import {useEffect, useState} from 'react'
import {
  Pressable,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native'

import {atoms as a, useTheme} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {Text} from '#/components/Typography'
import {resolveTorahSource} from '../sefaria/api'
import type {TorahSource} from '../sefaria/types'
import {SourceReaderDialog} from './SourceReaderDialog'
import {refFromSefariaUri} from './url'

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

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`פתח מקור ${title}`}
        onPress={() => {
          onOpen?.()
          reader.open()
        }}
        style={({pressed}) => [
          a.mt_sm,
          a.p_md,
          a.rounded_md,
          a.border,
          t.atoms.border_contrast_low,
          t.atoms.bg,
          {opacity: pressed ? 0.72 : 1},
          style,
        ]}>
        <View style={[a.gap_xs]}>
          <View style={[a.flex_row, a.align_center, a.justify_between, a.gap_md]}>
            <Text style={[a.text_xs, t.atoms.text_contrast_medium]}>מקור תורני</Text>
            <Text style={[a.text_xs, t.atoms.text_contrast_medium]}>Sefaria</Text>
          </View>
          <Text
            style={[
              a.text_lg,
              a.font_semi_bold,
              {textAlign: 'right', writingDirection: 'rtl'},
            ]}>
            {title}
          </Text>
          {source?.ref && source.ref !== title ? (
            <Text style={[a.text_sm, t.atoms.text_contrast_medium]}>
              {source.ref}
            </Text>
          ) : null}
          {preview ? (
            <Text
              numberOfLines={4}
              style={[
                a.text_md,
                {textAlign: 'right', writingDirection: 'rtl'},
              ]}>
              {preview}
            </Text>
          ) : null}
          <Text style={[a.text_sm, a.font_semi_bold]}>פתח מקור ←</Text>
        </View>
      </Pressable>
      <SourceReaderDialog control={reader} sourceRef={sourceRef} />
    </>
  )
}
