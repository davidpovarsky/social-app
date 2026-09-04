import fs from 'node:fs'

const appviewHost = process.env.EXPO_PUBLIC_TORAH_APPVIEW_HOST
const appviewDid = process.env.EXPO_PUBLIC_BLUESKY_PROXY_DID
const pdsDid = process.env.EXPO_PUBLIC_TORAH_PDS_DID

for (const [name, value] of Object.entries({appviewHost, appviewDid, pdsDid})) {
  if (!value) throw new Error(`Missing required Torah isolation env: ${name}`)
}

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Torah isolation patch could not find: ${label}`)
  }
  return source.replace(before, after)
}

const constantsPath = 'src/lib/constants.ts'
let constants = fs.readFileSync(constantsPath, 'utf8')

constants = replaceRequired(
  constants,
  "export const BSKY_SERVICE_DID = 'did:web:bsky.social'",
  `export const BSKY_SERVICE_DID = '${pdsDid}'`,
  'BSKY_SERVICE_DID',
)
constants = replaceRequired(
  constants,
  "export const PUBLIC_BSKY_SERVICE = 'https://public.api.bsky.app'",
  `export const PUBLIC_BSKY_SERVICE = '${appviewHost}'`,
  'PUBLIC_BSKY_SERVICE',
)
constants = replaceRequired(
  constants,
  "export const PROD_DEFAULT_FEED = (rkey: string) =>\n  `at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/${rkey}`",
  `export const PROD_DEFAULT_FEED = (rkey: string) =>\n  \`at://${appviewDid}/app.bsky.feed.generator/\${rkey}\``,
  'PROD_DEFAULT_FEED',
)
// Keep these as literal strings rather than calling PROD_DEFAULT_FEED(). Several
// upstream feed descriptors rely on TypeScript retaining the `feedgen|${string}`
// template-literal type instead of widening the URI to plain `string`.
constants = replaceRequired(
  constants,
  "export const DISCOVER_FEED_URI =\n  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'",
  `export const DISCOVER_FEED_URI =\n  'at://${appviewDid}/app.bsky.feed.generator/whats-hot'`,
  'DISCOVER_FEED_URI',
)
constants = replaceRequired(
  constants,
  "export const VIDEO_FEED_URI =\n  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/thevids'",
  `export const VIDEO_FEED_URI =\n  'at://${appviewDid}/app.bsky.feed.generator/thevids'`,
  'VIDEO_FEED_URI',
)
constants = replaceRequired(
  constants,
  "] = [DISCOVER_SAVED_FEED, TIMELINE_SAVED_FEED]",
  '] = [TIMELINE_SAVED_FEED]',
  'RECOMMENDED_SAVED_FEEDS',
)
constants = replaceRequired(
  constants,
  "export const PUBLIC_APPVIEW = 'https://api.bsky.app'\nexport const PUBLIC_APPVIEW_DID = 'did:web:api.bsky.app'",
  `export const PUBLIC_APPVIEW = '${appviewHost}'\nexport const PUBLIC_APPVIEW_DID = '${appviewDid}'`,
  'PUBLIC_APPVIEW',
)

fs.writeFileSync(constantsPath, constants)

const reactQueryPath = 'src/lib/react-query.tsx'
let reactQuery = fs.readFileSync(reactQueryPath, 'utf8')
reactQuery = replaceRequired(
  reactQuery,
  "fetch('https://public.api.bsky.app/xrpc/_health', {",
  `fetch('${appviewHost}/xrpc/_health', {`,
  'network health AppView',
)
fs.writeFileSync(reactQueryPath, reactQuery)

// Keep the Torah-specific composer UI out of the upstream Composer.tsx source.
// The isolated build injects two deliberately tiny hooks at stable anchors:
// one visible source picker in the media toolbar and one area for automatic
// Sefaria reference suggestions immediately above that toolbar. If upstream
// moves either anchor, fail the build rather than silently shipping without the
// Torah controls.
const composerPath = 'src/view/com/composer/Composer.tsx'
let composer = fs.readFileSync(composerPath, 'utf8')
composer = replaceRequired(
  composer,
  "import {TextInput} from '#/view/com/composer/text-input/TextInput'",
  "import {TorahComposerExtensions} from '#/torah-social/composer/TorahComposerExtensions'\nimport {TorahComposerSourceButton} from '#/torah-social/composer/TorahComposerSourceButton'\nimport {TextInput} from '#/view/com/composer/text-input/TextInput'",
  'Torah composer imports',
)
composer = replaceRequired(
  composer,
  "      <ComposerFooter\n        post={activePost}",
  "      <TorahComposerExtensions\n        text={activePost.richtext.text}\n        disabled={!!activePost.embed.link || !!activePost.embed.media}\n        onSelectUri={uri =>\n          dispatch({type: 'embed_add_uri', uri: uri as UriString})\n        }\n      />\n      <ComposerFooter\n        post={activePost}",
  'Torah detected-source suggestions',
)
composer = replaceRequired(
  composer,
  "              <SelectGifBtn onSelectGif={onSelectGif} disabled={!!media} />\n              {IS_WEB && gtPhone ? (",
  "              <SelectGifBtn onSelectGif={onSelectGif} disabled={!!media} />\n              <TorahComposerSourceButton\n                disabled={!!media || !!post.embed.link}\n                onSelectUri={uri =>\n                  dispatch({type: 'embed_add_uri', uri: uri as UriString})\n                }\n              />\n              {IS_WEB && gtPhone ? (",
  'Torah source toolbar button',
)
fs.writeFileSync(composerPath, composer)

// Fail the isolated build if the main application source still has a direct
// public AppView endpoint capable of serving Bluesky content. References in
// comments/tests/embeds are outside the main app bundle and are intentionally
// not part of this check.
for (const file of [constantsPath, reactQueryPath]) {
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes("'https://public.api.bsky.app'")) {
    throw new Error(`Public Bluesky AppView still present in ${file}`)
  }
}

console.log(`Torah client isolation applied: ${appviewHost} (${appviewDid})`)
console.log('Torah composer hooks applied: Sefaria toolbar + detected references')
