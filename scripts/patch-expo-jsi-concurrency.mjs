import fs from 'node:fs'
import path from 'node:path'

// ExpoModulesJSI 58.0.22 includes UncheckedSendable specifically to carry
// non-Sendable values across synchronous actor-isolated closures under Swift 6.2.
// Its JavaScriptObject.withEncodedValue still captures the raw slot pointer,
// which Xcode 26.3 rejects as a potential data race.
//
// Do not re-enable the old fix-expo-modules-jsi shim: current upstream
// RuntimeScheduler has private constructors and uses static .create() factories.
const sourcePath = path.resolve(
  'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/Values/JavaScriptObject.swift',
)
const helperPath = path.resolve(
  'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Utilities/UncheckedSendable.swift',
)

if (!fs.existsSync(sourcePath) || !fs.existsSync(helperPath)) {
  throw new Error(
    'ExpoModulesJSI 58 source files missing. Run pnpm install first and verify the installed SDK.',
  )
}

const helper = fs.readFileSync(helperPath, 'utf8')
if (
  !helper.includes(
    'internal struct UncheckedSendable<Value>: @unchecked Sendable',
  )
) {
  throw new Error(
    'Expo UncheckedSendable API changed: do not apply an unverified compatibility patch.',
  )
}

let source = fs.readFileSync(sourcePath, 'utf8')
const beforeSlot = '    nonisolated(unsafe) let slot = buffer.baseAddress!'
const afterSlot = [
  beforeSlot,
  '    // Expo UncheckedSendable is safe here: this call is synchronous on the JS executor.',
  '    let sendableSlot = UncheckedSendable(slot)',
].join('\n')
const beforeActor = '        try encode(JavaScriptValue.Slot(slot), runtime)'
const afterActor =
  '        try encode(JavaScriptValue.Slot(sendableSlot.value), runtime)'

if (source.includes(afterActor) && source.includes(afterSlot)) {
  console.log(
    '[expo-jsi-concurrency] Already patched; official Expo helpers retained.',
  )
  process.exit(0)
}
if (!source.includes(beforeSlot) || !source.includes(beforeActor)) {
  throw new Error(
    'ExpoModulesJSI source changed: cannot apply narrow Xcode 26.3 Swift 6 actor fix safely.',
  )
}
source = source.replace(beforeSlot, afterSlot).replace(beforeActor, afterActor)
fs.writeFileSync(sourcePath, source, 'utf8')
console.log(
  '[expo-jsi-concurrency] Wrapped synchronous JavaScript slot with Expo UncheckedSendable.',
)
