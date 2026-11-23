import {type AppLayoutDirection} from '#/locale/layoutDirection'
import {
  CENTER_COLUMN_OFFSET,
  CENTER_COLUMN_WIDTH,
  SCROLLBAR_OFFSET,
  SCROLLBAR_OFFSET_POSITIVE,
} from '#/components/Layout/const'

/**
 * Positions measured from logical start need physical transforms with the
 * matching sign. Yoga/RNW mirror start/end, but never translateX.
 */
export function getShellLayout(
  direction: AppLayoutDirection,
  centerColumnOffset: boolean,
) {
  const rtl = direction === 'rtl'
  const sign = rtl ? -1 : 1
  const offset = centerColumnOffset ? CENTER_COLUMN_OFFSET : 0

  return {
    sign,
    columnOffset: offset === 0 ? 0 : sign * offset,
    centerTranslate: rtl ? ('50%' as const) : ('-50%' as const),
    startNavOffset: sign * (-CENTER_COLUMN_WIDTH / 2 + offset),
    startNavTranslate: rtl ? ('100%' as const) : ('-100%' as const),
    endNavOffset: sign * (CENTER_COLUMN_WIDTH / 2 + offset),
    scrollbarOffset: rtl ? SCROLLBAR_OFFSET_POSITIVE : SCROLLBAR_OFFSET,
  }
}
