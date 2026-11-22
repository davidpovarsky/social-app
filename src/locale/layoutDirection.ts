import {isRtl, sanitizeAppLanguageSetting} from '#/locale/helpers'
import {useLanguagePrefs} from '#/state/preferences'

export type AppLayoutDirection = 'ltr' | 'rtl'

/**
 * App direction follows the selected language, including changes made while
 * running. I18nManager.isRTL is a startup snapshot and is always false on web.
 */
export function useAppLayoutDirection(): AppLayoutDirection {
  const {appLanguage} = useLanguagePrefs()
  return isRtl(sanitizeAppLanguageSetting(appLanguage)) ? 'rtl' : 'ltr'
}

export function useIsRTL() {
  return useAppLayoutDirection() === 'rtl'
}
