import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Linking,
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
import { MapThumb, MediaBadge } from '@/components/EventCard'
import PhotoViewer from '@/components/PhotoViewer'
import { Avatar, Button, EmptyState, GlassButton, Icon, RowIcon, Skeleton, Waveform } from '@/components/ui'
import { asLoc, fmtDuration, seedOf, type Loc } from '@/lib/format'
import { useRecordingPlayer } from '@/lib/useRecordingPlayer'
import { cardShadow, font, paletteColor, useTheme, type Theme } from '@/theme'

// Read-only event detail. Tapping a timeline card lands here (push/card); the
// "Edit" action pushes the shared EventForm at /event/:id/edit as a modal. On
// returning from edit we reload on focus so changes show; if the event was
// deleted from the edit screen, getEvent 404s and we bounce back to the
// timeline. Shared (non-owned) events hide Edit entirely.
//
// The hero is the moment's photos / video when it has them, otherwise a map of
// its place; an audio-led moment has no hero and opens with its player.

const HERO_H = 430
const MAP_HERO_H = 400

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
function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
// A single date reads in full; a range drops the weekday and, when it starts
// and ends on the same day, the second date ("Nov 4, 2026 at 2:00 PM – 4:00 PM").
function formatDateRange(start: string, end?: string | null): string {
  if (!end) return fmtDate(start) + (hasTime(start) ? ` at ${fmtTime(start)}` : '')
  const s = fmtShortDate(start) + (hasTime(start) ? ` at ${fmtTime(start)}` : '')
  const sameDay = start.slice(0, 10) === end.slice(0, 10)
  if (sameDay && hasTime(end)) return `${s} – ${fmtTime(end)}`
  if (sameDay) return s
  const e = fmtShortDate(end) + (hasTime(end) ? ` at ${fmtTime(end)}` : '')
  return `${s} – ${e}`
}

// A place shared from Google / Apple Maps opens its original link (the real
// place, in that app); otherwise a Google Maps pin or search.
function locationMapUrl(loc: Loc): string | null {
  if (loc.url) return loc.url
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

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// Where the moment falls in its year: a season-coloured bar with a marker on
// the day, and the month initials underneath.
function YearRibbon({ iso }: { iso: string }) {
  const t = useTheme()
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const start = Date.UTC(y, 0, 1)
  const pct = Math.min(1, Math.max(0, (d.getTime() - start) / (Date.UTC(y + 1, 0, 1) - start)))
  const month = d.getUTCMonth()
  // Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn.
  const segs: [number, string][] = [
    [2, t.winter],
    [3, t.spring],
    [3, t.summer],
    [3, t.autumn],
    [1, t.winter],
  ]
  return (
    <View style={ribbon.wrap} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={ribbon.line}>
        {segs.map(([n, c], i) => (
          <View key={i} style={{ flex: n, backgroundColor: c }} />
        ))}
      </View>
      <View style={[ribbon.mark, { left: `${pct * 100}%`, backgroundColor: t.card, borderColor: t.label }]} />
      <View style={ribbon.months}>
        {MONTH_INITIALS.map((m, i) => (
          <Text key={i} style={[ribbon.month, { color: i === month ? t.label : t.secondary }]}>
            {m}
          </Text>
        ))}
      </View>
    </View>
  )
}

const ribbon = StyleSheet.create({
  wrap: { height: 40, marginTop: 2, marginBottom: 16 },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 9,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  mark: { position: 'absolute', top: 2, width: 18, height: 18, borderRadius: 9, borderWidth: 4, marginLeft: -9 },
  months: { position: 'absolute', left: 0, right: 0, top: 22, flexDirection: 'row', justifyContent: 'space-between' },
  month: { fontFamily: font.heavy, fontSize: 10 },
})

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

  const backBar = (
    <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
      <GlassButton icon="chevron.left" accessibilityLabel="Back" onPress={() => router.back()} />
    </View>
  )

  if (loading) {
    return (
      <View style={styles.safe}>
        <Skeleton style={{ height: HERO_H, borderRadius: 0 }} />
        <View style={[styles.sheet, styles.sheetOverlap]}>
          <Skeleton style={{ height: 15, width: '55%' }} />
          <Skeleton style={{ height: 30, width: '80%', marginTop: 12 }} />
          <Skeleton style={{ height: 16, marginTop: 28 }} />
          <Skeleton style={{ height: 16, width: '90%', marginTop: 10 }} />
        </View>
      </View>
    )
  }

  if (error || !event) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        {backBar}
        <EmptyState
          icon="exclamationmark.triangle"
          tone="neutral"
          title="We couldn’t open this moment"
          text={error || 'It may have been deleted.'}
          style={{ marginTop: 80, paddingHorizontal: 32 }}
        >
          <Button label="Go back" small variant="tonal" onPress={() => router.back()} style={{ marginTop: 10 }} />
        </EmptyState>
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
  const coords = loc?.lat != null && loc?.lng != null ? { lat: loc.lat, lng: loc.lng } : null

  const media = event.media || []
  const visual = media.filter(isVisual)
  const audio = media.filter((m) => m.kind === 'audio')
  const pdfs = media.filter((m) => m.kind === 'pdf')
  const hero: 'photo' | 'map' | null = visual.length ? 'photo' : coords ? 'map' : null

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
        <Pressable
          style={({ pressed }) => [styles.row, pressed && !!mapUrl && styles.pressed]}
          onPress={() => openExternal(mapUrl)}
          disabled={!mapUrl}
        >
          <RowIcon icon="mappin" />
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {locName}
            </Text>
            {locSub ? (
              <Text style={styles.rowSub} numberOfLines={1}>
                {locSub}
              </Text>
            ) : null}
          </View>
          {mapUrl ? <Text style={styles.rowLink}>{hero === 'map' ? 'Open in Maps' : 'Maps'}</Text> : null}
        </Pressable>
      ),
    })
  }
  if (peopleNames.length) {
    rows.push({
      key: 'people',
      node: (
        <View style={styles.row}>
          <RowIcon icon="person.2.fill" tone="second" />
          <View style={[styles.rowMain, styles.chips]}>
            {peopleNames.map((name, i) => (
              <View key={`${name}-${i}`} style={styles.personChip}>
                <Avatar name={name} size={26} />
                <Text style={styles.chipText}>{name}</Text>
              </View>
            ))}
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
          <RowIcon icon="tag.fill" tone="third" />
          <View style={[styles.rowMain, styles.chips]}>
            {event.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.chipText}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    })
  }
  for (const m of pdfs) {
    rows.push({
      key: m.key,
      node: (
        <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => openExternal(m.url)}>
          <RowIcon icon="doc.text.fill" tone="danger" />
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Document</Text>
            {m.page_count ? (
              <Text style={styles.rowSub}>
                {m.page_count} page{m.page_count === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
          <Text style={styles.rowLink}>Open</Text>
        </Pressable>
      ),
    })
  }

  // Each recording gets a big player block above the description.
  const listen = audio.map((m) => <ListenBlock key={m.key} media={m} styles={styles} t={t} />)

  const onPhoto = hero === 'photo'
  const topBar = (
    <View style={[styles.topBar, hero && { position: 'absolute', top: insets.top + 6, left: 0, right: 0 }]}>
      <GlassButton icon="chevron.left" accessibilityLabel="Back" onPress={() => router.back()} onPhoto={onPhoto} />
      <View style={styles.topRight}>
        <GlassButton icon="square.and.arrow.up" accessibilityLabel="Share" onPress={share} onPhoto={onPhoto} />
        {!isShared ? (
          <GlassButton label="Edit" onPress={() => router.push(`/event/${event._id}/edit`)} onPhoto={onPhoto} />
        ) : null}
      </View>
    </View>
  )

  return (
    <View style={styles.safe}>
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {hero === 'photo' ? (
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
                    onPress={() => setLightbox(i)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={m.kind === 'video' ? 'Play video' : `Photo ${i + 1} of ${visual.length}`}
                  >
                    {s ? (
                      <Image source={s} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                    ) : null}
                    {m.kind === 'video' ? (
                      <View style={styles.heroCenter}>
                        <View style={styles.play}>
                          <Icon name="play.fill" size={34} color="#FFFFFF" />
                        </View>
                      </View>
                    ) : null}
                  </Pressable>
                )
              })}
            </ScrollView>
            {visual.length > 1 ? (
              <View style={styles.pager} pointerEvents="none">
                {visual.map((m, i) => (
                  <View key={m.key} style={[styles.pagerDot, i === page && styles.pagerDotOn]} />
                ))}
              </View>
            ) : visual[0]?.kind === 'video' && fmtDuration(visual[0].duration_seconds) ? (
              <View style={styles.heroBadge} pointerEvents="none">
                <MediaBadge icon="video" text={fmtDuration(visual[0].duration_seconds)!} />
              </View>
            ) : null}
          </View>
        ) : hero === 'map' && coords ? (
          <Pressable style={{ height: MAP_HERO_H }} onPress={() => openExternal(mapUrl)} disabled={!mapUrl}>
            <MapThumb lat={coords.lat} lng={coords.lng} zoom={13} style={StyleSheet.absoluteFill} />
            {locName ? (
              <View style={styles.heroBadge} pointerEvents="none">
                <MediaBadge icon="mappin" text={locName} left />
              </View>
            ) : null}
          </Pressable>
        ) : (
          <View style={{ paddingTop: insets.top + 6 }}>{topBar}</View>
        )}

        <View style={[styles.sheet, hero && styles.sheetOverlap]}>
          {isShared ? (
            <View style={styles.shared}>
              <Icon name="lock.fill" size={13} color={t.second} />
              <Text style={styles.sharedText}>
                {thread ? `Shared in ${thread.name}` : 'Shared with you'} · read only
              </Text>
            </View>
          ) : null}
          <View style={styles.dateRow}>
            <Icon name="calendar" size={15} color={t.tintText} />
            <Text style={styles.date}>{formatDateRange(event.date, event.end_date)}</Text>
          </View>
          {showThread ? (
            <View style={styles.threadRow}>
              <View style={[styles.dot, { backgroundColor: paletteColor(thread!.color, t.dark) }]} />
              <Text style={styles.threadText}>{thread!.name}</Text>
            </View>
          ) : null}
          <Text style={styles.title} accessibilityRole="header">
            {event.title}
          </Text>
          <YearRibbon iso={event.date} />

          {listen}

          {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

          {rows.length || (hero === 'photo' && coords) ? (
            <View style={styles.info}>
              {hero === 'photo' && coords ? (
                <Pressable onPress={() => openExternal(mapUrl)} disabled={!mapUrl} accessibilityLabel="Open in Maps">
                  <MapThumb lat={coords.lat} lng={coords.lng} style={{ height: 112 }} />
                </Pressable>
              ) : null}
              {rows.map((r, i) => (
                <Fragment key={r.key}>
                  {i > 0 || (hero === 'photo' && coords) ? <View style={styles.separator} /> : null}
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
                  <Pressable
                    key={m.key}
                    onPress={() => showPage(i)}
                    style={[styles.thumbWrap, i === page && { borderColor: t.tintText }]}
                    accessibilityLabel={`Show photo ${i + 1}`}
                  >
                    <View style={styles.thumb}>
                      {s ? <Image source={s} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
        </View>
      </ScrollView>

      {hero ? topBar : null}

      {lightbox !== null && visual[lightbox] ? (
        <PhotoViewer
          items={visual}
          initialIndex={lightbox}
          onClose={(last) => {
            setLightbox(null)
            // Land the hero on whichever photo the user swiped to.
            showPage(last)
          }}
        />
      ) : null}
    </View>
  )
}

// A recording's big player: plays in the app, filling the waveform as it
// goes, with the elapsed time beside the length once it's started.
function ListenBlock({ media, styles, t }: { media: MediaRef; styles: Styles; t: Theme }) {
  const rec = useRecordingPlayer(media.url, media.duration_seconds)
  const total = fmtDuration(rec.duration || media.duration_seconds)
  const onDark = t.dark ? t.bg : '#FFFFFF'
  return (
    <View style={styles.listen}>
      <View style={styles.listenRow}>
        <Pressable
          style={({ pressed }) => [styles.listenBtn, rec.playing && { paddingLeft: 0 }, pressed && styles.pressed]}
          onPress={() => void rec.toggle()}
          disabled={!media.url}
          accessibilityRole="button"
          accessibilityLabel={rec.playing ? 'Pause recording' : 'Play recording'}
        >
          {rec.loading ? (
            <ActivityIndicator color={onDark} />
          ) : (
            <Icon name={rec.playing ? 'pause.fill' : 'play.fill'} size={28} color={onDark} />
          )}
        </Pressable>
        <Waveform seed={seedOf(media.key)} bars={30} height={44} progress={rec.progress} on={t.audio} off={t.waveOff} />
      </View>
      <View style={styles.listenCap}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="waveform" size={14} color={t.secondary} />
          <Text style={styles.capText}>Audio recording</Text>
        </View>
        {total ? (
          <Text style={[styles.capText, { fontVariant: ['tabular-nums'] }]}>
            {rec.started ? `${fmtDuration(rec.position)} / ${total}` : total}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    pressed: { opacity: 0.6 },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
    topRight: { flexDirection: 'row', gap: 10 },
    heroCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    play: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(0,0,0,0.28)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 4,
    },
    pager: {
      position: 'absolute',
      bottom: 38,
      alignSelf: 'center',
      flexDirection: 'row',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    pagerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' },
    pagerDotOn: { width: 18, backgroundColor: '#FFFFFF' },
    // MediaBadge sits 9pt in from its parent; this lifts it above the sheet.
    heroBadge: { position: 'absolute', left: 7, right: 7, bottom: 29, height: 40 },
    sheet: { backgroundColor: t.bg, paddingHorizontal: 20, paddingTop: 6 },
    sheetOverlap: { marginTop: -26, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 24 },
    shared: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 30,
      paddingHorizontal: 12,
      borderRadius: 15,
      backgroundColor: t.secondSoft,
      marginBottom: 10,
    },
    sharedText: { fontFamily: font.heavy, fontSize: 13, color: t.second },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    date: { flexShrink: 1, fontFamily: font.heavy, fontSize: 14.5, color: t.tintText },
    threadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    threadText: { fontFamily: font.bold, fontSize: 14, color: t.secondary },
    dot: { width: 8, height: 8, borderRadius: 4 },
    title: {
      fontFamily: font.serif,
      fontSize: 31,
      lineHeight: 35,
      color: t.label,
      letterSpacing: -0.3,
      marginTop: 6,
      marginBottom: 12,
    },
    description: { fontFamily: font.body, fontSize: 17.5, lineHeight: 27, color: t.body },
    listen: { padding: 16, borderRadius: 24, backgroundColor: t.audioSoft, marginTop: 4, marginBottom: 18 },
    listenRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    listenBtn: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.audio,
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 4,
    },
    listenCap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 8 },
    capText: { fontFamily: font.bold, fontSize: 13, color: t.secondary },
    info: { marginTop: 20, backgroundColor: t.card, borderRadius: 24, overflow: 'hidden', ...cardShadow(t) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 13,
      minHeight: 62,
    },
    rowMain: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: font.heavy, fontSize: 16, lineHeight: 21, color: t.label },
    rowSub: { fontFamily: font.semibold, fontSize: 14, lineHeight: 18, color: t.secondary },
    rowLink: { fontFamily: font.heavy, fontSize: 15.5, color: t.tintText },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.separator },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    personChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 34,
      paddingLeft: 4,
      paddingRight: 12,
      borderRadius: 17,
      backgroundColor: t.surface2,
    },
    tag: {
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 17,
      backgroundColor: t.thirdSoft,
      justifyContent: 'center',
    },
    chipText: { fontFamily: font.heavy, fontSize: 14.5, color: t.label },
    thumbs: { gap: 10, marginTop: 18, paddingVertical: 3, paddingHorizontal: 1 },
    thumbWrap: { borderRadius: 21, borderWidth: 3, borderColor: 'transparent', padding: 2 },
    thumb: { width: 76, height: 76, borderRadius: 16, overflow: 'hidden', backgroundColor: t.photoPlaceholder },
  })
}
