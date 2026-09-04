export type SefariaCompletion = {
  title: string
  key: string
}

export type SefariaVersion = {
  language?: string
  versionTitle?: string
  license?: string
  versionSource?: string
  text?: unknown
}

export type SefariaTextResponse = {
  ref?: string
  heRef?: string
  title?: string
  versions?: SefariaVersion[]
  warnings?: unknown[]
}

export type TorahSource = {
  ref: string
  heRef: string
  uri: string
  category?: string
  preview?: string
  versionTitle?: string
  license?: string
}

export type DetectedTorahSource = TorahSource & {
  matchedText: string
  startChar: number
  endChar: number
  ambiguous: boolean
}
