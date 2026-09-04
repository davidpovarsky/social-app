import {useEffect, useState} from 'react'
import {Pressable, View} from 'react-native'

import {atoms as a, useTheme} from '#/alf'
import {Text} from '#/components/Typography'
import {detectTorahSources} from '../sefaria/linker'
import type {DetectedTorahSource} from '../sefaria/types'

export function DetectedTorahSources({
  text,
  disabled,
  onSelectUri,
}: {
  text: string
  disabled?: boolean
  onSelectUri: (uri: string) => void
}) {
  const t = useTheme()
  const [items, setItems] = useState<DetectedTorahSource[]>([])

  useEffect(() => {
    if (disabled || text.trim().length < 4) {
      setItems([])
      return
    }

    const abort = new AbortController()
    const timer = setTimeout(() => {
      void detectTorahSources(text, abort.signal)
        .then(results => {
          if (!abort.signal.aborted) setItems(results.slice(0, 3))
        })
        .catch(() => {
          if (!abort.signal.aborted) setItems([])
        })
    }, 900)

    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [disabled, text])

  if (!items.length) return null

  return (
    <View style={[a.mt_sm, a.gap_xs]}>
      {items.map((item, index) => (
        <View
          key={`${item.ref}-${item.startChar}-${index}`}
          style={[
            a.flex_row,
            a.align_center,
            a.justify_between,
            a.gap_sm,
            a.p_sm,
            a.rounded_sm,
            a.border,
            t.atoms.border_contrast_low,
          ]}>
          <View style={a.flex_1}>
            <Text
              numberOfLines={1}
              style={[
                a.text_sm,
                a.font_semi_bold,
                {textAlign: 'right', writingDirection: 'rtl'},
              ]}>
              {item.heRef}
            </Text>
            <Text
              numberOfLines={1}
              style={[a.text_xs, t.atoms.text_contrast_medium]}>
              זוהה מתוך: {item.matchedText}
            </Text>
          </View>
          {item.ambiguous ? (
            <Text style={[a.text_xs, t.atoms.text_contrast_medium]}>
              לא חד־משמעי
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => onSelectUri(item.uri)}
              style={({pressed}) => [a.p_sm, {opacity: pressed ? 0.6 : 1}]}>
              <Text style={[a.text_sm, a.font_semi_bold]}>הצמד</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  )
}
