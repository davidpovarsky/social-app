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

export type SefariaManuscript = {
  manuscript_slug: string
  page_id: string
  image_url: string
  thumbnail_url: string
  description?: string
  anchorRef?: string
  anchorRefExpanded?: string[]
  manuscript?: {
    slug?: string
    title?: string
    he_title?: string
    source?: string
    description?: string
    he_description?: string
  }
}

export type TorahSource = {
  ref: string
  heRef: string
  uri: string
  category?: string
  preview?: string
  versionTitle?: string
  license?: string
  imageUrl?: string
  hasManuscripts?: boolean
}

export type DetectedTorahSource = TorahSource & {
  matchedText: string
  startChar: number
  endChar: number
  ambiguous: boolean
}

