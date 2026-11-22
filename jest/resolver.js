const animationResolver = require('react-native-reanimated/jest/resolver')
const nativePreset = require('@react-native/jest-preset')
const nativeResolver = require(nativePreset.resolver)

/*
 * Reanimated and Worklets ship Jest-specific resolution for modules that need
 * their JavaScript implementations in a test process. Preserve the React
 * Native preset's resolver for all other module and package handling.
 */
module.exports = (request, options) => {
  const defaultResolver = options.defaultResolver
  return animationResolver(request, {
    ...options,
    defaultResolver: (modulePath, moduleOptions) =>
      nativeResolver(modulePath, {...moduleOptions, defaultResolver}),
  })
}
