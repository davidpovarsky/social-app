import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'torah-isolation-'))
const paths = [
  'src/lib/constants.ts',
  'src/env/common.ts',
  'src/lib/react-query.tsx',
  'src/view/com/composer/Composer.tsx',
]
const env = {
  ...process.env,
  EXPO_PUBLIC_TORAH_APPVIEW_HOST: 'https://appview.torah.test',
  EXPO_PUBLIC_BLUESKY_PROXY_DID: 'did:key:zTorahTestAppView',
  EXPO_PUBLIC_TORAH_PDS_DID: 'did:web:pds.torah.test',
  EXPO_PUBLIC_TORAH_PDS_HOST: 'https://pds.torah.test',
  EXPO_PUBLIC_TORAH_WEB_HOST: 'https://torah.test',
}
function run(overrides = {}) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts/torah-isolate-client.mjs')],
    {
      cwd: directory,
      env: {...env, ...overrides},
      encoding: 'utf8',
    },
  )
}
try {
  for (const file of paths) {
    const target = path.join(directory, file)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.copyFileSync(path.join(root, file), target)
  }
  const before = fs.readFileSync(path.join(directory, paths[0]), 'utf8')
  assert.notEqual(run({EXPO_PUBLIC_TORAH_PDS_HOST: ''}).status, 0)
  assert.equal(fs.readFileSync(path.join(directory, paths[0]), 'utf8'), before)
  assert.notEqual(
    run({EXPO_PUBLIC_TORAH_APPVIEW_HOST: 'https://public.api.bsky.app'}).status,
    0,
  )
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const patched = fs.readFileSync(path.join(directory, paths[0]), 'utf8')
  for (const forbidden of [
    'https://public.api.bsky.app',
    'https://api.bsky.app',
    'https://api.bsky.chat',
    'https://video.bsky.app',
    'https://gifs.bsky.app',
    'https://embed.bsky.app',
  ]) {
    assert.ok(!patched.includes("'" + forbidden + "'"), forbidden)
  }
  assert.ok(
    patched.includes("PUBLIC_BSKY_SERVICE = 'https://appview.torah.test'"),
  )
  assert.ok(
    patched.includes("PUBLIC_APPVIEW_DID = 'did:key:zTorahTestAppView'"),
  )
  assert.ok(patched.includes('] = [TIMELINE_SAVED_FEED]'))
  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.equal(fs.readFileSync(path.join(directory, paths[0]), 'utf8'), patched)
  console.log(
    'PASS: isolated endpoints, required PDS, public-network rejection, idempotent build',
  )
} finally {
  fs.rmSync(directory, {recursive: true, force: true})
}
