/**
 * React Native Web sets `dir="auto"` on root Text elements, so the browser
 * handles direction detection without JavaScript.
 */
export function isRTLText(_text: string) {
  return false
}

/** Preserve the existing physical alignment in the browser. */
export function getPhysicalTextAlignStyle(textAlign: 'left' | 'right') {
  return {textAlign}
}

/** Root web Text already uses dir="auto" for each paragraph. */
export function getRichTextDirectionStyle(_text: string) {
  return undefined
}
