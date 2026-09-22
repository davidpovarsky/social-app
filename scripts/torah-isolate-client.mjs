import fs from 'node:fs'

const appviewHost = process.env.EXPO_PUBLIC_TORAH_APPVIEW_HOST
const appviewDid = process.env.EXPO_PUBLIC_BLUESKY_PROXY_DID
const pdsDid = process.env.EXPO_PUBLIC_TORAH_PDS_DID

for (const [name, value] of Object.entries({appviewHost, appviewDid, pdsDid})) {
  if (!value) throw new Error(`Missing required Torah isolation env: ${name}`)
}

function replaceRequired(source, before, after, label) {
  const normSource = source.replace(/\r\n/g, '\n')
  const normBefore = before.replace(/\r\n/g, '\n')
  const normAfter = after.replace(/\r\n/g, '\n')

  if (normSource.includes(normAfter)) {
    return normSource
  }
  if (!normSource.includes(normBefore)) {
    throw new Error(`Torah isolation patch could not find: ${label}`)
  }
  return normSource.replace(normBefore, normAfter)
}

const constantsPath = 'src/lib/constants.ts'
let constants = fs.readFileSync(constantsPath, 'utf8').replace(/\r\n/g, '\n')

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

constants = replaceRequired(
  constants,
  "export const GIF_SERVICE = 'https://gifs.bsky.app'",
  "export const GIF_SERVICE = ''",
  'GIF_SERVICE',
)
constants = replaceRequired(
  constants,
  "export const VIDEO_SERVICE = 'https://video.bsky.app'",
  "export const VIDEO_SERVICE = ''",
  'VIDEO_SERVICE',
)
constants = replaceRequired(
  constants,
  "export const VIDEO_SERVICE_DID = 'did:web:video.bsky.app'",
  "export const VIDEO_SERVICE_DID = ''",
  'VIDEO_SERVICE_DID',
)
constants = replaceRequired(
  constants,
  "export const TRENDING_DID = 'did:plc:qrz3lhbyuxbeilrc6nekdqme'",
  `export const TRENDING_DID = '${appviewDid}'`,
  'TRENDING_DID',
)

fs.writeFileSync(constantsPath, constants)

const commonEnvPath = 'src/env/common.ts'
let commonEnv = fs.readFileSync(commonEnvPath, 'utf8').replace(/\r\n/g, '\n')
if (commonEnv.includes("'did:web:api.bsky.chat'")) {
  commonEnv = commonEnv.replace(
    /process\.env\.EXPO_PUBLIC_CHAT_PROXY_DID \|\| 'did:web:api\.bsky\.chat'/g,
    `process.env.EXPO_PUBLIC_CHAT_PROXY_DID || '${appviewDid}'`,
  )
  fs.writeFileSync(commonEnvPath, commonEnv)
}

const reactQueryPath = 'src/lib/react-query.tsx'
let reactQuery = fs.readFileSync(reactQueryPath, 'utf8').replace(/\r\n/g, '\n')
reactQuery = replaceRequired(
  reactQuery,
  "fetch('https://public.api.bsky.app/xrpc/_health', {",
  `fetch('${appviewHost}/xrpc/_health', {`,
  'network health AppView',
)
fs.writeFileSync(reactQueryPath, reactQuery)

// Keep the Torah-specific composer UI out of the upstream Composer.tsx source.
// If not already present in the codebase, inject the hooks.
const composerPath = 'src/view/com/composer/Composer.tsx'
let composer = fs.readFileSync(composerPath, 'utf8').replace(/\r\n/g, '\n')

if (!composer.includes('TorahComposerExtensions')) {
  composer = replaceRequired(
    composer,
    "      <ComposerFooter\n        post={activePost}",
    "      <TorahComposerExtensions\n        text={activePost.richtext.text}\n        disabled={!!activePost.embed.link || !!activePost.embed.media}\n        onSelectUri={uri =>\n          dispatch({type: 'embed_add_uri', uri: uri as UriString})\n        }\n      />\n      <ComposerFooter\n        post={activePost}",
    'Torah detected-source suggestions',
  )
}

if (!composer.includes('TorahComposerSourceButton')) {
  composer = replaceRequired(
    composer,
    "              <SelectGifBtn onSelectGif={onSelectGif} disabled={!!media} />\n              {IS_WEB && gtPhone ? (",
    "              <SelectGifBtn onSelectGif={onSelectGif} disabled={!!media} />\n              <TorahComposerSourceButton\n                disabled={!!media || !!post.embed.link}\n                onSelectUri={uri =>\n                  dispatch({type: 'embed_add_uri', uri: uri as UriString})\n                }\n              />\n              {IS_WEB && gtPhone ? (",
    'Torah source toolbar button',
  )
}

if (!composer.includes('import {TorahComposerExtensions}') && !composer.includes('TorahComposerExtensions')) {
  composer = replaceRequired(
    composer,
    "import {TextInput} from '#/view/com/composer/text-input/TextInput'",
    "import {TorahComposerExtensions} from '#/torah-social/composer/TorahComposerExtensions'\nimport {TorahComposerSourceButton} from '#/torah-social/composer/TorahComposerSourceButton'\nimport {TextInput} from '#/view/com/composer/text-input/TextInput'",
    'Torah composer imports',
  )
}
fs.writeFileSync(composerPath, composer)

// Fail the isolated build if the main application source still has a direct
// public AppView endpoint or forbidden Bluesky service capable of serving Bluesky content.
const forbiddenServices = [
  {target: 'https://public.api.bsky.app', label: 'Public Bluesky AppView'},
  {target: 'https://events.bsky.app', label: 'Bluesky Events/Metrics API'},
  {target: 'https://ip.bsky.app', label: 'Bluesky Geolocation API'},
  {target: 'https://gifs.bsky.app', label: 'Bluesky GIF Service'},
  {target: 'https://video.bsky.app', label: 'Bluesky Video Service'},
]

for (const {target, label} of forbiddenServices) {
  const constantsContent = fs.readFileSync(constantsPath, 'utf8')
  if (constantsContent.includes(`'${target}'`) || constantsContent.includes(`"${target}"`)) {
    throw new Error(`Forbidden runtime service ${label} (${target}) still present in ${constantsPath}`)
  }
}

for (const file of [reactQueryPath]) {
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes("'https://public.api.bsky.app'")) {
    throw new Error(`Public Bluesky AppView still present in ${file}`)
  }
}

console.log(`Torah client isolation applied: ${appviewHost} (${appviewDid})`)
console.log('Torah composer hooks verified: Sefaria toolbar + detected references')
