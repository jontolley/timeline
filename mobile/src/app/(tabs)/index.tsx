import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { listEventYears, listEvents } from '@/api/events'
import { listThreads } from '@/api/threads'
import type { MediaRef, Thread, TimelineEvent, YearCount } from '@/api/types'
import { GlassButton, Icon, TintButton } from '@/components/ui'
import { useTimelineSignal } from '@/store/timeline'
import { paletteColor, useTheme, type Theme } from '@/theme'

const PAGE_SIZE = 30

// Dates are stored UTC; format and group in UTC to avoid a day shift (see the
// web app's utils/date.js invariant).
function monthKey(iso: string): string {
  return iso.slice(0, 7) // YYYY-MM
}
function monthName(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long' })
}
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })
}
function placeLabel(loc: TimelineEvent['location']): string | null {
  if (!loc) return null
  if (typeof loc === 'string') return loc
  return loc.name || loc.address || null
}

function isVisual(m: MediaRef): boolean {
  const k = m.kind || 'photo'
  return k === 'photo' || k === 'video'
}
// Card photos are ~358pt wide, so prefer the full image over the 400px thumb
// for photos; videos only have a poster thumb.
export function coverSource(m: MediaRef): { uri: string; cacheKey: string } | null {
  const uri = (m.kind || 'photo') === 'photo' ? m.url || m.thumb_url : m.thumb_url
  // R2 URLs are re-signed on every read; key the image cache on the stable
  // object key so a refresh doesn't re-download every photo.
  return uri ? { uri, cacheKey: m.key } : null
}

type Section = { key: string; title: string; year: string; data: TimelineEvent[] }

function groupByMonth(events: TimelineEvent[]): Section[] {
  const out: Section[] = []
  for (const ev of events) {
    const key = monthKey(ev.date)
    let last = out[out.length - 1]
    if (!last || last.key !== key) {
      last = { key, title: monthName(ev.date), year: key.slice(0, 4), data: [] }
      out.push(last)
    }
    last.data.push(ev)
  }
  return out
}

function EventCard({
  event,
  thread,
  showThread,
  onPress,
  t,
  styles,
}: {
  event: TimelineEvent
  thread: Thread | undefined
  showThread: boolean
  onPress: () => void
  t: Theme
  styles: Styles
}) {
  const visual = (event.media || []).filter(isVisual)
  const cover = visual[0] ? coverSource(visual[0]) : null
  const place = placeLabel(event.location)
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      {cover ? (
        <View style={styles.cover}>
          <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={event._id} />
          {visual[0].kind === 'video' ? (
            <View style={styles.coverCenter}>
              <Icon name="play.circle.fill" size={44} color="rgba(255,255,255,0.92)" />
            </View>
          ) : null}
          {visual.length > 1 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countText}>1 of {visual.length}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.meta}>
          {showThread && thread ? (
            <>
              <View style={[styles.dot, { backgroundColor: paletteColor(thread.color, t.dark) }]} />
              <Text style={styles.metaText}>{thread.name}</Text>
              <Text style={styles.metaText}>·</Text>
            </>
          ) : null}
          <Text style={styles.metaText}>{shortDay(event.date)}</Text>
          {event.is_owner === false ? <Text style={styles.metaText}>· Shared</Text> : null}
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>
        {!cover && event.description ? (
          <Text style={styles.excerpt} numberOfLines={3}>
            {event.description}
          </Text>
        ) : null}
        {place ? (
          <View style={styles.placeRow}>
            <Icon name="mappin" size={13} color={t.secondary} />
            <Text style={styles.placeText} numberOfLines={1}>
              {place}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

export default function TimelineScreen() {
  const router = useRouter()
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])
  const refreshToken = useTimelineSignal((s) => s.refreshToken)

  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [threads, setThreads] = useState<Thread[]>([])
  const [years, setYears] = useState<YearCount[]>([])
  // Year chip the window was jumped to; null = the newest page.
  const [jumpYear, setJumpYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFirstPage = useCallback(async () => {
    setError(null)
    try {
      const [page, yrs, thr] = await Promise.all([
        listEvents({ limit: PAGE_SIZE }),
        listEventYears().catch(() => [] as YearCount[]),
        listThreads().catch(() => [] as Thread[]),
      ])
      setEvents(page)
      setHasMore(page.length === PAGE_SIZE)
      setYears([...yrs].sort((a, b) => b.year - a.year))
      setThreads(thr)
      setJumpYear(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline.')
    }
  }, [])

  useEffect(() => {
    loadFirstPage().finally(() => setLoading(false))
  }, [loadFirstPage])

  // Reload (quietly, no full-screen spinner) when the Add-event screen signals
  // a new event was created. Skip the initial render — mount already loads.
  const firstSignal = useRef(true)
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false
      return
    }
    void loadFirstPage()
  }, [refreshToken, loadFirstPage])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadFirstPage()
    setRefreshing(false)
  }, [loadFirstPage])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || events.length === 0) return
    setLoadingMore(true)
    try {
      const oldest = events[events.length - 1]
      // Bidirectional cursor: before_date + before_id returns older events
      // (DESC), matching the web infinite-scroll-down contract.
      const page = await listEvents({
        limit: PAGE_SIZE,
        before_date: oldest.date,
        before_id: oldest._id,
      })
      setEvents((prev) => [...prev, ...page])
      setHasMore(page.length === PAGE_SIZE)
    } catch {
      // Keep what we have; pull-to-refresh can retry.
    } finally {
      setLoadingMore(false)
    }
  }, [events, hasMore, loadingMore])

  // Year chips jump the window: everything before Jan 1 of the next year, so
  // the list starts at that year's newest event and scrolls on into older
  // years. The newest chip goes back to the top page. (Unlike the web rail
  // there's no upward context — pull-to-refresh or the newest chip returns.)
  const jumpTo = useCallback(
    async (year: number) => {
      if (years[0] && year === years[0].year) {
        await loadFirstPage()
      } else {
        try {
          const page = await listEvents({ limit: PAGE_SIZE, before_date: `${year + 1}-01-01T00:00:00.000Z` })
          setEvents(page)
          setHasMore(page.length === PAGE_SIZE)
          setJumpYear(year)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load timeline.')
          return
        }
      }
    },
    [years, loadFirstPage],
  )

  const sections = useMemo(() => groupByMonth(events), [events])
  const threadById = useMemo(() => Object.fromEntries(threads.map((th) => [th._id, th])), [threads])
  const showThread = threads.length > 1
  const activeYear = jumpYear ?? years[0]?.year ?? null

  const header = (
    <View style={styles.header}>
      <View style={styles.actions}>
        <GlassButton icon="person.crop.circle" accessibilityLabel="Account" onPress={() => router.push('/account')} />
        <TintButton icon="plus" accessibilityLabel="New moment" onPress={() => router.push('/event/new')} />
      </View>
      <Text style={styles.h1}>Timeline</Text>
      {years.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {years.map((y) => {
            const on = y.year === activeYear
            return (
              <Pressable
                key={y.year}
                onPress={() => void jumpTo(y.year)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{y.year}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {loading ? (
        <>
          <View style={styles.padded}>{header}</View>
          <View style={styles.center}>
            <ActivityIndicator color={t.secondary} />
          </View>
        </>
      ) : error ? (
        <>
          <View style={styles.padded}>{header}</View>
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <Pressable
              onPress={() => {
                setLoading(true)
                loadFirstPage().finally(() => setLoading(false))
              }}
            >
              <Text style={styles.retry}>Try Again</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item._id}
          ListHeaderComponent={header}
          renderSectionHeader={({ section }) => (
            <View style={styles.monthHeader}>
              <Text style={styles.month}>{section.title}</Text>
              <Text style={styles.monthYear}>{section.year}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              thread={threadById[item.thread_id]}
              showThread={showThread}
              onPress={() => router.push(`/event/${item._id}`)}
              t={t}
              styles={styles}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          // Month headers scroll with the cards, like Photos/Journal.
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          // Native tabs float over the list; let iOS inset the scroll content
          // so the last cards can scroll clear of the tab bar.
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No moments yet</Text>
              <Text style={styles.emptyText}>Tap ＋ to add your first one.</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={t.secondary} style={{ marginVertical: 20 }} /> : undefined
          }
        />
      )}
    </SafeAreaView>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    header: { paddingBottom: 4 },
    padded: { paddingHorizontal: 16 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, height: 44, marginTop: 4 },
    h1: { fontSize: 34, lineHeight: 41, fontWeight: '700', color: t.label, marginTop: 4, letterSpacing: 0.2 },
    chips: { gap: 8, paddingTop: 12, paddingRight: 16 },
    chip: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: t.fill, justifyContent: 'center' },
    chipOn: { backgroundColor: t.tint },
    chipText: { fontSize: 15, fontWeight: '500', color: t.label, fontVariant: ['tabular-nums'] },
    chipTextOn: { color: t.onTint, fontWeight: '600' },
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    monthHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingTop: 18, paddingBottom: 10, paddingHorizontal: 4 },
    month: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: t.label },
    monthYear: { fontSize: 17, fontWeight: '500', color: t.secondary },
    card: { backgroundColor: t.card, borderRadius: 22, overflow: 'hidden' },
    pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    cover: { height: 196, backgroundColor: t.photoPlaceholder },
    coverCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    countBadge: {
      position: 'absolute',
      right: 12,
      bottom: 12,
      height: 24,
      paddingHorizontal: 9,
      borderRadius: 12,
      backgroundColor: t.overlay,
      justifyContent: 'center',
    },
    countText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
    cardBody: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 15, gap: 4 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    metaText: { fontSize: 13, fontWeight: '500', color: t.secondary },
    title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: t.label, letterSpacing: -0.2 },
    excerpt: { fontSize: 15, lineHeight: 20, color: t.body },
    placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
    placeText: { flex: 1, fontSize: 15, color: t.secondary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    empty: { alignItems: 'center', paddingTop: 80, gap: 6 },
    emptyTitle: { fontSize: 20, fontWeight: '600', color: t.label },
    emptyText: { fontSize: 15, color: t.secondary },
    error: { color: t.danger, fontSize: 15, textAlign: 'center' },
    retry: { color: t.tintText, fontSize: 17, fontWeight: '600' },
  })
}
