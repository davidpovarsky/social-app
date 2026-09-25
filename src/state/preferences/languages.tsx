import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {AppState, I18nManager, Platform} from 'react-native'

import {getPreferredDeviceAppLanguage} from '#/locale/deviceLocales'
import {isRtl} from '#/locale/helpers'
import {type AppLanguage} from '#/locale/languages'
import * as persisted from '#/state/persisted'
import {AnalyticsContext, utils} from '#/analytics'

type SetStateCb = (
  s: persisted.Schema['languagePrefs'],
) => persisted.Schema['languagePrefs']
type StateContext = persisted.Schema['languagePrefs']
type ApiContext = {
  setPrimaryLanguage: (code2: string) => void
  setPostLanguage: (commaSeparatedLangCodes: string) => void
  setContentLanguages: (code2s: string[]) => void
  savePostLanguageToHistory: () => void
  setAppLanguage: (code2: AppLanguage) => void
}

const stateContext = createContext<StateContext>(
  persisted.defaults.languagePrefs,
)
stateContext.displayName = 'LanguagePrefsStateContext'
const apiContext = createContext<ApiContext>({
  setPrimaryLanguage: (_: string) => {},
  setPostLanguage: (_: string) => {},
  setContentLanguages: (_: string[]) => {},
  savePostLanguageToHistory: () => {},
  setAppLanguage: (_: AppLanguage) => {},
})
apiContext.displayName = 'LanguagePrefsApiContext'

export function Provider({children}: React.PropsWithChildren<{}>) {
  const [state, setState] = useState(() => {
    const persistedPrefs = persisted.get('languagePrefs')
    if (Platform.OS !== 'ios' && Platform.OS !== 'android')
      return persistedPrefs
    const currentDeviceLang = getPreferredDeviceAppLanguage()
    if (!currentDeviceLang) return persistedPrefs

    const prevSystem = persistedPrefs.systemAppLanguage
    const hasChanged = prevSystem !== currentDeviceLang

    if (hasChanged) {
      const nextLang = currentDeviceLang as AppLanguage
      const nextIsRTL = isRtl(nextLang)
      I18nManager.allowRTL(nextIsRTL)
      I18nManager.forceRTL(nextIsRTL)

      const updated = {
        ...persistedPrefs,
        appLanguage: currentDeviceLang,
        systemAppLanguage: currentDeviceLang,
        customAppLanguage: false,
      }
      void persisted.write('languagePrefs', updated)
      return updated
    }

    if (
      !persistedPrefs.customAppLanguage &&
      persistedPrefs.appLanguage !== currentDeviceLang
    ) {
      const nextLang = currentDeviceLang as AppLanguage
      const nextIsRTL = isRtl(nextLang)
      I18nManager.allowRTL(nextIsRTL)
      I18nManager.forceRTL(nextIsRTL)

      const updated = {
        ...persistedPrefs,
        appLanguage: currentDeviceLang,
        systemAppLanguage: currentDeviceLang,
      }
      void persisted.write('languagePrefs', updated)
      return updated
    }

    return persistedPrefs
  })

  const setStateWrapped = useCallback(
    (fn: SetStateCb) => {
      const s = fn(persisted.get('languagePrefs'))
      setState(s)
      void persisted.write('languagePrefs', s)
    },
    [setState],
  )

  const syncWithDeviceLanguage = useCallback(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return
    const currentDeviceLang = getPreferredDeviceAppLanguage()
    if (!currentDeviceLang) return

    setStateWrapped(current => {
      const prevSystem = current.systemAppLanguage
      const hasChanged = prevSystem !== currentDeviceLang

      if (hasChanged) {
        // System / Per-app language changed in iOS Settings
        const nextLang = currentDeviceLang as AppLanguage
        const nextIsRTL = isRtl(nextLang)
        I18nManager.allowRTL(nextIsRTL)
        I18nManager.forceRTL(nextIsRTL)

        return {
          ...current,
          appLanguage: currentDeviceLang,
          systemAppLanguage: currentDeviceLang,
          customAppLanguage: false,
        }
      }

      // If user never set a custom in-app language, ensure appLanguage tracks current device language
      if (
        !current.customAppLanguage &&
        current.appLanguage !== currentDeviceLang
      ) {
        const nextLang = currentDeviceLang as AppLanguage
        const nextIsRTL = isRtl(nextLang)
        I18nManager.allowRTL(nextIsRTL)
        I18nManager.forceRTL(nextIsRTL)

        return {
          ...current,
          appLanguage: currentDeviceLang,
          systemAppLanguage: currentDeviceLang,
        }
      }

      if (current.systemAppLanguage !== currentDeviceLang) {
        return {
          ...current,
          systemAppLanguage: currentDeviceLang,
        }
      }

      return current
    })
  }, [setStateWrapped])

  useEffect(() => {
    const sub = AppState.addEventListener('change', appState => {
      if (appState === 'active') {
        syncWithDeviceLanguage()
      }
    })
    return () => {
      sub.remove()
    }
  }, [syncWithDeviceLanguage])

  useEffect(() => {
    return persisted.onUpdate('languagePrefs', nextLanguagePrefs => {
      setState(nextLanguagePrefs)
    })
  }, [setStateWrapped])

  const api = useMemo(
    () => ({
      setPrimaryLanguage(code2: string) {
        setStateWrapped(s => ({...s, primaryLanguage: code2}))
      },
      setPostLanguage(commaSeparatedLangCodes: string) {
        setStateWrapped(s => ({...s, postLanguage: commaSeparatedLangCodes}))
      },
      setContentLanguages(code2s: string[]) {
        setStateWrapped(s => ({...s, contentLanguages: code2s}))
      },
      /**
       * Saves whatever language codes are currently selected into a history array,
       * which is then used to populate the language selector menu.
       */
      savePostLanguageToHistory() {
        // filter out duplicate `this.postLanguage` if exists, and prepend
        // value to start of array
        setStateWrapped(s => ({
          ...s,
          postLanguageHistory: [s.postLanguage]
            .concat(
              s.postLanguageHistory.filter(
                commaSeparatedLangCodes =>
                  commaSeparatedLangCodes !== s.postLanguage,
              ),
            )
            .slice(0, 6),
        }))
      },
      setAppLanguage(code2: AppLanguage) {
        setStateWrapped(s => ({
          ...s,
          appLanguage: code2,
          customAppLanguage: true,
        }))
      },
    }),
    [setStateWrapped],
  )

  return (
    <stateContext.Provider value={state}>
      <apiContext.Provider value={api}>
        <AnalyticsContext
          metadata={utils.useMeta({
            preferences: {
              appLanguage: state.appLanguage,
              contentLanguages: state.contentLanguages,
            },
          })}>
          {children}
        </AnalyticsContext>
      </apiContext.Provider>
    </stateContext.Provider>
  )
}

export function useLanguagePrefs() {
  return useContext(stateContext)
}

export function useLanguagePrefsApi() {
  return useContext(apiContext)
}

export function getContentLanguages() {
  return persisted.get('languagePrefs').contentLanguages
}

/**
 * Be careful with this. It's used for the PWI home screen so that users can
 * select a UI language and have it apply to the fetched Discover feed.
 *
 * We only support BCP-47 two-letter codes here, hence the split.
 */
export function getAppLanguageAsContentLanguage() {
  return persisted.get('languagePrefs').appLanguage.split('-')[0]
}

export function toPostLanguages(postLanguage: string): string[] {
  // filter out empty strings if exist
  return postLanguage.split(',').filter(Boolean)
}

export function fromPostLanguages(languages: string[]): string {
  return languages.filter(Boolean).join(',')
}

export function hasPostLanguage(postLanguage: string, code2: string): boolean {
  return toPostLanguages(postLanguage).includes(code2)
}
