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
    } else if (file.endsWith('.swift') || file.endsWith('.h') || file === 'Package.swift') {
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
    const base = path.basename(file)

    if (base === 'Package.swift') {
      // 1. Force swift-tools-version to 6.0 for broad Swift compiler compatibility (6.0, 6.1, 6.2)
      content = content.replace(/swift-tools-version:\s*[0-9]+(\.[0-9]+)*/g, 'swift-tools-version: 6.0')

      // 2. Remove experimental upcoming features not supported across all Swift 6 versions
      content = content.replace(/\.enableUpcomingFeature\("NonisolatedNonsendingByDefault"\),?/g, '// .enableUpcomingFeature("NonisolatedNonsendingByDefault"),')
      content = content.replace(/\.enableUpcomingFeature\("InferIsolatedConformances"\),?/g, '// .enableUpcomingFeature("InferIsolatedConformances"),')

      // 3. Remove trailing comma in targets array if present
      content = content.replace(/targets:\s*\["ExpoModulesJSI"\],/g, 'targets: ["ExpoModulesJSI"]')
    } else if (base === 'RuntimeScheduler.h') {
      // Remove invalid SWIFT_RETURNS_RETAINED on C++ constructors for Swift 6.2 C++ interop
      content = content.replace(/SWIFT_RETURNS_RETAINED\s+RuntimeScheduler/g, 'RuntimeScheduler')

      // Add factory functions for Swift C++ interop
      if (!content.includes('createRuntimeScheduler')) {
        content = content.replace(
          '} // namespace expo',
          'inline RuntimeScheduler *createRuntimeScheduler() {\n  return new RuntimeScheduler();\n}\n\ninline RuntimeScheduler *createRuntimeScheduler(void *scheduler, RuntimeScheduler::ScheduleFn fn) {\n  return new RuntimeScheduler(scheduler, fn);\n}\n\n} // namespace expo'
        )
      }
    } else if (base === 'HostFunctionClosure.h') {
      // Add factory function for Swift C++ interop
      if (!content.includes('createHostFunctionClosure')) {
        content = content.replace(
          '} // namespace expo',
          'inline HostFunctionClosure *createHostFunctionClosure(\n    RetainedSwiftPointer::Context context,\n    HostFunctionClosure::Closure *closure,\n    RetainedSwiftPointer::Deallocator *deallocator) {\n  return new HostFunctionClosure(context, closure, deallocator);\n}\n\n} // namespace expo'
        )
      }
    } else if (file.endsWith('.swift')) {
      // 1. In Swift 6 mode, weak properties must be declared with `nonisolated(unsafe) weak var`
      // to satisfy both mutability and Sendable conformance
      content = content.replace(/\b(?:nonisolated\(unsafe\)\s+)?weak\s+(?:let|var)\b/g, 'nonisolated(unsafe) weak var')

      // 2. Trailing commas before closing parenthesis in closure parameter lists
      content = content.replace(/,\s*\)\s*async\s+throws\s*->/g, '\n    ) async throws ->')
      content = content.replace(/_ arguments:\s*consuming\s*JavaScriptValuesBuffer,/g, '_ arguments: consuming JavaScriptValuesBuffer')

      // 3. Task.immediate polyfill fallback for compilers without SE-0472
      content = content.replace(/return Task\.immediate\([^)]*\)/g, 'return Task(priority: priority ?? .high, operation: operation)')
      content = content.replace(/return Task\(name:\s*name,\s*priority:\s*\.high,\s*operation:\s*operation\)/g, 'return Task(priority: priority ?? .high, operation: operation)')

      // 4. JavaScriptCodable+Date.swift: Explicit JavaScriptValue.number call
      content = content.replace(/let millisecondsValue:\s*JavaScriptValue\s*=\s*\.number\(milliseconds\)/g, 'let millisecondsValue: JavaScriptValue = JavaScriptValue.number(milliseconds)')

      // 5. JavaScriptRuntime.swift: vector.push_back argument label
      content = content.replace(/vector\.push_back\(consuming:\s*propNameId\)/g, 'vector.push_back(propNameId)')

      // 6. JavaScriptRuntime.swift: use factory functions for C++ interop types
      content = content.replace(/expo\.RuntimeScheduler\(\)/g, 'expo.createRuntimeScheduler()')
      content = content.replace(/expo\.RuntimeScheduler\(scheduler,\s*fn\)/g, 'expo.createRuntimeScheduler(scheduler, fn)')
      content = content.replace(/expo\.HostFunctionClosure\(context,\s*call,\s*deallocate\)/g, 'expo.createHostFunctionClosure(context, call, deallocate)')
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


