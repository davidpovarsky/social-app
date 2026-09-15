import {useState} from 'react'
import {Linking, Pressable, StyleSheet, View} from 'react-native'

import {atoms as a, useTheme, web} from '#/alf'
import * as Dialog from '#/components/Dialog'
import {SquareArrowTopRight_Stroke2_Corner0_Rounded as ExternalLinkIcon} from '#/components/icons/SquareArrowTopRight'
import {Text} from '#/components/Typography'
import {SourceReaderDialog} from './SourceReaderDialog'
import {cleanSefariaUri, refFromSefariaUri} from './url'

export function TorahQuoteBlock({
  quote,
  refName,
  uri,
}: {
  quote?: string
  refName?: string
  uri: string
}) {
  const t = useTheme()
  const readerControl = Dialog.useDialogControl()
  const displayRef = refName || refFromSefariaUri(uri) || 'מקור תורני'
  const cleanUri = cleanSefariaUri(uri)

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`פתח מקור תורני: ${displayRef}`}
        onPress={() => readerControl.open()}
        style={({pressed, hovered}) => [
          a.my_xs,
          a.p_md,
          a.rounded_md,
          a.border,
          t.atoms.border_contrast_low,
          styles.card,
          {
            backgroundColor: t.name === 'dark' ? '#1E1B15' : '#FCF9F2',
            borderRightWidth: 4,
            borderRightColor: '#C4973B',
            opacity: pressed ? 0.85 : hovered ? 0.95 : 1,
          },
        ]}>
        {/* Header */}
        <View style={[a.flex_row, a.align_center, a.justify_between, a.mb_xs]}>
          <View style={[a.flex_row, a.align_center, a.gap_xs]}>
            <Text style={[a.text_sm]}>📖</Text>
            <Text
              style={[
                a.text_sm,
                a.font_semi_bold,
                t.atoms.text_contrast_high,
                {textAlign: 'right', writingDirection: 'rtl'},
              ]}>
              {displayRef}
            </Text>
          </View>

          <Pressable
            accessibilityRole="link"
            accessibilityLabel="פתח באתר Sefaria"
            onPress={e => {
              e.stopPropagation?.()
              void Linking.openURL(cleanUri)
            }}
            style={({pressed}) => [
              a.flex_row,
              a.align_center,
              a.gap_2xs,
              a.px_xs,
              a.py_2xs,
              a.rounded_xs,
              {opacity: pressed ? 0.6 : 0.85},
            ]}>
            <Text style={[a.text_xs, a.font_medium, t.atoms.text_contrast_medium]}>
              Sefaria
            </Text>
            <ExternalLinkIcon size="xs" style={t.atoms.text_contrast_medium} />
          </Pressable>
        </View>

        {/* Quote body */}
        {quote ? (
          <Text
            style={[
              a.text_md,
              a.leading_snug,
              t.atoms.text_contrast_high,
              a.mb_xs,
              {
                textAlign: 'right',
                writingDirection: 'rtl',
                fontStyle: 'normal',
              },
            ]}>
            {quote.startsWith('״') || quote.startsWith('"') ? quote : `״${quote}״`}
          </Text>
        ) : null}

        {/* Footer hint */}
        <View style={[a.flex_row, a.align_center, a.justify_end, a.gap_2xs, a.pt_2xs]}>
          <Text style={[a.text_xs, t.atoms.text_contrast_low]}>
            לחץ לקריאה מלאה, פירושים וכתבי יד 📜
          </Text>
        </View>
      </Pressable>

      <SourceReaderDialog control={readerControl} sourceRef={uri} />
    </>
  )
}

const styles = StyleSheet.create({
  card: web({
    cursor: 'pointer',
    transition: 'opacity 0.15s ease-in-out',
  }),
})
