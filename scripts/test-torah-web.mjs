import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

const tools = process.env.TORAH_BROWSER_TOOLS
assert.ok(tools, 'TORAH_BROWSER_TOOLS must identify the pinned test tools')
const {chromium, webkit} = await import(
  pathToFileURL(path.join(tools, 'node_modules/playwright/index.mjs')).href
)
const base = process.env.TORAH_TEST_BASE_URL || 'http://127.0.0.1:8100'
const appview = process.env.EXPO_PUBLIC_TORAH_APPVIEW_HOST
assert.ok(appview, 'AppView must be explicitly configured')
const output = 'artifacts/web'
await fs.mkdir(output, {recursive: true})
for (let attempt = 0; ; attempt++) {
  try {
    const response = await fetch(base)
    if (response.ok) break
  } catch {}
  assert.ok(attempt < 60, 'Built web server did not become ready')
  await new Promise(resolve => setTimeout(resolve, 500))
}
const suggested = await fetch(
  appview + '/xrpc/app.bsky.actor.getSuggestions?limit=100',
).then(response => {
  assert.equal(response.status, 200)
  return response.json()
})
let actor
let actorPost
for (const candidate of suggested.actors ?? []) {
  const response = await fetch(
    appview +
      '/xrpc/app.bsky.feed.getAuthorFeed?limit=3&actor=' +
      encodeURIComponent(candidate.did),
  )
  if (response.ok) {
    const data = await response.json()
    if (data.feed?.length) {
      actor = candidate
      actorPost = data.feed[0].post
      break
    }
  }
}
assert.ok(
  actor,
  'An existing local account with content is required for live content validation',
)

const webOrigin = new URL(process.env.EXPO_PUBLIC_TORAH_WEB_HOST).origin
const postRkey = actorPost.uri.split('/').at(-1)
const metadataChecks = []
for (const [kind, route] of [
  ['home', '/'],
  ['profile', '/profile/' + encodeURIComponent(actor.did)],
  [
    'post',
    '/profile/' +
      encodeURIComponent(actor.did) +
      '/post/' +
      encodeURIComponent(postRkey),
  ],
]) {
  try {
    const response = await fetch(base + route)
    assert.equal(response.status, 200, kind + ' metadata document must load')
    const html = await response.text()
    const tags = [...html.matchAll(/<(?:link|meta)\b[^>]*>/gi)].map(match => {
      const attrs = {}
      for (const attr of match[0].matchAll(
        /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      )) {
        attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3]
      }
      return attrs
    })
    const canonical = tags.find(attrs => attrs.rel === 'canonical')?.href
    const openGraph = tags.find(attrs => attrs.property === 'og:url')?.content
    assert.ok(
      canonical && openGraph,
      kind + ' must expose canonical and Open Graph URLs',
    )
    assert.equal(
      new URL(canonical).origin,
      webOrigin,
      kind + ' canonical points outside Torah Social',
    )
    assert.equal(
      new URL(openGraph).href,
      new URL(canonical).href,
      kind + ' Open Graph URL must match its canonical URL',
    )
    if (kind === 'home') {
      const card = tags.find(attrs => attrs.property === 'og:image')?.content
      assert.ok(card, 'Home page must expose a social image')
      assert.equal(
        new URL(card).origin,
        webOrigin,
        'Home social image must use the configured site',
      )
    }
    if (kind === 'post') {
      assert.ok(
        new URL(canonical).pathname.endsWith('/post/' + postRkey),
        'Post metadata must identify the requested post',
      )
    }
    metadataChecks.push({kind, passed: true, canonical, openGraph})
  } catch (error) {
    metadataChecks.push({kind, passed: false, error: String(error)})
  }
}
await fs.writeFile(
  path.join(output, 'metadata-report.json'),
  JSON.stringify(metadataChecks, null, 2),
)
assert.ok(
  metadataChecks.every(check => check.passed),
  'Configured-origin metadata checks failed: ' + JSON.stringify(metadataChecks),
)

// Reuse an existing project test fixture; never create accounts or publish content.
const testActor = suggested.actors.find(candidate =>
  /^e2e-a-[0-9]+\./.test(candidate.handle),
)
assert.ok(testActor, 'An existing project e2e account is required')
const testRunId = testActor.handle.match(/^e2e-a-([0-9]+)\./)[1]
const seedScript = await fs.readFile('.github/scripts/run-torah-e2e.sh', 'utf8')
const passwordRecipe = seedScript.match(/^E2E_USER_A_PASSWORD=(["'])(.+)\1$/m)
assert.ok(
  passwordRecipe,
  'Existing e2e credential recipe must be a quoted literal',
)
const testPassword = passwordRecipe[2]
  .replaceAll('${E2E_RUN_ID}', testRunId)
  .replaceAll('$E2E_RUN_ID', testRunId)
assert.ok(
  !/[`$]/.test(testPassword),
  'Credential recipe must not require shell evaluation',
)
const hebrewCatalog = await fs.readFile(
  'src/locale/locales/he/messages.po',
  'utf8',
)
function uiLabel(message, locale) {
  if (!locale.startsWith('he')) return message
  const marker = 'msgid ' + JSON.stringify(message) + '\nmsgstr '
  const start = hebrewCatalog.indexOf(marker)
  assert.ok(start >= 0, 'Missing translation for ' + message)
  const value = hebrewCatalog.slice(start + marker.length).split('\n')[0]
  return JSON.parse(value) || message
}

const scenarios = []
const errors = []
const forbidden = []
const httpErrors = []
const expectedScenarios = 28
let abortedReason
async function capture(page, name) {
  await page.screenshot({
    path: path.join(output, name + '.png'),
    fullPage: true,
  })
}
async function withinViewport(page, testId) {
  return withinLocatorViewport(page, page.getByTestId(testId).first(), testId)
}
async function withinLocatorViewport(page, locator, name) {
  await locator.waitFor({state: 'visible', timeout: 30000})
  const box = await locator.boundingBox()
  assert.ok(box && box.width > 0, name + ' must have a visible box')
  const viewport = page.viewportSize()
  assert.ok(box.x >= -2, name + ' overflows the start edge: ' + box.x)
  assert.ok(
    box.x + box.width <= viewport.width + 2,
    name + ' overflows the end edge: ' + JSON.stringify(box),
  )
}
async function noHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  assert.ok(
    dimensions.content <= dimensions.viewport + 2,
    'Horizontal document overflow: ' + JSON.stringify(dimensions),
  )
}

function flattenSourceLines(value) {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  return Array.isArray(value) ? value.flatMap(flattenSourceLines) : []
}
async function inspectSourceReader(page, name, sourceDocuments) {
  await page
    .getByRole('button', {name: /^מקור: /})
    .first()
    .click()
  const reader = page.getByRole('dialog').last()
  await withinLocatorViewport(page, reader, 'torahSourceReader')
  let loaded
  const deadline = Date.now() + 30000
  while (!loaded && Date.now() < deadline) {
    for (const source of sourceDocuments) {
      for (const line of source.lines) {
        const passage = reader.getByText(line, {exact: true}).first()
        if (await passage.isVisible()) {
          loaded = {passage, ref: source.ref, characters: line.length}
          break
        }
      }
      if (loaded) break
    }
    if (!loaded) await page.waitForTimeout(250)
  }
  assert.ok(
    loaded,
    'Reader must display a substantial Hebrew passage returned by its real text API',
  )
  await withinLocatorViewport(page, loaded.passage, 'loadedHebrewPassage')
  const alignment = await loaded.passage.evaluate(element => {
    const style = getComputedStyle(element)
    return {align: style.textAlign, direction: style.direction}
  })
  assert.ok(
    alignment.align === 'right' ||
      (alignment.align === 'start' && alignment.direction === 'rtl') ||
      (alignment.align === 'end' && alignment.direction === 'ltr'),
    'Hebrew reader passage must align to the right: ' +
      JSON.stringify(alignment),
  )
  const dock = page.getByTestId('dockedPostPanel')
  await withinViewport(page, 'dockedPostPanel')
  const collapsed = await dock.boundingBox()
  await noHorizontalOverflow(page)
  await capture(page, name + '-source-reader')
  await page.getByRole('button', {name: 'הרחב פוסט מעוגן', exact: true}).click()
  await page.waitForFunction(
    height =>
      document
        .querySelector('[data-testid="dockedPostPanel"]')
        ?.getBoundingClientRect().height >
      height + 100,
    collapsed.height,
  )
  await withinViewport(page, 'dockedPostPanel')
  const expanded = await dock.boundingBox()
  assert.ok(
    expanded.height <= page.viewportSize().height + 2,
    'Expanded post must fit the viewport height',
  )
  await noHorizontalOverflow(page)
  await capture(page, name + '-expanded-source-post')
  await page.getByRole('button', {name: 'צמצם פוסט מעוגן', exact: true}).click()
  await page.waitForFunction(
    height =>
      document
        .querySelector('[data-testid="dockedPostPanel"]')
        ?.getBoundingClientRect().height <=
      height + 3,
    collapsed.height,
  )
  await page.keyboard.press('Escape')
  await reader.waitFor({state: 'hidden'})
  await dock.waitFor({state: 'detached'})
  return {ref: loaded.ref, characters: loaded.characters, alignment}
}

scenarioMatrix: for (const [engineName, engine] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await engine.launch({headless: true})
  try {
    for (const locale of ['he-IL', 'en-GB']) {
      for (const width of [320, 390, 768, 820, 1024, 1280, 1440]) {
        const name = engineName + '-' + locale + '-' + width
        const context = await browser.newContext({
          locale,
          viewport: {width, height: 1000},
          reducedMotion: 'reduce',
        })
        const page = await context.newPage()
        page.on('pageerror', error =>
          errors.push({scenario: name, error: error.message}),
        )
        page.on('request', request => {
          const url = new URL(request.url())
          if (
            /(^|\.)bsky\.(app|social|network)$/.test(url.hostname) &&
            ['fetch', 'xhr', 'websocket'].includes(request.resourceType())
          ) {
            forbidden.push({scenario: name, url: url.origin + url.pathname})
          }
        })
        page.on('response', response => {
          if (response.status() < 400 || httpErrors.length >= 500) return
          const request = response.request()
          if (!['fetch', 'xhr'].includes(request.resourceType())) return
          const url = new URL(response.url())
          httpErrors.push({
            scenario: name,
            status: response.status(),
            url: url.origin + url.pathname,
          })
        })

        const sourceDocuments = []
        page.on('response', response => {
          const url = new URL(response.url())
          if (
            !response.ok() ||
            !/(^|\.)sefaria\.org$/.test(url.hostname) ||
            !url.pathname.startsWith('/api/v3/texts/')
          )
            return
          response
            .json()
            .then(data => {
              const versions = data.versions ?? []
              const version =
                versions.find(item => item.language?.toLowerCase() === 'he') ??
                versions.find(item => item.language?.toLowerCase() === 'hebrew')
              const lines = flattenSourceLines(version?.text)
                .filter(line => line.length > 40 && /[א-ת]/.test(line))
                .slice(0, 8)
              if (lines.length) sourceDocuments.push({ref: data.ref, lines})
            })
            .catch(() => {})
        })

        let readerEvidence
        let authenticated = false
        let phase = 'welcome'
        try {
          await page.goto(base, {waitUntil: 'domcontentloaded'})
          const welcomeSignIn = page.getByRole('dialog').getByRole('button', {
            name: uiLabel('Sign in', locale),
            exact: true,
          })
          await withinLocatorViewport(page, welcomeSignIn, 'welcomeSignIn')
          const expectedDir = locale.startsWith('he') ? 'rtl' : 'ltr'
          await page.waitForFunction(
            dir => document.documentElement.dir === dir,
            expectedDir,
          )
          await noHorizontalOverflow(page)
          await capture(page, name + '-welcome')
          phase = 'login'
          await welcomeSignIn.click()
          await withinViewport(page, 'loginForm')
          await withinViewport(page, 'loginUsernameInput')
          await noHorizontalOverflow(page)
          await capture(page, name + '-login')
          if ([390, 820, 1280].includes(width)) {
            phase = 'authenticated-home'
            await page
              .getByTestId('loginUsernameInput')
              .fill(testActor.handle.split('.')[0])
            await page.getByTestId('loginPasswordInput').fill(testPassword)
            await page.getByTestId('loginNextButton').click()
            await withinViewport(page, 'HomeScreen')
            const later = page.getByRole('button', {
              name: uiLabel('Maybe later', locale),
              exact: true,
            })
            if (await later.isVisible()) await later.click()
            await withinViewport(page, 'postText')
            await noHorizontalOverflow(page)
            await capture(page, name + '-authenticated-home')
            authenticated = true
          }
          phase = 'profile'
          await page.goto(base + '/profile/' + encodeURIComponent(actor.did), {
            waitUntil: 'domcontentloaded',
          })
          await withinViewport(page, 'profileView')
          await withinViewport(page, 'postText')
          await noHorizontalOverflow(page)
          await capture(page, name + '-profile')

          if ([390, 820, 1280].includes(width)) {
            phase = 'source-reader'
            readerEvidence = await inspectSourceReader(
              page,
              name,
              sourceDocuments,
            )
          }

          if (authenticated) {
            phase = 'draft-composer'
            const fab = page.getByTestId('composeFAB')
            if (await fab.isVisible()) {
              await fab.click()
            } else {
              await page
                .getByRole('button', {
                  name: uiLabel('Compose new post', locale),
                  exact: true,
                })
                .click()
            }
            await withinViewport(page, 'composePostView')
            const editor = page
              .getByTestId('composePostView')
              .locator('[contenteditable="true"]')
              .first()
            await editor.fill(
              'בדיקת פריסה בעברית עם English ומספרים 1234567890 — '.repeat(4),
            )
            await withinViewport(page, 'composerPublishBtn')
            const textDimensions = await editor.evaluate(element => ({
              width: element.clientWidth,
              content: element.scrollWidth,
            }))
            assert.ok(
              textDimensions.content <= textDimensions.width + 2,
              'Draft text overflows its editor: ' +
                JSON.stringify(textDimensions),
            )
            await noHorizontalOverflow(page)
            await capture(page, name + '-draft-composer')
            phase = 'source-picker'
            await page
              .getByRole('button', {
                name: 'הוסף מקור תורני',
                exact: true,
              })
              .click()
            await withinViewport(page, 'torahSourceQueryInput')
            await noHorizontalOverflow(page)
            await capture(page, name + '-source-picker')

            phase = 'source-preview'
            await page.getByTestId('torahSourceQueryInput').fill('Genesis 1:1')
            await page
              .getByRole('button', {name: 'בדוק מקור', exact: true})
              .click()
            await withinViewport(page, 'torahAttachSourceBtn')
            await page.waitForFunction(() =>
              [...document.querySelectorAll('[role="dialog"]')].some(dialog =>
                dialog.textContent
                  .replace(/[^א-ת]/g, '')
                  .includes('בראשיתבראאלהים'),
              ),
            )
            await noHorizontalOverflow(page)
            await capture(page, name + '-source-preview')
          }
          scenarios.push({name, passed: true, authenticated, readerEvidence})
          console.log(
            JSON.stringify({scenario: name, passed: true, authenticated}),
          )
        } catch (error) {
          await capture(page, name + '-failure').catch(() => {})
          const visibleTestIds = await page
            .locator('[data-testid]:visible')
            .evaluateAll(elements =>
              [
                ...new Set(
                  elements.map(element => element.getAttribute('data-testid')),
                ),
              ].slice(0, 80),
            )
            .catch(() => [])
          console.log(
            JSON.stringify({
              scenario: name,
              passed: false,
              phase,
              visibleTestIds,
            }),
          )
          scenarios.push({
            name,
            passed: false,
            visibleTestIds,
            phase,
            authenticated,
            error: String(error).replaceAll(testPassword, '[redacted]'),
          })
          if (
            scenarios.filter(
              scenario => !scenario.passed && scenario.phase === phase,
            ).length >= 4
          ) {
            abortedReason =
              'Stopped after four failures in ' +
              phase +
              '; the remaining matrix is not validated'
            break scenarioMatrix
          }
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
}
const report = {
  commit: process.env.GITHUB_SHA,
  base,
  appview,
  actor: actor.did,
  expectedScenarios,
  abortedReason,
  metadataChecks,
  scenarios,
  errors,
  forbidden,
  httpErrors,
}
await fs.writeFile(
  path.join(output, 'report.json'),
  JSON.stringify(report, null, 2),
)
console.log(JSON.stringify(report))
assert.equal(
  scenarios.length,
  expectedScenarios,
  abortedReason || 'The full responsive matrix must complete',
)
assert.ok(
  scenarios.every(scenario => scenario.passed),
  'Responsive UI scenarios failed',
)
assert.equal(errors.length, 0, 'Client JavaScript errors occurred')
assert.equal(
  forbidden.length,
  0,
  'Client contacted a public Bluesky runtime service',
)
