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
  appview + '/xrpc/app.bsky.actor.getSuggestions?limit=20',
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
          await page.getByTestId('signInButton').click()
          await withinViewport(page, 'loginForm')
          await withinViewport(page, 'loginUsernameInput')
          await noHorizontalOverflow(page)
          await capture(page, name + '-login')
          await page.goto(base + '/profile/' + encodeURIComponent(actor.did), {
            waitUntil: 'domcontentloaded',
          })
          await withinViewport(page, 'profileView')
          await withinViewport(page, 'postText')
          await noHorizontalOverflow(page)
          await capture(page, name + '-profile')
          scenarios.push({name, passed: true})
        } catch (error) {
          await capture(page, name + '-failure').catch(() => {})
          scenarios.push({name, passed: false, error: String(error)})
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
