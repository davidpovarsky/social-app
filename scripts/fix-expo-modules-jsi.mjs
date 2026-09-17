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
    } else if (file.endsWith('.swift') || file === 'Package.swift') {
      results.push(filePath)
    }
  }
  return results
}

function patchFiles(baseDir) {
  if (!fs.existsSync(baseDir)) return
  const targetFiles = walk(baseDir)
  let patchedCount = 0

  for (const file of targetFiles) {
    let content = fs.readFileSync(file, 'utf8')
    const original = content

    if (path.basename(file) === 'Package.swift') {
      // 1. Force swift-tools-version to 6.0 for Xcode 16.2 compatibility
      content = content.replace(/swift-tools-version:\s*6\.[1-9]/g, 'swift-tools-version: 6.0')

      // 2. Remove experimental Swift 6.2 features not supported in Swift 6.0
      content = content.replace(/\.enableUpcomingFeature\("NonisolatedNonsendingByDefault"\),?/g, '// .enableUpcomingFeature("NonisolatedNonsendingByDefault"),')
      content = content.replace(/\.enableUpcomingFeature\("InferIsolatedConformances"\),?/g, '// .enableUpcomingFeature("InferIsolatedConformances"),')

      // 3. Remove trailing comma in targets array if present
      content = content.replace(/targets:\s*\["ExpoModulesJSI"\],/g, 'targets: ["ExpoModulesJSI"]')
    } else if (file.endsWith('.swift')) {
      // 1. In Swift 6 mode, weak properties must be declared with `nonisolated(unsafe) weak var`
      // to satisfy both mutability and Sendable conformance
      content = content.replace(/\b(?:nonisolated\(unsafe\)\s+)?weak\s+(?:let|var)\b/g, 'nonisolated(unsafe) weak var')

      // 2. Trailing commas before closing parenthesis in closure parameter lists
      content = content.replace(/,\s*\)\s*async\s+throws\s*->/g, '\n    ) async throws ->')
      content = content.replace(/_ arguments:\s*consuming\s*JavaScriptValuesBuffer,/g, '_ arguments: consuming JavaScriptValuesBuffer')

      // 3. Task.immediate polyfill fallback for compilers without SE-0472
      content = content.replace(/return Task\.immediate\([^)]*\)/g, 'return Task(name: name, priority: .high, operation: operation)')
    }

    if (content !== original) {
      try {
        fs.chmodSync(file, 0o666)
      } catch {}
      fs.writeFileSync(file, content, 'utf8')
      console.log(`[fix-expo-modules-jsi] Patched: ${file}`)
      patchedCount++
    }
  }

  console.log(`[fix-expo-modules-jsi] Completed patching ${patchedCount} files in ${baseDir}`)
}

const targetPath = path.resolve('node_modules')
patchFiles(targetPath)

