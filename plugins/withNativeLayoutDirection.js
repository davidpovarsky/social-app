const {withAppDelegate, withMainApplication} = require('expo/config-plugins')

const marker = '// Torah Social native layout policy'

/*
 * Fabric captures these flags when it creates a surface, before JavaScript
 * initializes. In addition, RCTI18nUtil resets physical left/right swapping
 * on every iOS launch. Configure it before React starts so a fresh launch
 * and an upgrade from an older forceRTL build use the same coordinates.
 *
 * The selected app language controls Yoga direction and navigation in JS.
 * Native system controls can still follow the device's RTL locale.
 */
function updateAppDelegate(contents, language) {
  if (language !== 'swift') {
    throw Error('Native layout direction requires a Swift AppDelegate.')
  }

  const anchor =
    /(^[ \t]*(?:public\s+)?override\s+func\s+application\s*\(\s*_\s+application:\s*UIApplication,\s*didFinishLaunchingWithOptions[\s\S]*?\)\s*->\s*Bool\s*\{)/m

  if (!anchor.test(contents)) {
    throw Error(
      'Cannot find AppDelegate didFinishLaunchingWithOptions. Verify the native layout policy runs before React starts.',
    )
  }
  if (contents.includes(marker)) {
    return contents
  }
  if (!/^(?:(?:internal|public) )?import React\r?$/m.test(contents)) {
    contents = 'import React\n' + contents
  }

  const bootstrap = [
    '    ' + marker,
    '    if let i18nUtil = RCTI18nUtil.sharedInstance() {',
    '      i18nUtil.allowRTL(true)',
    '      i18nUtil.forceRTL(false)',
    '      i18nUtil.swapLeftAndRightInRTL(false)',
    '    }',
    '',
  ].join('\n')

  return contents.replace(anchor, '$1\n' + bootstrap)
}

function updateMainApplication(contents, language) {
  if (language !== 'kt') {
    throw Error('Native layout direction requires a Kotlin MainApplication.')
  }

  const anchor = /(\boverride\s+fun\s+onCreate\(\)\s*\{\s*super\.onCreate\(\))/
  if (!anchor.test(contents)) {
    throw Error(
      'Cannot find MainApplication onCreate. Verify the native layout policy runs before React starts.',
    )
  }
  if (contents.includes(marker)) {
    return contents
  }

  const importLine = 'import com.facebook.react.modules.i18nmanager.I18nUtil'
  if (!contents.includes(importLine)) {
    contents = contents.replace(/^(package .*)$/m, '$1\n\n' + importLine)
  }

  const bootstrap = [
    '    ' + marker,
    '    I18nUtil.instance.allowRTL(this, true)',
    '    I18nUtil.instance.forceRTL(this, false)',
    '    I18nUtil.instance.swapLeftAndRightInRTL(this, false)',
    '',
  ].join('\n')

  return contents.replace(anchor, '$1\n' + bootstrap)
}

module.exports = function withNativeLayoutDirection(config) {
  config = withAppDelegate(config, config => {
    config.modResults.contents = updateAppDelegate(
      config.modResults.contents,
      config.modResults.language,
    )
    return config
  })

  return withMainApplication(config, config => {
    config.modResults.contents = updateMainApplication(
      config.modResults.contents,
      config.modResults.language,
    )
    return config
  })
}

module.exports.updateAppDelegate = updateAppDelegate
module.exports.updateMainApplication = updateMainApplication
