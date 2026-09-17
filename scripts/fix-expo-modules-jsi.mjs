import fs from 'node:fs'
import path from 'node:path'

function walk(dir) {
  let results = []
  if (!fs.existsSync(dir)) return results
  const list = fs.readdirSync(dir)
  for (const file of list) {
    const filePath = path.join(dir, file)
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      results = results.concat(walk(filePath))
    } else if (file.endsWith('.swift')) {
      results.push(filePath)
    }
  }
  return results
}

function patchFiles(baseDir) {
  if (!fs.existsSync(baseDir)) return
  const swiftFiles = walk(baseDir)
  let patchedCount = 0

  for (const file of swiftFiles) {
    let content = fs.readFileSync(file, 'utf8')
    const original = content

    // 1. In Swift 6 mode, weak properties must be declared with `nonisolated(unsafe) weak var`
    // to satisfy both mutability and Sendable conformance
    content = content.replace(/\b(?:nonisolated\(unsafe\)\s+)?weak\s+(?:let|var)\b/g, 'nonisolated(unsafe) weak var')

    // 2. Trailing commas before closing parenthesis in closure parameter lists
    content = content.replace(/,\s*\)\s*async\s+throws\s*->/g, '\n    ) async throws ->')
    content = content.replace(/_ arguments:\s*consuming\s*JavaScriptValuesBuffer,/g, '_ arguments: consuming JavaScriptValuesBuffer')

    if (content !== original) {
      try {
        fs.chmodSync(file, 0o666)
      } catch {}
      fs.writeFileSync(file, content, 'utf8')
      console.log(`[fix-expo-modules-jsi] Patched: ${file}`)
      patchedCount++
    }
  }

  console.log(`[fix-expo-modules-jsi] Completed patching ${patchedCount} Swift files in ${baseDir}`)
}

const targetPath = path.resolve('node_modules')
patchFiles(targetPath)
