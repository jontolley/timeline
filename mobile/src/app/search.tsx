import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { searchEvents } from '@/api/events'
import { listThreads } from '@/api/threads'
import type { Thread, TimelineEvent } from '@/api/types'
import { CompactRow } from '@/components/EventCard'
import { Button, EmptyState, Icon } from '@/components/ui'
import { cardDay, kindLabel, placeLabel } from '@/lib/format'
import { activeFilterCount, filterParams, useFilterStore } from '@/store/filters'
import { cardShadow, font, useTheme, type Theme } from '@/theme'

// Keyword search over the user's moments (GET /events/search: titles,
// descriptions, places, tags and people's names), narrowed by the same
// filters as the Timeline. "#word" searches that tag exactly. Results are
// always newest first, like the web. Anything fuzzier is Chat's job, so the
// no-results state offers it.

const DEBOUNCE_MS = 250

// The query's matches in `text`, highlighted.
function Highlight({ text, q, style, mark }: { text: string; q: string; style: object; mark: object }) {
  if (!q) return <Text style={style}>{text}</Text>
  const parts: { s: string; hit: boolean }[] = []
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  let i = 0
  while (i < text.length) {
    const at = lower.indexOf(needle, i)
    if (at < 0) {
      parts.push({ s: text.slice(i), hit: false })
      break
    }
    if (at > i) parts.push({ s: text.slice(i, at), hit: false })
    parts.push({ s: text.slice(at, at + needle.length), hit: true })
    i = at + needle.length
  }
  return (
    <Text style={style}>
      {parts.map((p, k) => (
        <Text key={k} style={p.hit ? mark : undefined}>
          {p.s}
        </Text>
      ))}
    </Text>
  )
}

export default function SearchScreen() {
  const router = useRouter()
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const filters = useFilterStore((st) => st.filters)
  const nFilters = activeFilterCount(filters)
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TimelineEvent[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])

  useEffect(() => {
    listThreads()
      .then(setThreads)
      .catch(() => {})
  }, [])

  const raw = query.trim()
  const isTag = raw.startsWith('#') && raw.length > 1
  const term = isTag ? raw.slice(1) : raw

  // Debounced; `stale` drops a response for text that has since changed.
  useEffect(() => {
    if (!term) {
      setResults(null)
      setSearching(false)
      setError(null)
      return
    }
    let stale = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const { sort_by: _sort, ...narrow } = filterParams(filters)
        const hits = await searchEvents(isTag ? { ...narrow, tag: term } : { ...narrow, q: term })
        if (!stale) {
          setResults(hits)
          setError(null)
        }
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : 'Search failed.')
      } finally {
        if (!stale) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [term, isTag, filters])

  const threadChip =
    filters.threadIds.length === 0
      ? 'All threads'
      : filters.threadIds.length === 1
        ? (threads.find((th) => th._id === filters.threadIds[0])?.name ?? '1 thread')
        : `${filters.threadIds.length} threads`

  // What matched besides the title, so a hit on a place or tag reads clearly.
  const subFor = (ev: TimelineEvent) => {
    const day = cardDay(ev)
    const needle = term.toLowerCase()
    const place = placeLabel(ev.location)
    const tag = (ev.tags || []).find((x) => x.toLowerCase().includes(needle))
    const inTitle = !isTag && ev.title.toLowerCase().includes(needle)
    if (!inTitle && !isTag && place?.toLowerCase().includes(needle)) {
      return (
        <Text>
          {day} · <Highlight text={place} q={term} style={s.sub} mark={s.mark} />
        </Text>
      )
    }
    if (!inTitle && tag) {
      return (
        <Text>
          {day} · tag: <Highlight text={tag} q={term} style={s.sub} mark={s.mark} />
        </Text>
      )
    }
    return `${day} · ${kindLabel(ev)}`
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.top}>
        <View style={s.search}>
          <Icon name="magnifyingglass" size={18} color={t.secondary} />
          <TextInput
            ref={inputRef}
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search your moments"
            placeholderTextColor={t.secondary}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search"
          />
          {searching ? <ActivityIndicator size="small" color={t.secondary} /> : null}
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <Text style={s.link}>Cancel</Text>
        </Pressable>
      </View>

      <View style={s.chips}>
        <Pressable
          style={({ pressed }) => [s.chip, nFilters > 0 && s.chipOn, pressed && s.pressed]}
          onPress={() => router.push('/filters')}
          accessibilityRole="button"
        >
          <Icon name="line.3.horizontal.decrease" size={15} color={nFilters > 0 ? t.onTint : t.label} weight="bold" />
          <Text style={[s.chipText, nFilters > 0 && s.chipTextOn]}>
            {nFilters > 0 ? `Filters · ${nFilters}` : 'Filters'}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.chip, pressed && s.pressed]}
          onPress={() => router.push('/filters')}
          accessibilityRole="button"
        >
          <Text style={s.chipText} numberOfLines={1}>
            {threadChip}
          </Text>
        </Pressable>
      </View>

      {error && !results ? (
        <EmptyState icon="icloud.slash" tone="neutral" title="Search isn’t working" text={error} style={s.emptyBox} />
      ) : results && results.length === 0 && !searching ? (
        <EmptyState
          icon="magnifyingglass"
          title={`Nothing matches “${raw}”`}
          text="Try a different word. Or ask Chat — it understands questions like “when were we out on the water?”"
          style={s.emptyBox}
        >
          <Button
            label="Ask Chat"
            icon="sparkles"
            variant="tonal"
            small
            onPress={() => router.navigate('/chat')}
            style={{ marginTop: 10 }}
          />
        </EmptyState>
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(ev) => ev._id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={s.list}
          ListHeaderComponent={
            results && results.length ? (
              <Text style={s.sect}>
                {results.length} {results.length === 1 ? 'moment' : 'moments'}
                {results.length >= 50 ? ' (first 50)' : ''}
              </Text>
            ) : undefined
          }
          renderItem={({ item, index }) => (
            <View
              style={[s.resultBg, index === 0 && s.resultFirst, index === (results?.length ?? 0) - 1 && s.resultLast]}
            >
              <CompactRow
                event={item}
                first={index === 0}
                onPress={() => router.push(`/event/${item._id}`)}
                title={<Highlight text={item.title} q={isTag ? '' : term} style={{}} mark={s.mark} />}
                sub={subFor(item)}
              />
            </View>
          )}
          ListFooterComponent={
            <Text style={s.note}>
              Searches titles, descriptions, places, people and tags. Start with # to find a tag.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    pressed: { opacity: 0.6 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
    search: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 46,
      paddingHorizontal: 14,
      borderRadius: 23,
      backgroundColor: t.card,
      ...cardShadow(t),
    },
    input: { flex: 1, height: '100%', fontFamily: font.semibold, fontSize: 16.5, color: t.label },
    link: { fontFamily: font.heavy, fontSize: 16, color: t.tintText },
    chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 17,
      borderWidth: 1.5,
      borderColor: t.separator,
      maxWidth: 200,
    },
    chipOn: { backgroundColor: t.tint, borderColor: t.tint },
    chipText: { fontFamily: font.heavy, fontSize: 14.5, color: t.label, flexShrink: 1 },
    chipTextOn: { color: t.onTint },
    sect: {
      fontFamily: font.heavy,
      fontSize: 12,
      letterSpacing: 1,
      color: t.secondary,
      textTransform: 'uppercase',
      paddingHorizontal: 6,
      paddingTop: 18,
      paddingBottom: 8,
    },
    list: { paddingHorizontal: 16, paddingBottom: 40 },
    resultBg: { backgroundColor: t.card },
    resultFirst: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 4 },
    resultLast: { borderBottomLeftRadius: 22, borderBottomRightRadius: 22, paddingBottom: 4 },
    sub: { fontFamily: font.bold, fontSize: 13, color: t.secondary },
    mark: { backgroundColor: t.thirdSoft, color: t.label },
    note: {
      fontFamily: font.semibold,
      fontSize: 13.5,
      lineHeight: 19,
      color: t.secondary,
      paddingHorizontal: 8,
      paddingTop: 12,
    },
    emptyBox: { marginTop: 70, paddingHorizontal: 32 },
  })
}
