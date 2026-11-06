import {useEffect, useRef, useState} from 'react'
import {ActivityIndicator, Pressable, View} from 'react-native'

import {textInputWebEmitter} from '#/view/com/composer/text-input/textInputWebEmitter'
import {atoms as a, useTheme, web} from '#/alf'
import {Button, ButtonIcon, ButtonText} from '#/components/Button'
import * as Dialog from '#/components/Dialog'
import * as TextField from '#/components/forms/TextField'
import {PageText_Stroke2_Corner0_Rounded as SourceIcon} from '#/components/icons/PageText'
import {PlusLarge_Stroke2_Corner0_Rounded as PlusIcon} from '#/components/icons/Plus'
import {Text} from '#/components/Typography'
import {resolveTorahSource, searchTorahSources} from '../sefaria/api'
import {type SefariaCompletion, type TorahSource} from '../sefaria/types'
import {formatCanonicalHebrewRef} from '../util/bidi'
import {
  formatTorahQuoteForInsertion,
  isTorahQuoteAlreadyIncluded,
} from './quoteBlock'
import {buildSefariaSourceUri} from './url'

export function SourcePickerDialog({
  control,
  onSelect,
  text = '',
}: {
  control: ReturnType<typeof Dialog.useDialogControl>
  onSelect: (uri: string) => void
  text?: string
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SefariaCompletion[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [resolvedSource, setResolvedSource] = useState<TorahSource | null>(null)
  const [includeImage, setIncludeImage] = useState(true)
  const [error, setError] = useState<string>()
  const actionPending = useRef(false)

  useEffect(() => {
    const value = query.trim()
    if (value.length < 2 || resolvedSource) {
      setSuggestions([])
      setIsSearching(false)
      return
    }

    const abort = new AbortController()
    const timer = setTimeout(() => {
      setIsSearching(true)
      void searchTorahSources(value, abort.signal)
        .then(items => {
          setSuggestions(items)
          setError(undefined)
        })
        .catch(err => {
          if (abort.signal.aborted) return
          setSuggestions([])
          setError(err instanceof Error ? err.message : 'החיפוש נכשל')
        })
        .finally(() => {
          if (!abort.signal.aborted) setIsSearching(false)
        })
    }, 250)

    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [query, resolvedSource])

  const resolveSourceItem = async (value: string) => {
    if (isResolving || !value.trim()) return
    setIsResolving(true)
    setError(undefined)
    try {
      const source = await resolveTorahSource(value)
      setResolvedSource(source)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'המקור לא זוהה בספרייה')
    } finally {
      setIsResolving(false)
    }
  }

  const resetAfterClose = () => {
    actionPending.current = false
    setQuery('')
    setSuggestions([])
    setResolvedSource(null)
  }

  const handleAttachSource = () => {
    if (!resolvedSource || actionPending.current) return
    actionPending.current = true
    const targetUri = buildSefariaSourceUri(resolvedSource.uri, includeImage)
    onSelect(targetUri)
    control.close(resetAfterClose)
  }

  const handleInsertIntoText = () => {
    if (
      !resolvedSource ||
      actionPending.current ||
      isTorahQuoteAlreadyIncluded(text, resolvedSource)
    ) {
      return
    }
    actionPending.current = true
    const formatted = formatTorahQuoteForInsertion(resolvedSource)
    textInputWebEmitter.emit('insert-text', formatted)
    control.close(resetAfterClose)
  }

  const handleReset = () => {
    actionPending.current = false
    setResolvedSource(null)
    setQuery('')
    setSuggestions([])
    setError(undefined)
  }

  return (
    <Dialog.Outer control={control} nativeOptions={{fullHeight: true}}>
      <Dialog.Handle />
      <Dialog.ScrollableInner
        label="הוסף מקור תורני"
        style={[a.w_full, web({maxWidth: 600})]}
        contentContainerStyle={[
          a.w_full,
          {
            maxWidth: 540,
            alignSelf: 'center',
            paddingBottom: 48,
          },
        ]}>
        <View style={[a.gap_md, a.w_full, {minWidth: 0, flexShrink: 1}]}>
          <View style={[a.flex_row, a.align_center, a.justify_between]}>
            <Text style={[a.text_xl, a.font_semi_bold, {flexShrink: 1}]}>
              הוסף מקור תורני
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="סגור"
              accessibilityHint="סוגר את חלון בחירת המקור"
              onPress={() => control.close()}
              style={a.p_xs}>
              <Text style={[a.text_md, a.font_semi_bold]}>סגור</Text>
            </Pressable>
          </View>

          {!resolvedSource ? (
            <>
              <Text style={[a.text_sm, t.atoms.text_contrast_medium]}>
                חפש פסוק, דף גמרא, הלכה, משנה, פירוש או כל מקור הקיים ב־Sefaria
              </Text>

              <TextField.Root>
                <Dialog.Input
                  testID="torahSourceQueryInput"
                  label="חיפוש מקור תורני"
                  autoFocus
                  value={query}
                  onChangeText={txt => {
                    setQuery(txt)
                    setError(undefined)
                  }}
                  onSubmitEditing={() => void resolveSourceItem(query)}
                  placeholder="לדוגמה: ברכות ב ע״א, בראשית א:א..."
                  style={[
                    {
                      textAlign: 'right',
                      writingDirection: 'rtl',
                      width: '100%',
                      minWidth: 0,
                      flexShrink: 1,
                    },
                  ]}
                />
              </TextField.Root>

              <Button
                label="בדוק מקור"
                disabled={!query.trim() || isResolving}
                onPress={() => void resolveSourceItem(query)}
                variant="solid"
                color="primary"
                size="large">
                <ButtonText>
                  {isResolving ? 'מאמת מקור…' : 'המשך לבחירה'}
                </ButtonText>
              </Button>

              {error ? (
                <Text
                  style={[
                    a.text_sm,
                    {color: t.palette.negative_400, textAlign: 'right'},
                  ]}>
                  {error}
                </Text>
              ) : null}

              {isSearching && (
                <View style={[a.py_sm, a.align_center]}>
                  <ActivityIndicator />
                </View>
              )}

              {suggestions.length > 0 && (
                <View style={[a.gap_xs, a.pt_xs]}>
                  <Text
                    style={[
                      a.text_xs,
                      t.atoms.text_contrast_medium,
                      {textAlign: 'right'},
                    ]}>
                    הצעות התאמה מ־Sefaria:
                  </Text>
                  {suggestions.map(item => (
                    <Pressable
                      key={`${item.key}-${item.title}`}
                      accessibilityRole="button"
                      onPress={() => void resolveSourceItem(item.key)}
                      style={({pressed}) => [
                        a.p_md,
                        a.rounded_sm,
                        a.border,
                        item.exact
                          ? [
                              t.atoms.border_contrast_medium,
                              {
                                backgroundColor:
                                  t.name === 'dark' ? '#1c1b18' : '#faf8f5',
                                borderRightWidth: 3,
                                borderRightColor: t.palette.primary_500,
                              },
                            ]
                          : t.atoms.border_contrast_low,
                        {opacity: pressed ? 0.65 : 1},
                      ]}>
                      <View
                        style={[
                          a.flex_row,
                          a.align_center,
                          a.justify_between,
                          a.gap_sm,
                        ]}>
                        <View style={[a.flex_row, a.align_center, a.gap_xs]}>
                          {item.exact ? (
                            <View
                              style={[
                                a.px_xs,
                                a.py_2xs,
                                a.rounded_full,
                                {
                                  backgroundColor:
                                    t.name === 'dark'
                                      ? t.palette.contrast_100
                                      : t.palette.contrast_50,
                                },
                              ]}>
                              <Text
                                style={[
                                  a.text_2xs,
                                  a.font_semi_bold,
                                  t.atoms.text_contrast_high,
                                ]}>
                                מקור מדויק
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text
                          style={[
                            a.text_md,
                            a.font_semi_bold,
                            a.flex_1,
                            {textAlign: 'right', writingDirection: 'rtl'},
                          ]}>
                          {item.title}
                        </Text>
                      </View>
                      {item.key !== item.title ? (
                        <Text
                          style={[
                            a.text_sm,
                            t.atoms.text_contrast_medium,
                            {textAlign: 'right'},
                          ]}>
                          {item.key}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          ) : (
            /* Resolved Source Screen with toggle and action buttons */
            <View style={[a.gap_md]}>
              {/* Preview card */}
              <View
                style={[
                  a.p_md,
                  a.rounded_md,
                  a.border,
                  t.atoms.border_contrast_low,
                  {
                    backgroundColor: t.name === 'dark' ? '#1E1B15' : '#FCF9F2',
                    borderRightWidth: 4,
                    borderRightColor: '#C4973B',
                  },
                ]}>
                <View style={[a.flex_row, a.align_center, a.gap_xs, a.mb_xs]}>
                  <Text style={a.text_sm}>📖</Text>
                  <Text
                    style={[
                      a.text_md,
                      a.font_semi_bold,
                      {textAlign: 'right', writingDirection: 'rtl'},
                    ]}>
                    {formatCanonicalHebrewRef(
                      resolvedSource.ref,
                      resolvedSource.heRef,
                    )}
                  </Text>
                </View>
                {resolvedSource.preview ? (
                  <Text
                    numberOfLines={4}
                    style={[
                      a.text_sm,
                      a.leading_snug,
                      t.atoms.text_contrast_high,
                      {textAlign: 'right', writingDirection: 'rtl'},
                    ]}>
                    {resolvedSource.preview}
                  </Text>
                ) : null}
              </View>

              {/* Image Toggle */}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{checked: includeImage}}
                onPress={() => setIncludeImage(!includeImage)}
                style={({pressed}) => [
                  a.flex_row,
                  a.align_center,
                  a.justify_between,
                  a.p_md,
                  a.rounded_sm,
                  a.border,
                  t.atoms.border_contrast_low,
                  {opacity: pressed ? 0.8 : 1},
                ]}>
                <View style={[a.gap_2xs, a.flex_1, {alignItems: 'flex-end'}]}>
                  <Text
                    style={[a.text_sm, a.font_semi_bold, {textAlign: 'right'}]}>
                    כלול תמונת מקור מעוצבת
                  </Text>
                  <Text
                    style={[
                      a.text_xs,
                      t.atoms.text_contrast_medium,
                      {textAlign: 'right'},
                    ]}>
                    {includeImage
                      ? 'תוצג כרטיסייה גרפית עם תמונת הציטוט מ־Sefaria'
                      : 'יוצג כרטיס טקסטואלי אלגנטי בלבד, ללא תמונה'}
                  </Text>
                </View>
                <View
                  style={[
                    {
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: includeImage
                        ? t.palette.primary_500
                        : t.palette.contrast_200,
                      justifyContent: 'center',
                      paddingHorizontal: 2,
                    },
                  ]}>
                  <View
                    style={[
                      {
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: '#FFF',
                        alignSelf: includeImage ? 'flex-end' : 'flex-start',
                      },
                    ]}
                  />
                </View>
              </Pressable>

              {/* Action Buttons */}
              <View style={[a.gap_sm, a.pt_xs, a.w_full]}>
                <Button
                  testID="torahAttachSourceBtn"
                  label="הצמד מקור מעל ההודעה"
                  onPress={handleAttachSource}
                  variant="solid"
                  color="primary"
                  size="large"
                  style={[a.w_full]}>
                  <ButtonIcon icon={SourceIcon} />
                  <ButtonText
                    numberOfLines={2}
                    style={[a.flex_shrink, {writingDirection: 'rtl'}]}>
                    הצמד מקור מעל ההודעה
                  </ButtonText>
                </Button>

                <Button
                  testID="torahInsertQuoteBtn"
                  label="הכנס ציטוט לתוך הטקסט"
                  disabled={isTorahQuoteAlreadyIncluded(text, resolvedSource)}
                  onPress={handleInsertIntoText}
                  variant="outline"
                  color="primary"
                  size="large"
                  style={[a.w_full]}>
                  <ButtonIcon icon={PlusIcon} />
                  <ButtonText
                    numberOfLines={2}
                    style={[a.flex_shrink, {writingDirection: 'rtl'}]}>
                    הכנס ציטוט לתוך הטקסט
                  </ButtonText>
                </Button>

                <Button
                  label="חפש מקור אחר"
                  onPress={handleReset}
                  variant="ghost"
                  color="secondary"
                  size="medium"
                  style={[a.w_full]}>
                  <ButtonText>חפש מקור אחר</ButtonText>
                </Button>
              </View>
            </View>
          )}
        </View>
      </Dialog.ScrollableInner>
    </Dialog.Outer>
  )
}
