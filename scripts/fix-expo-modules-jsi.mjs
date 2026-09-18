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
    } else if (file.endsWith('.swift') || file.endsWith('.h') || file.endsWith('.m') || file.endsWith('.mm') || file === 'Package.swift' || file.endsWith('.podspec')) {
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

    if (base.endsWith('.podspec')) {
      // Align Swift version specification for CocoaPods pod targets
      content = content.replace(/s\.swift_version\s*=\s*['"]6\.0['"]/g, "s.swift_version = '5.0'")
    } else if (base === 'Package.swift') {
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
          'inline SWIFT_RETURNS_RETAINED RuntimeScheduler *createRuntimeScheduler() {\n  return new RuntimeScheduler();\n}\n\ninline SWIFT_RETURNS_RETAINED RuntimeScheduler *createRuntimeScheduler(void *scheduler, RuntimeScheduler::ScheduleFn fn) {\n  return new RuntimeScheduler(scheduler, fn);\n}\n\n} // namespace expo'
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
    } else if (base === 'HostObjectCallbacks.h') {
      // Add C++ bridge helper for move-only PropNameID vector appending
      if (!content.includes('<string>')) {
        content = content.replace('#include <jsi/jsi.h>', '#include <jsi/jsi.h>\n#include <string>')
      }
      if (!content.includes('appendPropNameId')) {
        content = content.replace(
          '} // namespace expo',
          'inline void appendPropNameId(\n    HostObjectCallbacks::PropNameIds &vector,\n    facebook::jsi::Runtime &runtime,\n    const std::string &name) {\n  vector.push_back(facebook::jsi::PropNameID::forUtf8(runtime, name));\n}\n\ninline void appendPropNameId(\n    HostObjectCallbacks::PropNameIds &vector,\n    facebook::jsi::IRuntime &runtime,\n    const std::string &name) {\n  vector.push_back(facebook::jsi::PropNameID::forUtf8(runtime, name));\n}\n\ninline void appendPropNameId(\n    HostObjectCallbacks::PropNameIds &vector,\n    facebook::jsi::Runtime &runtime,\n    const char *name) {\n  vector.push_back(facebook::jsi::PropNameID::forUtf8(runtime, std::string(name)));\n}\n\n} // namespace expo'
        )
      }
    } else if (base === 'RNCPagerViewComponentView.mm' || base === 'RNCPagerView.m') {
      if (!content.includes('iOS26PopGesture')) {
        content = content.replace(
          /@interface\s+RNCPagerView/g,
          '#import <UIKit/UIKit.h>\n\n@interface UINavigationController (iOS26PopGesture)\n@property (nonatomic, readonly, nullable) UIGestureRecognizer *interactiveContentPopGestureRecognizer;\n@end\n\n@interface RNCPagerView'
        )
      }
    } else if (base === 'SwiftUIHostingView.swift') {
      if (!content.includes('@MainActor\ninternal protocol AnyExpoSwiftUIHostingView')) {
        content = content.replace(/\binternal\s+protocol\s+AnyExpoSwiftUIHostingView\b/g, '@MainActor\ninternal protocol AnyExpoSwiftUIHostingView')
      }
      content = content.replace(/:\s*ExpoView,\s*@MainActor\s+AnyExpoSwiftUIHostingView\b/g, ': ExpoView, AnyExpoSwiftUIHostingView')
    } else if (base === 'ExpoSwiftUI.swift') {
      if (!content.includes('@MainActor\n  public protocol ViewWrapper')) {
        content = content.replace(/\bpublic\s+protocol\s+ViewWrapper\b/g, '@MainActor\n  public protocol ViewWrapper')
      }
    } else if (base === 'SwiftUIVirtualView.swift') {
      content = content.replace(/,\s*@MainActor\s+ExpoSwiftUIView\b/g, ', ExpoSwiftUIView')
      if (!content.includes('@MainActor\n  final class SwiftUIVirtualView<')) {
        content = content.replace(/(^\s*final\s+class\s+SwiftUIVirtualView\b)/gm, '  @MainActor\n$1')
      }
      if (!content.includes('@MainActor\n  final class SwiftUIVirtualViewDev<')) {
        content = content.replace(/(^\s*final\s+class\s+SwiftUIVirtualViewDev\b)/gm, '  @MainActor\n$1')
      }
      content = content.replace(/extension\s+ExpoSwiftUI\.SwiftUIVirtualView:\s*@MainActor\s+ExpoSwiftUI\.ViewWrapper\b/g, 'extension ExpoSwiftUI.SwiftUIVirtualView: ExpoSwiftUI.ViewWrapper')
      content = content.replace(/extension\s+ExpoSwiftUI\.SwiftUIVirtualViewDev:\s*@MainActor\s+ExpoSwiftUI\.ViewWrapper\b/g, 'extension ExpoSwiftUI.SwiftUIVirtualViewDev: ExpoSwiftUI.ViewWrapper')
    } else if (base === 'SwiftUIViewDefinition.swift') {
      content = content.replace(
        /let content = hostingUIView\.getContentView\(\)/g,
        'let content = MainActor.assumeIsolated { hostingUIView.getContentView() }'
      )
    } else if (base === 'ViewDefinition.swift') {
      if (!content.includes('@MainActor\nextension UIView: AnyArgument')) {
        content = content.replace(/extension\s+UIView:\s*@MainActor\s+AnyArgument\b/g, '@MainActor\nextension UIView: AnyArgument')
      }
    } else if (base === 'Utilities.swift') {
      content = content.replace(/internal func performSynchronouslyOnMainThread<Result>\(_ closure: \(\) throws -> Result\) rethrows -> Result/g, 'internal func performSynchronouslyOnMainThread<Result>(_ closure: @MainActor () throws -> Result) rethrows -> Result')
      content = content.replace(/if Thread\.isMainThread \{\s*return try closure\(\)\s*\}/g, 'if Thread.isMainThread {\n    return try MainActor.assumeIsolated(closure)\n  }')
    } else if (base === 'ExpoReactDelegate.swift') {
      content = content.replace(/\.first\(where:\s*\{\s*_\s*in\s*true\s*\}\)\s*\?\?\s*UIViewController\(\)/g, '.first(where: { _ in true }) ?? MainActor.assumeIsolated { UIViewController() }')
    } else if (base === 'PersistentFileLog.swift') {
      content = content.replace(/public typealias PersistentFileLogFilter\s*=\s*\(String\)\s*->\s*Bool/g, 'public typealias PersistentFileLogFilter = @Sendable (String) -> Bool')
    } else if (base === 'SwiftUIViewFrameObserver.swift') {
      content = content.replace(/callback\(CGRect\(origin:\s*view\.frame\.origin,\s*size:\s*newValue\.size\)\)/g, 'let origin = MainActor.assumeIsolated { view.frame.origin }\n        callback(CGRect(origin: origin, size: newValue.size))')
    } else if (base === 'URLAuthenticationChallengeForwardSender.swift') {
      content = content.replace(/let completionHandler:\s*\(URLSession\.AuthChallengeDisposition,\s*URLCredential\?\)\s*->\s*Void/g, 'let completionHandler: @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void')
      content = content.replace(/init\(completionHandler:\s*@escaping\s*\(URLSession\.AuthChallengeDisposition,\s*URLCredential\?\)\s*->\s*Void\)/g, 'init(completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void)')
    } else if (base === 'URLSessionSessionDelegateProxy.swift') {
      content = content.replace(/public final class URLSessionSessionDelegateProxy:\s*NSObject,\s*URLSessionDataDelegate\s*\{/g, 'public final class URLSessionSessionDelegateProxy: NSObject, URLSessionDataDelegate, @unchecked Sendable {')
    } else if (base === 'Tracks.swift') {
      content = content.replace(/let trackUrl = assetVariant\.url/g, 'let trackUrl = mainUrl')
    } else if (base === 'ExpoScrollEdgeEffectView.swift') {
      content = `import ExpoModulesCore\nimport UIKit\n\nclass ExpoScrollEdgeEffectView: ExpoView {\n  var scrollViewTag: Int?\n  var edge: String = "top"\n  var effect: String = "automatic"\n\n  required init(appContext: AppContext? = nil) {\n    super.init(appContext: appContext)\n  }\n}\n`
    }

    // Defensive cleanup of any duplicate @MainActor annotations
    content = content.replace(/@MainActor\s*@MainActor/g, '@MainActor')

    if (file.endsWith('.swift')) {
      // 1. Weak properties must be declared as `weak var`, not `weak let`
      content = content.replace(/\bweak\s+let\b/g, 'weak var')

      // In expo-modules-jsi, satisfy mutability and Sendable conformance
      if (file.includes('expo-modules-jsi')) {
        content = content.replace(/\b(?:nonisolated\(unsafe\)\s+)?weak\s+(?:let|var)\b/g, 'nonisolated(unsafe) weak var')
      }

      // 2. Trailing commas before closing parenthesis in closure parameter lists
      content = content.replace(/,\s*\)\s*async\s+throws\s*->/g, '\n    ) async throws ->')
      content = content.replace(/_ arguments:\s*consuming\s*JavaScriptValuesBuffer,/g, '_ arguments: consuming JavaScriptValuesBuffer')

      // 3. Task.immediate polyfill fallback for compilers without SE-0472
      content = content.replace(/return Task\.immediate\([^)]*\)/g, 'return Task(priority: priority ?? .high, operation: operation)')
      content = content.replace(/return Task\(name:\s*name,\s*priority:\s*\.high,\s*operation:\s*operation\)/g, 'return Task(priority: priority ?? .high, operation: operation)')

      // 4. JavaScriptCodable+Date.swift: Explicit JavaScriptValue.number call and idempotent milliseconds.magnitude
      content = content.replace(/let millisecondsValue:\s*JavaScriptValue\s*=\s*\.number\(milliseconds\)/g, 'let millisecondsValue: JavaScriptValue = JavaScriptValue.number(milliseconds)')
      content = content.replace(/(?:Swift\.)*abs\(milliseconds\)/g, 'milliseconds.magnitude')

      // 5. JavaScriptRuntime.swift: replace move-only push_back with C++ helper appendPropNameId
      content = content.replace(
        /let propNameId\s*=\s*facebook\.jsi\.PropNameID\.forUtf8\(([^,]+),\s*std\.string\(propertyName\)\)[\r\n\s]*vector\.push_back\((?:consuming:\s*)?propNameId\)/g,
        'expo.appendPropNameId(&vector, $1, std.string(propertyName))'
      )
      content = content.replace(
        /vector\.push_back\(consuming:\s*propNameId\)/g,
        'expo.appendPropNameId(&vector, runtime.pointee, std.string(propertyName))'
      )

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

const targets = [
  path.resolve('node_modules/expo-modules-jsi'),
  path.resolve('node_modules/expo-modules-core'),
  path.resolve('node_modules/react-native-pager-view'),
  path.resolve('node_modules/expo-video'),
  path.resolve('node_modules/@bsky.app/expo-scroll-edge-effect'),
  path.resolve('ios/Pods/ExpoModulesJSI'),
  path.resolve('ios/Pods/ExpoModulesCore'),
  path.resolve('ios/Pods/react-native-pager-view'),
  path.resolve('ios/Pods/ExpoVideo'),
  path.resolve('ios/Pods/ExpoScrollEdgeEffect'),
]

for (const target of targets) {
  if (fs.existsSync(target)) {
    patchFiles(target)
  }
}


