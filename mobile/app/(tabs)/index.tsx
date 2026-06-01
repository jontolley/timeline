import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { listEvents } from '../../src/api/events'
import type { TimelineEvent } from '../../src/api/types'
import { useAuthStore } from '../../src/store/auth'
import { useTimelineSignal } from '../../src/store/timeline'
import { colors } from '../../src/theme'

const PAGE_SIZE = 30

function formatDate(iso: string): string {
  // Dates are stored UTC; format in UTC to avoid a day shift (see the web
  // app's utils/date.js invariant).
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

function EventRow({ event, onPress }: { event: TimelineEvent; onPress: () => void }) {
  const thumb = event.media?.find((m) => m.thumb_url)?.thumb_url ?? null
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowDate}>{formatDate(event.date)}</Text>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {event.title}
        </Text>
        {event.description ? (
          <Text style={styles.rowDesc} numberOfLines={2}>
            {event.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

export default function TimelineScreen() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const refreshToken = useTimelineSignal((s) => s.refreshToken)

  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFirstPage = useCallback(async () => {
    setError(null)
    try {
      const page = await listEvents({ limit: PAGE_SIZE })
      setEvents(page)
      setHasMore(page.length === PAGE_SIZE)
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Timeline</Text>
          {user ? <Text style={styles.sub}>{user.email}</Text> : null}
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/event/new')} hitSlop={8} style={styles.addBtn}>
            <Text style={styles.addBtnText}>＋ Add</Text>
          </Pressable>
          <Pressable onPress={() => void signOut()} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => { setLoading(true); loadFirstPage().finally(() => setLoading(false)) }}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <EventRow event={item} onPress={() => router.push(`/event/${item._id}`)} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>No events yet.</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  h1: { fontSize: 28, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  addBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  signOut: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: 12,
    marginBottom: 12,
    gap: 12,
  },
  rowPressed: { opacity: 0.6 },
  thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.bg },
  thumbEmpty: { borderWidth: 1, borderColor: colors.rule },
  rowBody: { flex: 1, justifyContent: 'center' },
  rowDate: { fontSize: 12, color: colors.accent, fontWeight: '600', marginBottom: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  rowDesc: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  empty: { color: colors.inkSoft, fontSize: 15 },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  retry: { color: colors.accent, fontSize: 15, fontWeight: '600' },
})
