import {useMemo} from 'react'
import {View} from 'react-native'

import {atoms as a} from '#/alf'
import {parseTorahQuoteBlocks} from './quoteBlock'
import {TorahQuoteBlock} from './TorahQuoteBlock'

export function TorahRichTextBlocks({
  text,
  renderText,
}: {
  text: string
  renderText: (content: string) => React.ReactNode
}) {
  const blocks = useMemo(() => parseTorahQuoteBlocks(text), [text])

  return (
    <View style={[a.w_full, a.gap_2xs]}>
      {blocks.map((block, i) => {
        if (block.type === 'quote') {
          return (
            <TorahQuoteBlock
              key={`quote-${i}-${block.uri}`}
              quote={block.quote}
              refName={block.refName}
              uri={block.uri}
            />
          )
        }
        return <View key={`text-${i}`}>{renderText(block.content)}</View>
      })}
    </View>
  )
}
