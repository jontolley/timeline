import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { getEvent } from '../../../src/api/events'
import { listPeople } from '../../../src/api/people'
import { listThreads } from '../../../src/api/threads'
import type { MediaRef, Thread, TimelineEvent } from '../../../src/api/types'
import { colors } from '../../../src/theme'

// Read-only event detail. Tapping a timeline row lands here (push/card); the
// "Edit" action pushes the shared EventForm at /event/:id/edit as a modal. On
// returning from edit we reload on focus so changes show; if the event was
// deleted from the edit screen, getEvent 404s and we bounce back to the
// timeline. Shared (non-owned) events hide Edit/Delete entirely.

// Dates store UTC — format in UTC so the day never shifts (CLAUDE.md invariant).
function hasTime(iso: string): boolean {
  const d = new Date(iso)
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}
function formatDateRange(start: string, end?: string | null): string {
  const s = fmtDate(start) + (hasTime(start) ? ` at ${fmtTime(start)}` : '')
  if (!end) return s
  const e = fmtDate(end) + (hasTime(end) ? ` at ${fmtTime(end)}` : '')
  return `${s} – ${e}`
}

type Loc = { name?: string | null; address?: string | null; lat?: number | null; lng?: number | null }
function asLoc(loc: TimelineEvent['location']): Loc | null {
  if (!loc) return null
  if (typeof loc === 'string') return { name: loc }
  return loc
}
function locationLabel(loc: Loc): string | null {
  return loc.name || loc.address || null
}
function locationMapUrl(loc: Loc): string | null {
  if (loc.lat != null && loc.lng != null) return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
  const q = loc.address || loc.name
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

function isVisual(m: MediaRef): boolean {
  const k = m.kind || 'photo'
  return k !== 'audio' && k !== 'pdf'
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [event, setEvent] = useState<TimelineEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [peopleById, setPeopleById] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<number | null>(null)
  // Tracks whether we ever loaded the event, so a later 404 (deleted from the
  // edit screen) can bounce back instead of showing an error. A ref, not state,
  // to keep `load` stable across focuses and dodge a stale-closure read.
  const hadEvent = useRef(false)

  useEffect(() => {
    listThreads()
      .then(setThreads)
      .catch(() => {})
  }, [])

  // Reload on every focus so edits made on the pushed edit screen are reflected
  // when we return. `loading` is never flipped back on after the first load, so
  // the refocus reload is silent (old content stays until the new arrives).
  const load = useCallback(async () => {
    if (!id) return
    try {
      const ev = await getEvent(id)
      hadEvent.current = true
      setEvent(ev)
      setError(null)
      // Resolve owned-event person names from the people list; shared events
      // carry denormalised names in people_display.
      if (ev.is_owner !== false && ev.people?.length) {
        listPeople()
          .then((list) => setPeopleById(Object.fromEntries(list.map((p) => [p._id, p.name]))))
          .catch(() => {})
      }
    } catch (e) {
      // Already saw the event, now it's gone → deleted from the edit screen.
      // Bounce back rather than sit on a dead page. A first-load failure shows
      // an error message instead.
      if (hadEvent.current) {
        router.back()
      } else {
        setError(e instanceof Error ? e.message : 'Could not load event.')
      }
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    )
  }

  if (error || !event) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Text style={styles.error}>{error || 'Event not found.'}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const isShared = event.is_owner === false
  const thread = threads.find((t) => t._id === event.thread_id) || null
  const showThread = threads.length > 1 && !!thread
  const loc = asLoc(event.location)
  const locLabel = loc ? locationLabel(loc) : null
  const mapUrl = loc ? locationMapUrl(loc) : null

  const media = event.media || []
  const visual = media.filter(isVisual)
  const audio = media.filter((m) => m.kind === 'audio')
  const pdfs = media.filter((m) => m.kind === 'pdf')

  // People names: shared events use the denormalised people_display.
  const peopleNames: string[] = isShared
    ? (event.people_display || []).map((p) => p.name)
    : (event.people || []).map((pid) => peopleById[pid]).filter(Boolean)

  const openExternal = (url?: string | null) => {
    if (url) void Linking.openURL(url)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.headerBtn}>‹ Timeline</Text>
        </Pressable>
        {!isShared ? (
          <Pressable onPress={() => router.push(`/event/${event._id}/edit`)} hitSlop={8}>
            <Text style={[styles.headerBtn, styles.headerBtnPrimary]}>Edit</Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.metaRow}>
          {showThread ? (
            <View style={styles.threadPill}>
              <View style={[styles.threadDot, { backgroundColor: thread!.color || colors.accent }]} />
              <Text style={styles.threadName}>{thread!.name}</Text>
            </View>
          ) : null}
          <Text style={styles.metaDate}>{formatDateRange(event.date, event.end_date)}</Text>
        </View>
        {isShared ? <Text style={styles.sharedBadge}>shared with you · read-only</Text> : null}

        <Text style={styles.title}>{event.title}</Text>

        {locLabel ? (
          <Pressable onPress={() => openExternal(mapUrl)} disabled={!mapUrl}>
            <Text style={[styles.location, mapUrl && styles.locationLink]}>
              📍 {locLabel}
              {loc?.lat != null && loc?.lng != null ? (
                <Text style={styles.coords}>{`  (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})`}</Text>
              ) : null}
            </Text>
          </Pressable>
        ) : null}

        {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

        {peopleNames.length > 0 ? (
          <View style={styles.chipRow}>
            {peopleNames.map((name, i) => (
              <View key={`${name}-${i}`} style={styles.personChip}>
                <Text style={styles.personChipText}>{name}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {event.tags?.length ? (
          <View style={styles.chipRow}>
            {event.tags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>#{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {visual.length > 0 ? (
          <View style={styles.mediaGrid}>
            {visual.map((m, i) => {
              const kind = m.kind || 'photo'
              const poster = m.thumb_url || (kind === 'photo' ? m.url : null)
              return (
                <Pressable
                  key={m.key}
                  style={styles.mediaTile}
                  onPress={() => (kind === 'video' ? openExternal(m.url) : setLightbox(i))}
                >
                  {poster ? (
                    <Image source={{ uri: poster }} style={styles.mediaImg} />
                  ) : (
                    <View style={[styles.mediaImg, styles.mediaPlaceholder]}>
                      <Text style={styles.mediaKindText}>{kind}</Text>
                    </View>
                  )}
                  {kind === 'video' ? (
                    <View style={styles.playBadge}>
                      <Text style={styles.playBadgeText}>▶</Text>
                    </View>
                  ) : null}
                </Pressable>
              )
            })}
          </View>
        ) : null}

        {audio.map((m) => (
          <Pressable key={m.key} style={styles.fileRow} onPress={() => openExternal(m.url)}>
            <Text style={styles.fileBadge}>♪</Text>
            <Text style={styles.fileLabel}>Audio recording</Text>
            <Text style={styles.fileOpen}>Play ↗</Text>
          </Pressable>
        ))}

        {pdfs.map((m) => (
          <Pressable key={m.key} style={styles.fileRow} onPress={() => openExternal(m.url)}>
            <Text style={styles.fileBadge}>PDF</Text>
            <Text style={styles.fileLabel}>
              Document{m.page_count ? ` · ${m.page_count} page${m.page_count === 1 ? '' : 's'}` : ''}
            </Text>
            <Text style={styles.fileOpen}>Open ↗</Text>
          </Pressable>
        ))}
      </ScrollView>

      {lightbox !== null && visual[lightbox] ? (
        <Lightbox items={visual} index={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox} />
      ) : null}
    </SafeAreaView>
  )
}

function Lightbox({
  items,
  index,
  onClose,
  onChange,
}: {
  items: MediaRef[]
  index: number
  onClose: () => void
  onChange: (i: number) => void
}) {
  const count = items.length
  const item = items[index]
  const uri = item?.url || item?.thumb_url || null
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.lbBackdrop} onPress={onClose}>
        {uri ? <Image source={{ uri }} style={styles.lbImage} resizeMode="contain" /> : null}
        <Pressable style={styles.lbClose} onPress={onClose} hitSlop={12}>
          <Text style={styles.lbCloseText}>✕</Text>
        </Pressable>
        {count > 1 ? (
          <>
            <Pressable
              style={[styles.lbArrow, styles.lbArrowLeft]}
              onPress={() => onChange((index - 1 + count) % count)}
              hitSlop={12}
            >
              <Text style={styles.lbArrowText}>‹</Text>
            </Pressable>
            <Pressable
              style={[styles.lbArrow, styles.lbArrowRight]}
              onPress={() => onChange((index + 1) % count)}
              hitSlop={12}
            >
              <Text style={styles.lbArrowText}>›</Text>
            </Pressable>
            <Text style={styles.lbCount}>
              {index + 1} / {count}
            </Text>
          </>
        ) : null}
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  link: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  headerBtn: { fontSize: 16, color: colors.inkSoft },
  headerBtnPrimary: { color: colors.accent, fontWeight: '700' },
  body: { padding: 20, paddingBottom: 48, gap: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  threadPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  threadDot: { width: 10, height: 10, borderRadius: 5 },
  threadName: { fontSize: 13, fontWeight: '600', color: colors.ink },
  metaDate: { fontSize: 13, color: colors.inkSoft },
  sharedBadge: { fontSize: 12, color: colors.gold, fontWeight: '600', marginTop: -6 },
  title: { fontSize: 30, fontWeight: '700', color: colors.ink, lineHeight: 36 },
  location: { fontSize: 15, color: colors.ink },
  locationLink: { color: colors.accent },
  coords: { fontSize: 12, color: colors.inkSoft },
  description: { fontSize: 16, color: colors.ink, lineHeight: 24 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  personChipText: { fontSize: 13, color: colors.ink, fontWeight: '500' },
  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rule },
  tagChipText: { fontSize: 13, color: colors.accent },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaTile: { width: 104, height: 104, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.rule },
  mediaImg: { width: '100%', height: '100%' },
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  mediaKindText: { fontSize: 12, color: colors.inkSoft, textTransform: 'uppercase' },
  playBadge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadgeText: { color: '#fff', fontSize: 28, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  fileBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
    minWidth: 32,
  },
  fileLabel: { flex: 1, fontSize: 15, color: colors.ink },
  fileOpen: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  lbBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lbImage: { width: '100%', height: '100%' },
  lbClose: { position: 'absolute', top: 56, right: 24 },
  lbCloseText: { color: '#fff', fontSize: 26, fontWeight: '600' },
  lbArrow: { position: 'absolute', top: '50%', marginTop: -20, padding: 8 },
  lbArrowLeft: { left: 12 },
  lbArrowRight: { right: 12 },
  lbArrowText: { color: '#fff', fontSize: 44, fontWeight: '300' },
  lbCount: { position: 'absolute', bottom: 48, color: '#fff', fontSize: 14 },
})
