import {type TextStyle} from 'react-native'
import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

/**
 * UIKit's natural paragraph direction can keep following the device language
 * after the app language changes. Give otherwise unspecified interface text
 * an explicit physical reading edge. Caller-controlled paragraphs and nested
 * spans keep their existing alignment and inheritance.
 */
export function getInterfaceTextDirectionStyle(
  appDirection: 'ltr' | 'rtl',
  style: Pick<TextStyle, 'direction' | 'writingDirection' | 'textAlign'>,
): Pick<TextStyle, 'direction' | 'writingDirection' | 'textAlign'> | undefined {
  if (style.direction || style.writingDirection || style.textAlign) {
    return undefined
  }

  return {
    ...getPhysicalTextAlignStyle(appDirection === 'rtl' ? 'right' : 'left'),
    writingDirection: appDirection,
  }
}

/**
 * Checks the first strong directional character, matching HTML `dir="auto"`.
 */
export function isRTLText(text: string) {
  for (const character of text) {
    const type = bidi.getBidiCharTypeName(character)

    if (type === 'R' || type === 'AL') return true
    if (type === 'L') return false
  }

  return false
}

/**
 * RN Text mirrors left/right alignment with the paragraph's Yoga direction.
 * Selectable iOS UITextView keeps those values physical instead. Isolate the
 * text node's layout direction so an explicit physical edge works in both.
 * writingDirection remains independent and still controls the text's bidi flow.
 */
export function getPhysicalTextAlignStyle(textAlign: 'left' | 'right') {
  return {direction: 'ltr' as const, textAlign}
}

/**
 * Keep post paragraphs independent of the surrounding interface direction.
 * Preserve caller alignment for LTR text, including centered emoji blocks.
 */
export function getRichTextDirectionStyle(text: string) {
  const rtl = isRTLText(text)
  return {
    direction: 'ltr' as const,
    writingDirection: rtl ? ('rtl' as const) : ('ltr' as const),
    ...(rtl ? {textAlign: 'right' as const} : {}),
  }
}
