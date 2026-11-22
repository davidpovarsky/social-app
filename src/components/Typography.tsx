import {createContext, useContext} from 'react'
import {UITextView} from '@bsky.app/react-native-uitextview'

import {getInterfaceTextDirectionStyle} from '#/lib/strings/text-direction'
import {useAppLayoutDirection} from '#/locale/layoutDirection'
import {logger} from '#/logger'
import {atoms as a, type TextStyleProp, useAlf, useTheme, web} from '#/alf'
import {
  childHasEmoji,
  normalizeTextStyles,
  renderChildrenWithEmoji,
  type TextProps,
} from '#/alf/typography'
import {IS_NATIVE} from '#/env'

export type {TextProps}
export {Text as Span} from 'react-native'

// Nested spans inherit their paragraph, including mixed-language rich text.
const NativeTextAncestorContext = createContext(false)

/**
 * Our main text component. Use this most of the time.
 */
export function Text({
  children,
  emoji,
  style,
  selectable,
  title,
  dataSet,
  numberOfLines,
  allowFontScaling = true,
  ...rest
}: TextProps) {
  const isTextDescendant = useContext(NativeTextAncestorContext)
  const appDirection = useAppLayoutDirection()
  const {fonts, flags} = useAlf()
  const t = useTheme()
  const s = normalizeTextStyles(
    [
      a.text_sm,
      t.atoms.text,
      a.leading_snug,
      web(numberOfLines === 1 && numberOfLinesClippingFix),
      style,
    ],
    {
      fontScale: allowFontScaling ? fonts.scaleMultiplier : 1,
      fontFamily: fonts.family,
      flags,
    },
  )
  const directionStyle = isTextDescendant
    ? undefined
    : getInterfaceTextDirectionStyle(appDirection, s)

  if (__DEV__) {
    if (!emoji && childHasEmoji(children)) {
      logger.warn(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string
        `Text: emoji detected but emoji not enabled: "${children}"\n\nPlease add <Text emoji />'`,
      )
    }
  }

  const shared = {
    uiTextView: true,
    selectable,
    numberOfLines,
    style: directionStyle ? {...s, ...directionStyle} : s,
    dataSet: Object.assign({tooltip: title}, dataSet || {}),
    allowFontScaling,
    ...rest,
  }

  const text = (
    <UITextView {...shared}>
      {renderChildrenWithEmoji(children, shared, emoji ?? false)}
    </UITextView>
  )

  return IS_NATIVE ? (
    <NativeTextAncestorContext value={true}>{text}</NativeTextAncestorContext>
  ) : (
    text
  )
}

function createHeadingElement({level}: {level: number}) {
  return function HeadingElement({style, ...rest}: TextProps) {
    const attr =
      web({
        role: 'heading',
        'aria-level': level,
      }) || {}
    return <Text {...attr} {...rest} style={style} />
  }
}

/*
 * Use semantic components when it's beneficial to the user or to a web scraper
 */
export const H1 = createHeadingElement({level: 1})
export const H2 = createHeadingElement({level: 2})
export const H3 = createHeadingElement({level: 3})
export const H4 = createHeadingElement({level: 4})
export const H5 = createHeadingElement({level: 5})
export const H6 = createHeadingElement({level: 6})
export function P({style, ...rest}: TextProps) {
  const attr =
    web({
      role: 'paragraph',
    }) || {}
  return (
    <Text {...attr} {...rest} style={[a.text_md, a.leading_relaxed, style]} />
  )
}

/**
 * HACKFIX: React Native Web applies `overflow: hidden` to
 * text when using the `numberOfLines` prop, which causes it to clip
 * ascenders/descenders. It only needs to be doing this for the X axis,
 * so override the style with `overflowX: 'hidden'`.
 * Note this only works for `numberOfLines={1}` -sfn
 *
 * @see https://github.com/necolas/react-native-web/pull/2836
 */
const numberOfLinesClippingFix = {
  overflowY: 'visible',
  overflowX: 'clip',
  // mimic browser default behavior of `min-width: 0` on `overflow: hidden`
  // elements to allow text to shrink smaller than its intrinsic width when
  // necessary
  minWidth: 0,
  // this is neater and supports vertical writing modes, but it's only baseline newly available
  // overflowInline: 'clip',
} satisfies React.CSSProperties as TextStyleProp
