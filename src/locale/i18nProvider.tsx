import {createContext, useContext} from 'react'
import {View} from 'react-native'
import {i18n} from '@lingui/core'
import {I18nProvider as DefaultI18nProvider} from '@lingui/react'
import {type Locale} from 'date-fns'

import {IS_WEB} from '#/env'

import {useLocaleLanguage} from './i18n'
import {useAppLayoutDirection} from './layoutDirection'

const DateLocaleContext = createContext<Locale | undefined>(undefined)
DateLocaleContext.displayName = 'DateLocaleContext'

export default function I18nProvider({children}: {children: React.ReactNode}) {
  const dateLocale = useLocaleLanguage()
  const direction = useAppLayoutDirection()
  return (
    <DateLocaleContext value={dateLocale}>
      <DefaultI18nProvider i18n={i18n}>
        <View
          {...(IS_WEB ? {dir: direction} : {})}
          style={{flex: 1, direction}}>
          {children}
        </View>
      </DefaultI18nProvider>
    </DateLocaleContext>
  )
}

/**
 * Returns a `date-fns` locale corresponding to the current app language
 */
export function useDateLocale() {
  const ctx = useContext(DateLocaleContext)

  if (!ctx) {
    throw new Error('useDateLocale must be used within an I18nProvider')
  }

  return ctx
}
