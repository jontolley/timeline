// Minimal mirrors of the backend Pydantic models. Kept loose on purpose — the
// goal is ergonomic access in screens, not exhaustive validation.

export type MediaKind = 'photo' | 'video' | 'audio' | 'pdf'

export type MediaRef = {
  kind: MediaKind
  key: string
  thumb_key?: string | null
  url?: string | null
  thumb_url?: string | null
  content_type?: string | null
  width?: number | null
  height?: number | null
  duration_seconds?: number | null
  page_count?: number | null
}

export type LocationDetail = {
  name?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
}

export type TimelineEvent = {
  _id: string
  title: string
  description?: string | null
  date: string
  end_date?: string | null
  location?: LocationDetail | string | null
  tags?: string[]
  people?: string[]
  people_display?: { id: string; name: string }[]
  media?: MediaRef[]
  thread_id: string
  is_owner?: boolean
}

export type Thread = {
  _id: string
  name: string
  color?: string
  visibility: 'private' | 'shared'
  subscriber_count?: number
  subscription?: { _id: string; visible: boolean }
}

export type Person = {
  _id: string
  name: string
}

export type YearCount = { year: number; count: number }
