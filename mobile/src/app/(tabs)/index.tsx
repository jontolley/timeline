import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListViewToken,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { listEventYears, listEvents } from '@/api/events'
import { listPeople } from '@/api/people'
import { listThreads } from '@/api/threads'
import type { Person, Thread, TimelineEvent, YearCount } from '@/api/types'
import { CompactRow, EventCard } from '@/components/EventCard'
import { Avatar, Button, EmptyState, GlassButton, Icon, Skeleton, TintButton } from '@/components/ui'
import YearScrubber from '@/components/YearScrubber'
import { gapLabel, monthKey, monthName, peopleNames, todayLabel } from '@/lib/format'
import { useAuthStore } from '@/store/auth'
import { activeFilterCount, filterParams, sortDateOf, useFilterStore, type SortBy } from '@/store/filters'
import { useTimelineSignal } from '@/store/timeline'
import { SEASON_LABEL, cardShadow, font, seasonOf, useTheme, type Season, type Theme } from '@/theme'

const PAGE_SIZE = 30
// How long a year's page is reused. Short enough that edits made on another
// device show up, and well inside the 1h life of the signed media URLs the
// page carries.
const YEAR_CACHE_MS = 10 * 60 * 1000
// A month with this many moments is drawn as one compact card of rows.
const BUSY_MONTH = 6

// The axis: a 4pt ribbon at x 22–26 runs down the left edge, coloured by
// season; cards sit to its right with a ring dot on the ribbon.
const AXIS_X = 22
const CONTENT_X = 50

// The timeline is one flat list (not a SectionList) so only the year rows
// stick: SectionList makes either every section header sticky or none.
type Row =
  | { kind: 'today'; key: string }
  | {
      kind: 'year'
      key: string
      year: number
      count: number | null
      season: Season
    }
  | { kind: 'season'; key: string; season: Season }
  | {
      kind: 'month'
      key: string
      title: string
      count: number
      season: Season
      year: number
    }
  | {
      kind: 'event'
      key: string
      event: TimelineEvent
      season: Season
      now: boolean
    }
  | { kind: 'group'; key: string; events: TimelineEvent[]; season: Season }
  | { kind: 'gap'; key: string; label: string }

function toRows(
  events: TimelineEvent[],
  sortBy: SortBy,
  countByYear: Record<number, number>,
  withToday: boolean,
): Row[] {
  const out: Row[] = withToday ? [{ kind: 'today', key: 'today' }] : []
  // Bucket by month first, so busy months can be grouped and counted.
  const months: { key: string; events: TimelineEvent[] }[] = []
  for (const ev of events) {
    const k = monthKey(sortDateOf(ev, sortBy))
    const last = months[months.length - 1]
    if (last && last.key === k) last.events.push(ev)
    else months.push({ key: k, events: [ev] })
  }
  let year: number | null = null
  let season: Season | null = null
  let prevKey: string | null = null
  let first = true
  for (const m of months) {
    const y = Number(m.key.slice(0, 4))
    const iso = `${m.key}-15T00:00:00Z`
    const sea = seasonOf(iso)
    if (prevKey) {
      const gap = gapLabel(prevKey, m.key)
      if (gap) out.push({ kind: 'gap', key: `g-${m.key}`, label: gap })
    }
    if (y !== year) {
      out.push({
        kind: 'year',
        key: `y-${y}`,
        year: y,
        count: countByYear[y] ?? null,
        season: sea,
      })
      year = y
      season = null
    }
    if (sea !== season) {
      out.push({ kind: 'season', key: `s-${m.key}`, season: sea })
      season = sea
    }
    out.push({
      kind: 'month',
      key: `m-${m.key}`,
      title: monthName(iso),
      count: m.events.length,
      season: sea,
      year: y,
    })
    if (m.events.length >= BUSY_MONTH) {
      out.push({
        kind: 'group',
        key: `c-${m.key}`,
        events: m.events,
        season: sea,
      })
      first = false
    } else {
      for (const ev of m.events) {
        out.push({
          kind: 'event',
          key: ev._id,
          event: ev,
          season: sea,
          now: first && withToday,
        })
        first = false
      }
    }
    prevKey = m.key
  }
  return out
}

function rowYear(row: Row, sortBy: SortBy): number | null {
  if (row.kind === 'year' || row.kind === 'month') return row.year
  if (row.kind === 'event') return Number(sortDateOf(row.event, sortBy).slice(0, 4))
  if (row.kind === 'group') return Number(sortDateOf(row.events[0], sortBy).slice(0, 4))
  return null
}

export default function TimelineScreen() {
  const router = useRouter()
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const insets = useSafeAreaInsets()
  const refreshToken = useTimelineSignal((st) => st.refreshToken)
  const email = useAuthStore((st) => st.user?.email ?? '')
  const filters = useFilterStore((st) => st.filters)
  const clearFilters = useFilterStore((st) => st.clear)
  const sortBy = filters.sortBy
  const nFilters = activeFilterCount(filters)

  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [threads, setThreads] = useState<Thread[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [years, setYears] = useState<YearCount[]>([])
  // Year being read (or just jumped to); null = the newest year.
  const [viewYear, setViewYear] = useState<number | null>(null)
  // True while showing a jumped-to window rather than the newest page.
  const [jumped, setJumped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  // A jumped-to window starts mid-timeline, so there are newer moments above
  // it to load as you scroll up. `anchorNewer` turns on the list's
  // keep-my-place behaviour; it's only switched on once a jump's scroll has
  // settled, so swapping in a whole new window can't drag the offset around.
  const [hasNewer, setHasNewer] = useState(false)
  const [anchorNewer, setAnchorNewer] = useState(false)
  const loadingNewer = useRef(false)
  // Bumped whenever the window is replaced (first page or a jump), so a page
  // that was in flight for the old window is dropped instead of spliced in.
  const windowGen = useRef(0)
  const [error, setError] = useState<string | null>(null)

  // First page of each year's window, so going back to a year is instant.
  // Cleared whenever the first page reloads (pull-to-refresh, a create/edit
  // signal, or a filter change); `cacheGen` keeps a fetch from before the
  // clear from refilling it.
  const yearCache = useRef(new Map<number, { page: TimelineEvent[]; at: number }>())
  const yearFetches = useRef(new Map<number, Promise<TimelineEvent[]>>())
  const cacheGen = useRef(0)
  const params = useMemo(() => filterParams(filters), [filters])

  const loadFirstPage = useCallback(async () => {
    setError(null)
    try {
      const [page, yrs, thr, ppl] = await Promise.all([
        listEvents({ ...params, limit: PAGE_SIZE }),
        listEventYears(params).catch(() => [] as YearCount[]),
        listThreads().catch(() => [] as Thread[]),
        listPeople().catch(() => [] as Person[]),
      ])
      const sortedYears = [...yrs].sort((a, b) => b.year - a.year)
      cacheGen.current += 1
      yearCache.current.clear()
      yearFetches.current.clear()
      if (sortedYears[0]) yearCache.current.set(sortedYears[0].year, { page, at: Date.now() })
      windowGen.current += 1
      jumpToken.current += 1
      setEvents(page)
      setHasMore(page.length === PAGE_SIZE)
      setHasNewer(false)
      setAnchorNewer(false)
      setYears(sortedYears)
      setThreads(thr)
      setPeople(ppl)
      setViewYear(null)
      setJumped(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline.')
    }
  }, [params])

  // Loads on mount and again whenever the filters change.
  useEffect(() => {
    setLoading(true)
    loadFirstPage().finally(() => setLoading(false))
  }, [loadFirstPage])

  // Reload (quietly, no skeleton) when another screen signals a create, edit
  // or delete. Skip the initial render — mount already loads.
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
    const gen = windowGen.current
    try {
      const oldest = events[events.length - 1]
      // Bidirectional cursor: before_date + before_id returns older events
      // (DESC), matching the web infinite-scroll-down contract. With
      // sort_by=created_at the cursor is the created-at timestamp.
      const page = await listEvents({
        ...params,
        limit: PAGE_SIZE,
        before_date: sortDateOf(oldest, sortBy),
        before_id: oldest._id,
      })
      if (gen !== windowGen.current) return
      setEvents((prev) => [...prev, ...page])
      setHasMore(page.length === PAGE_SIZE)
    } catch {
      // Keep what we have; pull-to-refresh can retry.
    } finally {
      setLoadingMore(false)
    }
  }, [events, hasMore, loadingMore, params, sortBy])

  // Scrolling up in a jumped-to window: fetch the moments just newer than the
  // top one and put them above it. The backend's after_date + after_id cursor
  // returns the page closest to the cursor, newest first. Once a short page
  // comes back the window reaches today, so it becomes the ordinary timeline.
  const loadNewer = useCallback(async () => {
    if (loadingNewer.current || !hasNewer || !anchorNewer || events.length === 0) return
    loadingNewer.current = true
    const gen = windowGen.current
    try {
      const newest = events[0]
      const page = await listEvents({
        ...params,
        limit: PAGE_SIZE,
        after_date: sortDateOf(newest, sortBy),
        after_id: newest._id,
      })
      if (gen !== windowGen.current) return
      setEvents((prev) => [...page, ...prev])
      if (page.length < PAGE_SIZE) {
        setHasNewer(false)
        setJumped(false)
      }
    } catch {
      // Keep what we have; scrolling up again retries.
    } finally {
      loadingNewer.current = false
    }
  }, [anchorNewer, events, hasNewer, params, sortBy])

  // A jump lands on the top of its window, already close to the newer edge,
  // so fetch one newer page straight away; after that, onStartReached loads
  // more as you scroll up.
  useEffect(() => {
    if (anchorNewer && hasNewer) void loadNewer()
    // Only when the anchor switches on, not on every loadNewer identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorNewer])

  const listRef = useRef<FlatList<Row>>(null)
  const scrollY = useRef(0)
  // Height of the title block + today row: scrolled past it, the year row is
  // pinned to the top and the search / ＋ buttons appear beside it.
  const headerH = useRef(0)
  const [headerBottom, setHeaderBottom] = useState(0)
  const [pinned, setPinned] = useState(false)
  const pinFade = useRef(new Animated.Value(0)).current
  useEffect(() => {
    pinFade.setValue(0)
    if (pinned) Animated.timing(pinFade, { toValue: 1, duration: 180, useNativeDriver: true }).start()
  }, [pinned, pinFade])

  // A year jump replaces the window: everything before Jan 1 of the next year,
  // so the list starts at that year's newest moment and scrolls on into older
  // years. The newest year goes back to the top page. Shared by the scrubber's
  // drag (to get a head start) and its release, so a jump makes one request; a
  // cached page skips the network entirely.
  const fetchYear = useCallback(
    (year: number): Promise<TimelineEvent[]> => {
      const hit = yearCache.current.get(year)
      if (hit && Date.now() - hit.at < YEAR_CACHE_MS) return Promise.resolve(hit.page)
      let p = yearFetches.current.get(year)
      if (!p) {
        const gen = cacheGen.current
        const newest = years[0] && year === years[0].year
        p = listEvents(
          newest
            ? { ...params, limit: PAGE_SIZE }
            : {
                ...params,
                limit: PAGE_SIZE,
                before_date: `${year + 1}-01-01T00:00:00.000Z`,
              },
        )
          .then((page) => {
            if (gen === cacheGen.current) yearCache.current.set(year, { page, at: Date.now() })
            return page
          })
          .finally(() => {
            if (yearFetches.current.get(year) === p) yearFetches.current.delete(year)
          })
        yearFetches.current.set(year, p)
      }
      return p
    },
    [years, params],
  )

  // Only the latest jump applies, so a slow fetch can't land on top of a later one.
  const jumpToken = useRef(0)
  const jumpTo = useCallback(
    async (year: number) => {
      const token = ++jumpToken.current
      setViewYear(year)
      let page: TimelineEvent[]
      try {
        page = await fetchYear(year)
      } catch (e) {
        if (token === jumpToken.current) setError(e instanceof Error ? e.message : 'Failed to load timeline.')
        return
      }
      if (token !== jumpToken.current) return
      const newest = years[0] && year === years[0].year
      windowGen.current += 1
      setEvents(page)
      setHasMore(page.length === PAGE_SIZE)
      setHasNewer(!newest && page.length > 0)
      setAnchorNewer(false)
      setViewYear(year)
      setJumped(!newest)
      // Start the new window at its top (the year row pinned), not mid-way
      // down at the old offset. A non-animated scroll fires no onScroll on
      // iOS, so set the pinned state it would have.
      scrollY.current = newest ? 0 : headerH.current
      setPinned(!newest)
      listRef.current?.scrollToOffset({
        offset: newest ? 0 : headerH.current,
        animated: false,
      })
      // Two frames: one for the new window to mount, one for the scroll to
      // land. Only then may prepending newer pages hold the position.
      if (!newest) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (token === jumpToken.current) setAnchorNewer(true)
          }),
        )
      }
    },
    [fetchYear, years],
  )

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y
    scrollY.current = y
    const next = y > headerH.current - 2
    setPinned((p) => (p === next ? p : next))
  }, [])

  // Highlight the year being read on the scrubber. FlatList requires these to
  // keep the same identity across renders, so read sortBy through a ref.
  const sortRef = useRef(sortBy)
  sortRef.current = sortBy
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 }).current
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    for (const v of viewableItems) {
      const y = rowYear(v.item as Row, sortRef.current)
      if (y != null) {
        setViewYear(y)
        return
      }
    }
  }).current

  const countByYear = useMemo(() => Object.fromEntries(years.map((y) => [y.year, y.count])), [years])
  const rows = useMemo(() => toRows(events, sortBy, countByYear, !jumped), [events, sortBy, countByYear, jumped])
  const stickyIndices = useMemo(
    // +1: the ListHeaderComponent counts as index 0.
    () => rows.flatMap((r, i) => (r.kind === 'year' ? [i + 1] : [])),
    [rows],
  )
  const threadById = useMemo(() => Object.fromEntries(threads.map((th) => [th._id, th])), [threads])
  const nameById = useMemo(() => Object.fromEntries(people.map((p) => [p._id, p.name])), [people])
  const showThread = threads.length > 1
  const showScrubber = years.length > 1
  const activeYear = viewYear ?? years[0]?.year ?? null
  const total = years.reduce((n, y) => n + y.count, 0)
  const since = years.length ? years[years.length - 1].year : null

  const openEvent = useCallback((id: string) => router.push(`/event/${id}`), [router])

  const subtitle =
    nFilters > 0
      ? `${total} ${total === 1 ? 'moment matches' : 'moments match'}`
      : total > 0 && since
        ? `${total} ${total === 1 ? 'moment' : 'moments'} since ${since}`
        : null

  const header = (
    <View
      style={s.header}
      onLayout={(e) => {
        headerH.current = e.nativeEvent.layout.height
        setHeaderBottom(e.nativeEvent.layout.height)
      }}
    >
      <View style={s.topRow}>
        <Pressable
          onPress={() => router.push('/account')}
          accessibilityRole="button"
          accessibilityLabel="Account"
          hitSlop={4}
        >
          <Avatar name={email || '?'} color={t.second} size={44} />
        </Pressable>
        <View style={s.topRight}>
          <GlassButton icon="magnifyingglass" accessibilityLabel="Search" onPress={() => router.push('/search')} />
          <Button label="Add" icon="plus" small onPress={() => router.push('/event/new')} style={s.addPill} />
        </View>
      </View>
      <Text style={s.h1} accessibilityRole="header">
        Your timeline
      </Text>
      {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
      {nFilters > 0 ? (
        <View style={s.filterRow}>
          <Pressable
            style={({ pressed }) => [s.filterChip, pressed && s.pressed]}
            onPress={() => router.push('/filters')}
          >
            <Icon name="line.3.horizontal.decrease" size={15} color={t.onTint} weight="bold" />
            <Text style={s.filterChipText}>
              {nFilters} {nFilters === 1 ? 'filter' : 'filters'}
            </Text>
          </Pressable>
          <Pressable onPress={clearFilters} hitSlop={8} accessibilityRole="button">
            <Text style={s.link}>Clear</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )

  const renderRow = ({ item: row }: { item: Row }) => {
    switch (row.kind) {
      case 'today':
        return (
          <View style={s.today}>
            <View style={[s.rib, { top: 18, backgroundColor: t.separator }]} />
            <View style={s.todayHalo}>
              <View style={s.todayDot} />
            </View>
            <Text style={s.todayText}>TODAY · {todayLabel().toUpperCase()}</Text>
          </View>
        )
      case 'year':
        return (
          <View style={s.yearRow}>
            <View style={[s.rib, { backgroundColor: t[row.season] }]} />
            <View style={s.yearPill}>
              <Text style={s.yearText}>{row.year}</Text>
              {row.count != null ? (
                <Text style={s.yearCount}>
                  {row.count} {row.count === 1 ? 'moment' : 'moments'}
                </Text>
              ) : null}
            </View>
          </View>
        )
      case 'season':
        return (
          <View style={s.band}>
            <View style={[s.rib, { backgroundColor: t[row.season] }]} />
            <Text style={[s.season, { color: t[row.season] }]}>{SEASON_LABEL[row.season]}</Text>
          </View>
        )
      case 'month':
        return (
          <View style={[s.band, s.monthRow]}>
            <View style={[s.rib, { backgroundColor: t[row.season] }]} />
            <Text style={s.month}>{row.title}</Text>
            {row.count >= 2 ? (
              <Text style={s.monthCount}>
                {row.count} moments
                {row.count >= BUSY_MONTH ? ' · busy month' : ''}
              </Text>
            ) : null}
          </View>
        )
      case 'event': {
        const th = threadById[row.event.thread_id]
        return (
          <View style={[s.band, s.eventRow, showScrubber && s.withScrubber]}>
            <View style={[s.rib, { backgroundColor: t[row.season] }]} />
            <View style={[s.ring, { borderColor: t[row.season] }, row.now && { backgroundColor: t[row.season] }]} />
            <EventCard
              event={row.event}
              names={peopleNames(row.event, nameById)}
              thread={showThread && th ? th : null}
              onPress={() => openEvent(row.event._id)}
            />
          </View>
        )
      }
      case 'group':
        return (
          <View style={[s.band, s.eventRow, showScrubber && s.withScrubber]}>
            <View style={[s.rib, { backgroundColor: t[row.season] }]} />
            <View style={s.group}>
              {row.events.map((ev, i) => (
                <View key={ev._id}>
                  <View style={[s.smallDot, { backgroundColor: t[row.season] }]} />
                  <CompactRow event={ev} first={i === 0} onPress={() => openEvent(ev._id)} />
                </View>
              ))}
            </View>
          </View>
        )
      case 'gap':
        return (
          <View style={s.gap}>
            <View style={s.dashes}>
              {Array.from({ length: 6 }, (_, i) => (
                <View key={i} style={s.dash} />
              ))}
            </View>
            <Text style={s.gapText}>{row.label}</Text>
          </View>
        )
    }
  }

  const skeleton = (
    <View style={s.skel}>
      {[0, 1].map((i) => (
        <View key={i} style={s.skelCard}>
          <Skeleton style={{ height: 160, borderRadius: 17 }} />
          <Skeleton style={{ height: 18, width: '70%', marginTop: 14 }} />
          <Skeleton style={{ height: 13, width: '45%', marginTop: 10 }} />
        </View>
      ))}
    </View>
  )

  const empty =
    nFilters > 0 ? (
      <EmptyState
        icon="line.3.horizontal.decrease"
        title="Nothing fits those filters."
        text="Try fewer threads or people."
        style={s.emptyBox}
      >
        <Button label="Clear filters" variant="tonal" small onPress={clearFilters} style={{ marginTop: 8 }} />
      </EmptyState>
    ) : (
      <View style={s.firstRun}>
        <View style={s.firstCard}>
          <EmptyState
            icon="sparkles"
            title="Your story starts here"
            text="Add a photo, a place, a few words — whatever you want to remember."
            style={{ paddingVertical: 8 }}
          >
            <Button
              label="Add your first moment"
              icon="plus"
              onPress={() => router.push('/event/new')}
              style={{ marginTop: 10 }}
            />
          </EmptyState>
        </View>
        <View style={s.tip}>
          <Icon name="square.and.arrow.up" size={18} color={t.tintText} />
          <Text style={s.tipText}>Tip: share a photo or a map link to Hindsite from any app to start a moment.</Text>
        </View>
      </View>
    )

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.body}>
        {loading ? (
          <>
            {header}
            {skeleton}
          </>
        ) : error && events.length === 0 ? (
          <>
            {header}
            <EmptyState
              icon="icloud.slash"
              tone="neutral"
              title="We couldn’t load your timeline"
              text="Check your connection, then try again. Your moments are safe."
              style={s.emptyBox}
            >
              <Button
                label="Try again"
                icon="arrow.clockwise"
                small
                onPress={() => {
                  setLoading(true)
                  loadFirstPage().finally(() => setLoading(false))
                }}
                style={{ marginTop: 10 }}
              />
            </EmptyState>
          </>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(row) => row.key}
            ListHeaderComponent={header}
            renderItem={renderRow}
            stickyHeaderIndices={stickyIndices}
            onScroll={onScroll}
          // The year scrubber owns the right edge.
          showsVerticalScrollIndicator={!showScrubber}
            scrollEventThrottle={16}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            contentContainerStyle={s.list}
            // Native tabs float over the list; let iOS inset the scroll content
            // so the last cards can scroll clear of the tab bar.
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            onStartReached={hasNewer ? loadNewer : undefined}
            onStartReachedThreshold={1}
            // Keep the row you're reading still while newer moments are added
            // above it. Index 0 is the header, which never moves, so anchor on
            // the first row after it.
            maintainVisibleContentPosition={anchorNewer ? { minIndexForVisible: 1 } : undefined}
            ListEmptyComponent={empty}
            ListFooterComponent={
              loadingMore ? <ActivityIndicator color={t.secondary} style={{ marginVertical: 20 }} /> : undefined
            }
          />
        )}

        {/* Pinned beside the sticky year row once the header scrolls away.
            Mounted only while pinned: native Liquid Glass ignores an
            ancestor's opacity, so fading it out would leave a ghost. */}
        {!loading && rows.length > 0 && pinned ? (
          <Animated.View
            style={[
              s.pinned,
              {
                opacity: pinFade,
                transform: [
                  {
                    translateY: pinFade.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-4, 0],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents="box-none"
          >
            <GlassButton
              icon="magnifyingglass"
              size={40}
              accessibilityLabel="Search"
              onPress={() => router.push('/search')}
            />
            <TintButton
              icon="plus"
              size={40}
              accessibilityLabel="New moment"
              onPress={() => router.push('/event/new')}
            />
          </Animated.View>
        ) : null}

        {!loading && showScrubber && rows.length > 0 ? (
          <YearScrubber
            years={years.map((y) => y.year)}
            active={activeYear}
            onJump={(y) => void jumpTo(y)}
            onPrefetch={(y) => void fetchYear(y).catch(() => {})}
            top={pinned ? 64 : Math.max(64, headerBottom + 8)}
            bottom={insets.bottom + 70}
          />
        ) : null}
      </View>
    </SafeAreaView>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    body: { flex: 1 },
    pressed: { opacity: 0.6 },
    header: { paddingBottom: 14 },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      height: 50,
      marginTop: 4,
      paddingHorizontal: 18,
    },
    topRight: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    addPill: { paddingLeft: 14 },
    h1: {
      fontFamily: font.serif,
      fontSize: 34,
      lineHeight: 40,
      color: t.label,
      letterSpacing: -0.3,
      paddingHorizontal: 20,
      marginTop: 10,
    },
    sub: {
      fontFamily: font.bold,
      fontSize: 15,
      color: t.secondary,
      paddingHorizontal: 20,
      marginTop: 2,
    },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 20,
      marginTop: 12,
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 34,
      paddingHorizontal: 14,
      borderRadius: 17,
      backgroundColor: t.tint,
    },
    filterChipText: { fontFamily: font.heavy, fontSize: 14, color: t.onTint },
    link: { fontFamily: font.heavy, fontSize: 15, color: t.tintText },
    list: { paddingBottom: 24 },

    // Ribbon segment behind each row.
    rib: { position: 'absolute', left: AXIS_X, width: 4, top: 0, bottom: 0 },
    band: { paddingLeft: CONTENT_X, paddingRight: 18 },
    withScrubber: { paddingRight: 34 },

    today: { paddingLeft: CONTENT_X, paddingBottom: 14 },
    todayHalo: {
      position: 'absolute',
      left: AXIS_X + 2 - 12,
      top: -3,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    todayDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: t.tint,
    },
    todayText: {
      fontFamily: font.heavy,
      fontSize: 13,
      color: t.tintText,
      letterSpacing: 0.3,
    },

    // Solid background so cards scroll out of sight beneath it when pinned.
    yearRow: {
      paddingTop: 6,
      paddingBottom: 10,
      paddingLeft: 8,
      backgroundColor: t.bg,
    },
    yearPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 40,
      paddingHorizontal: 16,
      borderRadius: 20,
      backgroundColor: t.label,
    },
    yearText: {
      fontFamily: font.heavy,
      fontSize: 18,
      color: t.bg,
      fontVariant: ['tabular-nums'],
    },
    yearCount: {
      fontFamily: font.bold,
      fontSize: 12,
      color: t.bg,
      opacity: 0.7,
    },

    season: { fontFamily: font.serifItalic, fontSize: 17, paddingTop: 6 },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      paddingTop: 8,
      paddingBottom: 10,
    },
    month: { fontFamily: font.serifMedium, fontSize: 23, color: t.label },
    monthCount: { fontFamily: font.bold, fontSize: 14, color: t.secondary },

    eventRow: { paddingBottom: 16 },
    ring: {
      position: 'absolute',
      left: AXIS_X - 8,
      top: 22,
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 4,
      backgroundColor: t.bg,
      zIndex: 2,
    },
    group: { backgroundColor: t.card, borderRadius: 22, ...cardShadow(t) },
    smallDot: {
      position: 'absolute',
      left: AXIS_X - 5 - CONTENT_X,
      top: '50%',
      marginTop: -7,
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 3,
      borderColor: t.bg,
    },

    gap: { paddingLeft: CONTENT_X, paddingTop: 12, paddingBottom: 18 },
    dashes: {
      position: 'absolute',
      left: AXIS_X,
      top: 0,
      bottom: 0,
      width: 4,
      justifyContent: 'space-evenly',
    },
    dash: {
      width: 4,
      height: 6,
      borderRadius: 1,
      backgroundColor: t.separator,
    },
    gapText: { fontFamily: font.serifItalic, fontSize: 16, color: t.secondary },

    pinned: {
      position: 'absolute',
      right: 14,
      flexDirection: 'row',
      gap: 8,
      zIndex: 20,
      top: 6,
    },

    skel: { paddingLeft: CONTENT_X, paddingRight: 18, paddingTop: 14, gap: 16 },
    skelCard: {
      backgroundColor: t.card,
      borderRadius: 24,
      padding: 9,
      paddingBottom: 16,
      ...cardShadow(t),
    },
    emptyBox: { marginTop: 60, paddingHorizontal: 32 },
    firstRun: { paddingHorizontal: 18, paddingTop: 10, gap: 14 },
    firstCard: {
      backgroundColor: t.card,
      borderRadius: 24,
      padding: 20,
      ...cardShadow(t),
    },
    tip: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      paddingHorizontal: 8,
    },
    tipText: {
      flex: 1,
      fontFamily: font.semibold,
      fontSize: 14,
      lineHeight: 19,
      color: t.secondary,
    },
  })
}
