import {useEffect, useState} from 'react'
import {ActivityIndicator, Pressable, View} from 'react-native'

import {textInputWebEmitter} from '#/view/com/composer/text-input/textInputWebEmitter'
import {atoms as a, useTheme, web} from '#/alf'
import {Button, ButtonIcon, ButtonText} from '#/components/Button'
import * as Dialog from '#/components/Dialog'
import * as TextField from '#/components/forms/TextField'
import {PageText_Stroke2_Corner0_Rounded as SourceIcon} from '#/components/icons/PageText'
import {PlusLarge_Stroke2_Corner0_Rounded as PlusIcon} from '#/components/icons/Plus'
import {Text} from '#/components/Typography'
import {autocompleteRefs, resolveTorahSource} from '../sefaria/api'
import {type SefariaCompletion, type TorahSource} from '../sefaria/types'
import {formatTorahQuoteForInsertion} from './quoteBlock'
import {buildSefariaSourceUri} from './url'

export function SourcePickerDialog({
  control,
  onSelect,
}: {
  control: ReturnType<typeof Dialog.useDialogControl>
  onSelect: (uri: string) => void
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SefariaCompletion[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [resolvedSource, setResolvedSource] = useState<TorahSource | null>(null)
  const [includeImage, setIncludeImage] = useState(true)
  const [error, setError] = useState<string>()

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
      void autocompleteRefs(value, abort.signal)
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

  const handleAttachSource = () => {
    if (!resolvedSource) return
    const targetUri = buildSefariaSourceUri(resolvedSource.uri, includeImage)
    onSelect(targetUri)
    control.close(() => {
      setQuery('')
      setSuggestions([])
      setResolvedSource(null)
    })
  }

  const handleInsertIntoText = () => {
    if (!resolvedSource) return
    const formatted = formatTorahQuoteForInsertion(resolvedSource)
    textInputWebEmitter.emit('insert-text', formatted)
    control.close(() => {
      setQuery('')
      setSuggestions([])
      setResolvedSource(null)
    })
  }

  const handleReset = () => {
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
        style={web({maxWidth: 600})}>
        <View style={[a.gap_md, a.w_full]}>
          <View style={[a.flex_row, a.align_center, a.justify_between]}>
            <Text style={[a.text_xl, a.font_semi_bold]}>הוסף מקור תורני</Text>
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
                  label="חיפוש מקור תורני"
                  autoFocus
                  value={query}
                  onChangeText={txt => {
                    setQuery(txt)
                    setError(undefined)
                  }}
                  onSubmitEditing={() => void resolveSourceItem(query)}
                  placeholder="לדוגמה: ברכות ב ע״א, בראשית א:א..."
                  style={[{textAlign: 'right', writingDirection: 'rtl'}]}
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
                        t.atoms.border_contrast_low,
                        {opacity: pressed ? 0.65 : 1},
                      ]}>
                      <Text
                        style={[
                          a.text_md,
                          a.font_semi_bold,
                          {textAlign: 'right', writingDirection: 'rtl'},
                        ]}>
                        {item.title}
                      </Text>
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
                    {resolvedSource.heRef || resolvedSource.ref}
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
              <View style={[a.gap_sm, a.pt_xs]}>
                <Button
                  label="הצמד מקור מעל ההודעה"
                  onPress={handleAttachSource}
                  variant="solid"
                  color="primary"
                  size="large">
                  <ButtonIcon icon={SourceIcon} />
                  <ButtonText>הצמד מקור מעל ההודעה</ButtonText>
                </Button>

                <Button
                  label="הכנס ציטוט לתוך הטקסט (איפה שהסמן)"
                  onPress={handleInsertIntoText}
                  variant="outline"
                  color="primary"
                  size="large">
                  <ButtonIcon icon={PlusIcon} />
                  <ButtonText>הכנס ציטוט לתוך הטקסט (איפה שהסמן)</ButtonText>
                </Button>

                <Button
                  label="חפש מקור אחר"
                  onPress={handleReset}
                  variant="ghost"
                  color="secondary"
                  size="medium">
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
