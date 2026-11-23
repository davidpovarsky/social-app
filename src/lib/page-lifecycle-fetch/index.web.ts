import {createPageLifecycleFetch} from './web'

const realFetch = globalThis.fetch
const lifecycle =
  typeof window === 'undefined'
    ? undefined
    : createPageLifecycleFetch(window, realFetch)

export const pageLifecycleFetch = lifecycle?.fetch ?? realFetch
export const getPageSignal = () => lifecycle?.getSignal()
