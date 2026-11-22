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
for (const candidate of suggested.actors ?? []) {
  const response = await fetch(
    appview +
      '/xrpc/app.bsky.feed.getAuthorFeed?limit=3&actor=' +
      encodeURIComponent(candidate.did),
  )
  if (response.ok && (await response.json()).feed?.length) {
    actor = candidate
    break
  }
}
assert.ok(
  actor,
  'An existing local account with content is required for live content validation',
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
async function capture(page, name) {
  await page.screenshot({
    path: path.join(output, name + '.png'),
    fullPage: true,
  })
}
async function withinViewport(page, testId) {
  const locator = page.getByTestId(testId).first()
  await locator.waitFor({state: 'visible', timeout: 30000})
  const box = await locator.boundingBox()
  assert.ok(box && box.width > 0, testId + ' must have a visible box')
  const viewport = page.viewportSize()
  assert.ok(box.x >= -2, testId + ' overflows the start edge: ' + box.x)
  assert.ok(
    box.x + box.width <= viewport.width + 2,
    testId + ' overflows the end edge: ' + JSON.stringify(box),
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
for (const [engineName, engine] of [
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
        let authenticated = false
        let phase = 'welcome'
        try {
          await page.goto(base, {waitUntil: 'domcontentloaded'})
          await withinViewport(page, 'signInButton')
          const expectedDir = locale.startsWith('he') ? 'rtl' : 'ltr'
          await page.waitForFunction(
            dir => document.documentElement.dir === dir,
            expectedDir,
          )
          await noHorizontalOverflow(page)
          await capture(page, name + '-welcome')
          phase = 'login'
          await page.getByTestId('signInButton').click()
          await withinViewport(page, 'loginForm')
          await withinViewport(page, 'loginUsernameInput')
          await noHorizontalOverflow(page)
          await capture(page, name + '-login')
          if ([390, 820, 1280].includes(width)) {
            phase = 'authenticated-home'
            await page.getByTestId('loginUsernameInput').fill(testActor.handle)
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
          }
          scenarios.push({name, passed: true, authenticated})
        } catch (error) {
          await capture(page, name + '-failure').catch(() => {})
          scenarios.push({
            name,
            passed: false,
            phase,
            authenticated,
            error: String(error),
          })
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
  scenarios,
  errors,
  forbidden,
}
await fs.writeFile(
  path.join(output, 'report.json'),
  JSON.stringify(report, null, 2),
)
console.log(JSON.stringify(report))
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
