import {useEffect, useState} from 'react'
import {Pressable, View} from 'react-native'

import {textInputWebEmitter} from '#/view/com/composer/text-input/textInputWebEmitter'
import {atoms as a, useTheme} from '#/alf'
import {Text} from '#/components/Typography'
import {detectTorahSources} from '../sefaria/linker'
import {type DetectedTorahSource} from '../sefaria/types'
import {formatTorahQuoteForInsertion} from '../sources/quoteBlock'

export function DetectedTorahSources({
  text,
  disabled,
  hasExistingEmbed,
  onSelectUri,
}: {
  text: string
  disabled?: boolean
  hasExistingEmbed?: boolean
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
        .catch(err => {
          if (!abort.signal.aborted) {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              // eslint-disable-next-line no-console
              console.warn('[DetectedTorahSources] detection error:', err)
            }
            setItems([])
          }
        })
    }, 700)

    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [disabled, text])

  if (!items.length) return null

  const handleInsert = (item: DetectedTorahSource) => {
    const formatted = formatTorahQuoteForInsertion(item)
    textInputWebEmitter.emit('insert-text', formatted)
  }

  return (
    <View style={[a.mt_sm, a.gap_xs]}>
      {items.map((item, index) => (
        <View
          key={`${item.ref}-${item.startChar}-${index}`}
          style={[
            a.p_sm,
            a.rounded_sm,
            a.border,
            t.atoms.border_contrast_low,
            {
              backgroundColor: t.name === 'dark' ? '#181714' : '#faf9f6',
              borderRightWidth: 3,
              borderRightColor: t.palette.primary_500,
            },
          ]}>
          <View
            style={[a.flex_row, a.align_center, a.justify_between, a.gap_sm]}>
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
                style={[
                  a.text_xs,
                  t.atoms.text_contrast_medium,
                  {textAlign: 'right'},
                ]}>
                זוהה מתוך: {item.matchedText}
              </Text>
            </View>

            {item.ambiguous && item.candidateRefs?.length ? null : (
              <View style={[a.flex_row, a.align_center, a.gap_2xs]}>
                {!hasExistingEmbed ? (
                  <Pressable
                    testID="torahAttachSourceBtn"
                    accessibilityRole="button"
                    accessibilityLabel={`הצמד מקור ${item.heRef}`}
                    accessibilityHint="מצמיד את המקור התורני להודעה"
                    onPress={() => onSelectUri(item.uri)}
                    style={({pressed}) => [
                      a.px_sm,
                      a.py_xs,
                      a.rounded_xs,
                      {
                        backgroundColor: t.palette.primary_500,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}>
                    <Text
                      style={[a.text_xs, a.font_semi_bold, {color: '#FFFFFF'}]}>
                      הצמד
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  testID="torahInsertTextBtn"
                  accessibilityRole="button"
                  accessibilityLabel={`הוסף ציטוט של ${item.heRef} לטקסט`}
                  accessibilityHint="מוסיף ציטוט לתוך גוף ההודעה"
                  onPress={() => handleInsert(item)}
                  style={({pressed}) => [
                    a.px_sm,
                    a.py_xs,
                    a.rounded_xs,
                    a.border,
                    t.atoms.border_contrast_low,
                    {
                      backgroundColor: t.atoms.bg.backgroundColor,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}>
                  <Text
                    style={[
                      a.text_xs,
                      a.font_semi_bold,
                      t.atoms.text_contrast_high,
                    ]}>
                    הוסף לטקסט
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Ambiguous candidates picker */}
          {item.ambiguous && item.candidateRefs?.length ? (
            <View
              style={[
                a.mt_xs,
                a.pt_xs,
                a.border_t,
                t.atoms.border_contrast_low,
                a.gap_xs,
              ]}>
              <Text
                style={[
                  a.text_2xs,
                  t.atoms.text_contrast_medium,
                  {textAlign: 'right'},
                ]}>
                זוהו מספר התאמות, בחר מקור:
              </Text>
              <View
                style={[
                  a.flex_row,
                  a.flex_wrap,
                  a.gap_2xs,
                  {justifyContent: 'flex-end'},
                ]}>
                {item.candidateRefs.slice(0, 4).map(cand => (
                  <Pressable
                    key={cand.ref}
                    accessibilityRole="button"
                    onPress={() =>
                      hasExistingEmbed
                        ? handleInsert({
                            ...item,
                            ref: cand.ref,
                            heRef: cand.heRef,
                            uri: cand.uri,
                          })
                        : onSelectUri(cand.uri)
                    }
                    style={({pressed}) => [
                      a.px_xs,
                      a.py_2xs,
                      a.rounded_xs,
                      a.border,
                      t.atoms.border_contrast_medium,
                      {
                        backgroundColor: t.atoms.bg.backgroundColor,
                        opacity: pressed ? 0.65 : 1,
                      },
                    ]}>
                    <Text
                      style={[
                        a.text_xs,
                        a.font_semi_bold,
                        {textAlign: 'right'},
                      ]}>
                      {cand.heRef}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  )
}
