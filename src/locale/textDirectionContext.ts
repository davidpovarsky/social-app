import {createContext} from 'react'

/**
 * Text primitives consume the resolved direction without importing preference
 * or analytics initialization. Outside the app provider, retain inherited
 * native defaults instead of assuming a language.
 */
export const TextDirectionContext = createContext<'ltr' | 'rtl' | undefined>(
  undefined,
)
TextDirectionContext.displayName = 'TextDirectionContext'
