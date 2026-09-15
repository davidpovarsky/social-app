// Unit tests for Torah quote parsing, formatting, and embed detection

const TORAH_QUOTE_REGEX =
  /(?:^|\n)>\s*(?:״([^״\n]+)״|"([^"\n]+)"|([^\n(]+))?\s*(?:\n|\s)*\(?(?:📖\s*)?([^·\n)]+)?(?:\s*·\s*)?(https?:\/\/(?:www\.)?sefaria\.org\/[^\s)]+)\)?/g

function hasTorahQuoteBlock(text) {
  if (!text || typeof text !== 'string') return false
  if (!text.includes('sefaria.org')) return false
  TORAH_QUOTE_REGEX.lastIndex = 0
  return TORAH_QUOTE_REGEX.test(text)
}

function parseTorahQuoteBlocks(text) {
  const blocks = []
  let lastIndex = 0
  TORAH_QUOTE_REGEX.lastIndex = 0

  let match
  while ((match = TORAH_QUOTE_REGEX.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = TORAH_QUOTE_REGEX.lastIndex

    if (matchStart > lastIndex) {
      const beforeText = text.slice(lastIndex, matchStart).trim()
      if (beforeText) {
        blocks.push({type: 'text', content: beforeText})
      }
    }

    const quote = (match[1] || match[2] || match[3] || '').trim()
    const refName = (match[4] || '').trim()
    const uri = match[5].trim()

    blocks.push({
      type: 'quote',
      quote,
      refName: refName || undefined,
      uri,
    })

    lastIndex = matchEnd
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining) {
      blocks.push({type: 'text', content: remaining})
    }
  }

  return blocks
}

function cleanSefariaUri(uri) {
  return uri.replace(/#no-image/g, '').replace(/(\?|&)noimg=1/g, '')
}

function hasNoImageParam(uri) {
  return uri.includes('#no-image') || uri.includes('noimg=1')
}

function buildSefariaSourceUri(baseUri, includeImage = true) {
  const clean = cleanSefariaUri(baseUri)
  return includeImage ? clean : `${clean}#no-image`
}

function isSefariaSourceUri(uri) {
  try {
    const url = new URL(uri)
    const host = url.hostname.toLowerCase()
    if (!host.includes('sefaria.org')) return false
    return url.pathname.length > 1
  } catch {
    return false
  }
}

function isSefariaEmbed(embed) {
  if (!embed || typeof embed !== 'object') return false
  if (
    embed.$type === 'app.bsky.embed.external#view' &&
    typeof embed.external?.uri === 'string'
  ) {
    return isSefariaSourceUri(embed.external.uri)
  }
  return false
}

function formatTorahQuoteForInsertion(source) {
  const preview = source.preview ? `״${source.preview.trim()}״\n` : ''
  const cleanUri = cleanSefariaUri(source.uri)
  const ref = source.heRef || source.ref || 'מקור'
  return `\n> ${preview}(📖 ${ref} · ${cleanUri})\n`
}

// 1. Test standard formatting and parsing
const source = {
  ref: 'Genesis 1:1',
  heRef: 'בראשית א׳:א׳',
  uri: 'https://www.sefaria.org/Genesis.1.1',
  preview: 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃',
}

const formatted = formatTorahQuoteForInsertion(source)
console.log('Formatted quote output:\n', formatted)

const samplePost = `שלום לכולם! הנה פתיחת התורה:${formatted}שבוע טוב!`
console.log('Sample post has quote block:', hasTorahQuoteBlock(samplePost))
const blocks = parseTorahQuoteBlocks(samplePost)
console.log('Parsed blocks count:', blocks.length)
if (blocks.length !== 3) throw new Error('Expected 3 blocks')
if (blocks[1].type !== 'quote') throw new Error('Block 1 must be quote')
if (blocks[1].refName !== 'בראשית א׳:א׳') throw new Error('Unexpected refName')
if (blocks[1].uri !== 'https://www.sefaria.org/Genesis.1.1') throw new Error('Unexpected uri')

// 2. Test URL image toggle functions
const uriWithImg = buildSefariaSourceUri('https://www.sefaria.org/Genesis.1.1', true)
const uriNoImg = buildSefariaSourceUri('https://www.sefaria.org/Genesis.1.1', false)
if (hasNoImageParam(uriWithImg)) throw new Error('uriWithImg should not have no-image')
if (!hasNoImageParam(uriNoImg)) throw new Error('uriNoImg must have no-image')
if (cleanSefariaUri(uriNoImg) !== 'https://www.sefaria.org/Genesis.1.1') throw new Error('cleanSefariaUri failed')

// 3. Test isSefariaEmbed
const sefariaEmbed = {
  $type: 'app.bsky.embed.external#view',
  external: {uri: 'https://www.sefaria.org/Genesis.1.1#no-image'},
}
const normalEmbed = {
  $type: 'app.bsky.embed.external#view',
  external: {uri: 'https://nytimes.com/article'},
}
if (!isSefariaEmbed(sefariaEmbed)) throw new Error('sefariaEmbed must be recognized')
if (isSefariaEmbed(normalEmbed)) throw new Error('normalEmbed must not be recognized')

console.log('ALL EXTENDED TORAH QUOTE AND EMBED TESTS PASSED!')
