const {
  updateAppDelegate,
  updateMainApplication,
} = require('./withNativeLayoutDirection')

const appDelegate = [
  'import Expo',
  'import React',
  '',
  'class AppDelegate: ExpoAppDelegate {',
  '  public override func application(',
  '    _ application: UIApplication,',
  '    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil',
  '  ) -> Bool {',
  '    let delegate = ReactNativeDelegate()',
  '    let factory = ExpoReactNativeFactory(delegate: delegate)',
  '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
  '  }',
  '}',
  '',
].join('\n')

const mainApplication = [
  'package com.example',
  '',
  'import android.app.Application',
  '',
  'class MainApplication : Application() {',
  '  override fun onCreate() {',
  '    super.onCreate()',
  '    loadReactNative(this)',
  '    ApplicationLifecycleDispatcher.onApplicationCreate(this)',
  '  }',
  '}',
  '',
].join('\n')

describe('native layout startup policy', () => {
  it('clears persisted overrides before the iOS React factory is created', () => {
    const output = updateAppDelegate(appDelegate, 'swift')
    const factoryStart = output.indexOf('let delegate = ReactNativeDelegate()')

    for (const call of [
      'i18nUtil.allowRTL(true)',
      'i18nUtil.forceRTL(false)',
      'i18nUtil.swapLeftAndRight(inRTL: false)',
    ]) {
      expect(output.indexOf(call)).toBeGreaterThan(
        output.indexOf(') -> Bool {'),
      )
      expect(output.indexOf(call)).toBeLessThan(factoryStart)
    }
    expect(output.match(/^import React$/gm)).toHaveLength(1)
    expect(output).not.toContain('i18nUtil.swapLeftAndRightInRTL(')
    expect(updateAppDelegate(output, 'swift')).toBe(output)
  })

  it('migrates the old Swift selector when reusing a generated native tree', () => {
    const current = updateAppDelegate(appDelegate, 'swift')
    const previous = current.replace(
      'i18nUtil.swapLeftAndRight(inRTL: false)',
      'i18nUtil.swapLeftAndRightInRTL(false)',
    )

    expect(updateAppDelegate(previous, 'swift')).toBe(current)
  })

  it('clears persisted overrides before Android loads React Native', () => {
    const output = updateMainApplication(mainApplication, 'kt')

    for (const call of [
      'I18nUtil.instance.allowRTL(this, true)',
      'I18nUtil.instance.forceRTL(this, false)',
      'I18nUtil.instance.swapLeftAndRightInRTL(this, false)',
    ]) {
      expect(output.indexOf(call)).toBeGreaterThan(
        output.indexOf('super.onCreate()'),
      )
      expect(output.indexOf(call)).toBeLessThan(
        output.indexOf('loadReactNative(this)'),
      )
    }
    expect(
      output.match(
        /^import com.facebook.react.modules.i18nmanager.I18nUtil$/gm,
      ),
    ).toHaveLength(1)
    expect(updateMainApplication(output, 'kt')).toBe(output)
  })

  it('adds the React import when needed', () => {
    const output = updateAppDelegate(
      appDelegate.replace('import React\n', ''),
      'swift',
    )
    expect(output.match(/^import React$/gm)).toHaveLength(1)
  })

  it('preserves existing Android imports', () => {
    const withImport = mainApplication.replace(
      'import android.app.Application',
      'import android.app.Application\nimport com.facebook.react.modules.i18nmanager.I18nUtil',
    )
    const output = updateMainApplication(withImport, 'kt')
    expect(
      output.match(
        /^import com.facebook.react.modules.i18nmanager.I18nUtil$/gm,
      ),
    ).toHaveLength(1)
  })

  it.each([
    ['iOS', updateAppDelegate, 'swift'],
    ['Android', updateMainApplication, 'kt'],
  ])('fails if the %s startup lifecycle changes', (_name, update, language) => {
    expect(() => update('', language)).toThrow('before React starts')
  })

  it.each([
    ['iOS', updateAppDelegate, appDelegate, 'objc'],
    ['Android', updateMainApplication, mainApplication, 'java'],
  ])(
    'fails if the %s source language changes',
    (_name, update, input, language) => {
      expect(() => update(input, language)).toThrow('requires a')
    },
  )

  it('enables native RTL support alongside the explicit direction policy', () => {
    const createAppConfig = require('../app.config')
    const config = createAppConfig({
      name: 'Torah Social',
      slug: 'torah-social',
    }).expo
    const localizationPlugin = config.plugins.find(
      plugin => Array.isArray(plugin) && plugin[0] === 'expo-localization',
    )

    expect(localizationPlugin[1]).toMatchObject({supportsRTL: true})
    expect(config.plugins).toContain('./plugins/withNativeLayoutDirection.js')
  })
})
