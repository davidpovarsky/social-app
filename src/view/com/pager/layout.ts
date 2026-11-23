/**
 * The native tab strip keeps physical scroll coordinates LTR while arranging
 * RTL items in reverse order. This gives both platforms the same positive
 * contentOffset/scrollTo coordinate system.
 */
export function getTabBarItemScrollOffset({
  index,
  itemCount,
  layout,
  contentWidth,
  containerWidth,
  contentPadding,
  rtl,
}: {
  index: number
  itemCount: number
  layout?: {x: number; width: number}
  contentWidth: number
  containerWidth: number
  contentPadding: number
  rtl: boolean
}) {
  'worklet'
  const availableWidth = containerWidth - 2 * contentPadding
  const maxOffset = Math.max(0, contentWidth - availableWidth)
  const fraction = itemCount > 1 ? index / (itemCount - 1) : 0
  const physicalFraction = rtl ? 1 - fraction : fraction
  if (!layout) return physicalFraction * maxOffset
  if (maxOffset === 0) return 0

  const freeSpace = availableWidth - layout.width
  return Math.min(
    Math.max(layout.x - physicalFraction * freeSpace, 0),
    maxOffset,
  )
}
