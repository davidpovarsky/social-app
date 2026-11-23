const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const projectRoot = path.resolve(__dirname, '..')

function loadSource(relativePath, env, imports) {
  const module = {exports: {}}
  vm.runInNewContext(
    fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'),
    {
      module,
      process: {env},
      require: name => {
        assert.ok(
          Object.hasOwn(imports, name),
          'Unexpected dependency: ' + name,
        )
        return imports[name]
      },
    },
    {filename: relativePath},
  )
  return module.exports
}

for (const [env, expected] of [
  [{}, '1'],
  [{BSKY_IOS_BUILD_NUMBER: '42'}, '42'],
  [{BSKY_IOS_BUILD_NUMBER: '42.7'}, '42.7'],
]) {
  test('app config uses iOS build ' + expected, () => {
    const createConfig = loadSource('app.config.js', env, {
      './package.json': JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
      ),
      './src/components/ShareDialog/catalog.ts': {
        getNativeQueries: () => ({
          iosSchemes: [],
          androidPackages: [],
          androidSchemes: [],
        }),
      },
    })
    const config = createConfig({}).expo
    assert.equal(config.ios.buildNumber, expected)
    assert.equal(config.ios.bundleIdentifier, 'com.davidpovarsky.torahsocial')
  })
}

for (const [directory, extensionName, controllerName] of [
  ['notificationsExtension', 'BlueskyNSE', 'NotificationService'],
  ['shareExtension', 'Share-with-Bluesky', 'ShareViewController'],
]) {
  for (const {name, buildNumber, env, expected} of [
    {name: 'default', env: {}, expected: '1'},
    {
      name: 'existing environment convention',
      env: {BSKY_IOS_BUILD_NUMBER: '42'},
      expected: '42',
    },
    {
      name: 'explicit configuration precedence',
      buildNumber: '17.4',
      env: {BSKY_IOS_BUILD_NUMBER: '42'},
      expected: '17.4',
    },
  ]) {
    test(extensionName + ' preserves ' + name, () => {
      const configurations = {
        Debug: {buildSettings: {PRODUCT_NAME: '"' + extensionName + '"'}},
        Release: {buildSettings: {PRODUCT_NAME: '"' + extensionName + '"'}},
        Other: {
          buildSettings: {
            PRODUCT_NAME: '"Other"',
            CURRENT_PROJECT_VERSION: '"777"',
          },
        },
        comment: 'Build configuration list',
      }
      const project = {
        addTarget: () => ({uuid: 'extension-target'}),
        addBuildPhase() {},
        pbxCreateGroup: () => 'extension-group',
        addFile() {},
        addSourceFile() {},
        addTargetAttribute() {},
        pbxXCBuildConfigurationSection: () => configurations,
      }
      const {withXcodeTarget} = loadSource(
        'plugins/' + directory + '/withXcodeTarget.js',
        env,
        {
          'expo/config-plugins': {
            withXcodeProject: (config, apply) =>
              apply({...config, modResults: project}),
          },
        },
      )
      withXcodeTarget(
        {
          version: '1.139.0',
          ios: {bundleIdentifier: 'com.davidpovarsky.torahsocial', buildNumber},
        },
        {extensionName, controllerName, soundFiles: []},
      )
      for (const configuration of [
        configurations.Debug,
        configurations.Release,
      ]) {
        assert.equal(
          configuration.buildSettings.CURRENT_PROJECT_VERSION,
          '"' + expected + '"',
        )
        assert.equal(configuration.buildSettings.MARKETING_VERSION, '"1.139.0"')
        assert.equal(
          configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER,
          '"com.davidpovarsky.torahsocial.' + extensionName + '"',
        )
      }
      assert.equal(
        configurations.Other.buildSettings.CURRENT_PROJECT_VERSION,
        '"777"',
      )
    })
  }
}
