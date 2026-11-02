import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { getEvent } from '@/api/events'
import { listPeople } from '@/api/people'
import { listThreads } from '@/api/threads'
import type { MediaRef, Thread, TimelineEvent } from '@/api/types'
import { GlassButton, Icon, IconTile } from '@/components/ui'
import { avatarColor, initials, paletteColor, useTheme, type Theme } from '@/theme'

// Read-only event detail. Tapping a timeline card lands here (push/card); the
// "Edit" action pushes the shared EventForm at /event/:id/edit as a modal. On
// returning from edit we reload on focus so changes show; if the event was
// deleted from the edit screen, getEvent 404s and we bounce back to the
// timeline. Shared (non-owned) events hide Edit entirely.

const HERO_H = 408

// Dates store UTC — format in UTC so the day never shifts (CLAUDE.md invariant).
function hasTime(iso: string): boolean {
  const d = new Date(iso)
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
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
function locationMapUrl(loc: Loc): string | null {
  if (loc.lat != null && loc.lng != null) return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
  const q = loc.address || loc.name
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

function isVisual(m: MediaRef): boolean {
  const k = m.kind || 'photo'
  return k !== 'audio' && k !== 'pdf'
}
// R2 URLs are re-signed per read; cache on the stable key.
function src(m: MediaRef, full: boolean): { uri: string; cacheKey: string } | null {
  const isPhoto = (m.kind || 'photo') === 'photo'
  const uri = full && isPhoto ? m.url || m.thumb_url : m.thumb_url || (isPhoto ? m.url : null)
  return uri ? { uri, cacheKey: `${m.key}${full ? '' : ':thumb'}` } : null
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const [event, setEvent] = useState<TimelineEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [peopleById, setPeopleById] = useState<Record<string, string>>({})
  const [page, setPage] = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const heroRef = useRef<ComponentRef<typeof ScrollView>>(null)
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
        <ActivityIndicator color={t.secondary} />
      </SafeAreaView>
    )
  }

  if (error || !event) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Text style={styles.error}>{error || 'Event not found.'}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go Back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const isShared = event.is_owner === false
  const thread = threads.find((th) => th._id === event.thread_id) || null
  const showThread = threads.length > 1 && !!thread
  const loc = asLoc(event.location)
  const locName = loc ? loc.name || loc.address || null : null
  const locSub = loc?.name && loc.address && loc.address !== loc.name ? loc.address : null
  const mapUrl = loc ? locationMapUrl(loc) : null

  const media = event.media || []
  const visual = media.filter(isVisual)
  const audio = media.filter((m) => m.kind === 'audio')
  const pdfs = media.filter((m) => m.kind === 'pdf')
  const hasHero = visual.length > 0

  // People names: shared events use the denormalised people_display.
  const peopleNames: string[] = isShared
    ? (event.people_display || []).map((p) => p.name)
    : (event.people || []).map((pid) => peopleById[pid]).filter(Boolean)

  const openExternal = (url?: string | null) => {
    if (url) void Linking.openURL(url)
  }
  const share = () => {
    const lines = [event.title, fmtDate(event.date), event.description].filter(Boolean)
    void Share.share({ message: lines.join('\n') })
  }
  const showPage = (i: number) => {
    setPage(i)
    heroRef.current?.scrollTo({ x: i * width, animated: true })
  }
  const onHeroScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width))
  }

  const rows: { key: string; node: ReactNode }[] = []
  if (locName) {
    rows.push({
      key: 'loc',
      node: (
        <Pressable style={styles.row} onPress={() => openExternal(mapUrl)} disabled={!mapUrl}>
          <IconTile icon="mappin" color={t.tint} size={32} />
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {locName}
            </Text>
            {locSub ? (
              <Text style={styles.rowSub} numberOfLines={1}>
                {locSub}
              </Text>
            ) : null}
          </View>
          {mapUrl ? <Text style={styles.rowLink}>Maps</Text> : null}
        </Pressable>
      ),
    })
  }
  if (peopleNames.length) {
    rows.push({
      key: 'people',
      node: (
        <View style={styles.row}>
          <IconTile icon="person.2.fill" color="#34A853" size={32} />
          <View style={[styles.rowMain, styles.rowInline]}>
            <View style={styles.avatars}>
              {peopleNames.slice(0, 3).map((name, i) => (
                <View
                  key={`${name}-${i}`}
                  style={[styles.avatar, { backgroundColor: avatarColor(name) }, i > 0 && { marginLeft: -8 }]}
                >
                  <Text style={styles.avatarText}>{initials(name)}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
              {peopleNames.join(', ')}
            </Text>
          </View>
        </View>
      ),
    })
  }
  if (event.tags?.length) {
    rows.push({
      key: 'tags',
      node: (
        <View style={styles.row}>
          <IconTile icon="tag.fill" color="#E8833A" size={32} />
          <View style={[styles.rowMain, styles.tagWrap]}>
            {event.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    })
  }
  for (const m of audio) {
    rows.push({
      key: m.key,
      node: (
        <Pressable style={styles.row} onPress={() => openExternal(m.url)}>
          <IconTile icon="waveform" color="#8E5CD9" size={32} />
          <Text style={[styles.rowTitle, styles.rowMain]}>Audio recording</Text>
          <Text style={styles.rowLink}>Play</Text>
        </Pressable>
      ),
    })
  }
  for (const m of pdfs) {
    rows.push({
      key: m.key,
      node: (
        <Pressable style={styles.row} onPress={() => openExternal(m.url)}>
          <IconTile icon="doc.text.fill" color="#E5484D" size={32} />
          <Text style={[styles.rowTitle, styles.rowMain]}>
            Document{m.page_count ? ` · ${m.page_count} page${m.page_count === 1 ? '' : 's'}` : ''}
          </Text>
          <Text style={styles.rowLink}>Open</Text>
        </Pressable>
      ),
    })
  }

  const topBar = (
    <View style={[styles.topBar, hasHero && { position: 'absolute', top: insets.top + 6, left: 0, right: 0 }]}>
      <GlassButton icon="chevron.left" accessibilityLabel="Back" onPress={() => router.back()} />
      <View style={styles.topRight}>
        <GlassButton icon="square.and.arrow.up" accessibilityLabel="Share" onPress={share} />
        {!isShared ? <GlassButton label="Edit" onPress={() => router.push(`/event/${event._id}/edit`)} /> : null}
      </View>
    </View>
  )

  return (
    <View style={styles.safe}>
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {hasHero ? (
          <View style={{ height: HERO_H }}>
            <ScrollView
              ref={heroRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onHeroScroll}
            >
              {visual.map((m, i) => {
                const s = src(m, true)
                return (
                  <Pressable
                    key={m.key}
                    style={{ width, height: HERO_H, backgroundColor: t.photoPlaceholder }}
                    onPress={() => (m.kind === 'video' ? openExternal(m.url) : setLightbox(i))}
                  >
                    {s ? <Image source={s} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
                    {m.kind === 'video' ? (
                      <View style={styles.heroCenter}>
                        <Icon name="play.circle.fill" size={56} color="rgba(255,255,255,0.92)" />
                      </View>
                    ) : null}
                  </Pressable>
                )
              })}
            </ScrollView>
            {visual.length > 1 ? (
              <View style={styles.pageBadge}>
                <Text style={styles.pageText}>
                  {page + 1} of {visual.length}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ paddingTop: insets.top + 6 }}>{topBar}</View>
        )}

        <View style={[styles.sheet, hasHero && styles.sheetOverlap]}>
          <View style={{ gap: 6 }}>
            <View style={styles.meta}>
              {showThread ? (
                <>
                  <View style={[styles.dot, { backgroundColor: paletteColor(thread!.color, t.dark) }]} />
                  <Text style={styles.metaText}>{thread!.name}</Text>
                  <Text style={styles.metaText}>·</Text>
                </>
              ) : null}
              <Text style={[styles.metaText, styles.metaDate]}>{formatDateRange(event.date, event.end_date)}</Text>
            </View>
            {isShared ? <Text style={styles.metaText}>Shared with you · read-only</Text> : null}
            <Text style={styles.title}>{event.title}</Text>
          </View>

          {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

          {rows.length ? (
            <View style={styles.group}>
              {rows.map((r, i) => (
                <Fragment key={r.key}>
                  {i > 0 ? <View style={styles.separator} /> : null}
                  {r.node}
                </Fragment>
              ))}
            </View>
          ) : null}

          {visual.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
              {visual.map((m, i) => {
                const s = src(m, false)
                return (
                  <Pressable key={m.key} onPress={() => showPage(i)} style={styles.thumb}>
                    {s ? <Image source={s} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                    {i === page ? <View style={styles.thumbRing} /> : null}
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
        </View>
      </ScrollView>

      {hasHero ? topBar : null}

      {lightbox !== null && visual[lightbox] ? (
        <Lightbox items={visual} index={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox} />
      ) : null}
    </View>
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
  const s = item ? src(item, true) : null
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={lb.backdrop} onPress={onClose}>
        {s ? <Image source={s} style={lb.image} contentFit="contain" /> : null}
        <Pressable style={lb.close} onPress={onClose} hitSlop={12} accessibilityLabel="Close">
          <Icon name="xmark" size={22} color="#FFFFFF" weight="bold" />
        </Pressable>
        {count > 1 ? (
          <>
            <Pressable
              style={[lb.arrow, lb.left]}
              onPress={() => onChange((index - 1 + count) % count)}
              hitSlop={12}
              accessibilityLabel="Previous photo"
            >
              <Icon name="chevron.left" size={30} color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={[lb.arrow, lb.right]}
              onPress={() => onChange((index + 1) % count)}
              hitSlop={12}
              accessibilityLabel="Next photo"
            >
              <Icon name="chevron.right" size={30} color="#FFFFFF" />
            </Pressable>
            <Text style={lb.count}>
              {index + 1} of {count}
            </Text>
          </>
        ) : null}
      </Pressable>
    </Modal>
  )
}

const lb = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: 60, right: 24 },
  arrow: { position: 'absolute', top: '50%', marginTop: -20, padding: 8 },
  left: { left: 8 },
  right: { right: 8 },
  count: { position: 'absolute', bottom: 48, color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
})

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.detailBg },
    center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
    error: { color: t.danger, fontSize: 15, textAlign: 'center' },
    link: { color: t.tintText, fontSize: 17, fontWeight: '600' },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
    topRight: { flexDirection: 'row', gap: 10 },
    heroCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    pageBadge: {
      position: 'absolute',
      right: 16,
      bottom: 34,
      height: 26,
      paddingHorizontal: 10,
      borderRadius: 13,
      backgroundColor: t.overlay,
      justifyContent: 'center',
    },
    pageText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
    sheet: { backgroundColor: t.detailBg, paddingHorizontal: 20, paddingTop: 22, gap: 18 },
    sheetOverlap: { marginTop: -20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    metaText: { fontSize: 15, fontWeight: '500', color: t.secondary },
    metaDate: { flexShrink: 1 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    title: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: t.label, letterSpacing: 0.1 },
    description: { fontSize: 17, lineHeight: 25, color: t.body },
    group: { backgroundColor: t.detailGroup, borderRadius: 22, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
    rowMain: { flex: 1 },
    rowInline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowTitle: { fontSize: 17, lineHeight: 22, color: t.label },
    rowSub: { fontSize: 15, lineHeight: 20, color: t.secondary },
    rowLink: { fontSize: 15, fontWeight: '500', color: t.tintText },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.separator, marginLeft: 58 },
    avatars: { flexDirection: 'row' },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 2,
      borderColor: t.detailGroup,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { height: 28, paddingHorizontal: 11, borderRadius: 14, backgroundColor: t.detailChip, justifyContent: 'center' },
    tagText: { fontSize: 15, color: t.label },
    thumbs: { gap: 8 },
    thumb: { width: 76, height: 76, borderRadius: 14, overflow: 'hidden', backgroundColor: t.photoPlaceholder },
    thumbRing: { ...StyleSheet.absoluteFill, borderRadius: 14, borderWidth: 2.5, borderColor: t.tintText },
  })
}
