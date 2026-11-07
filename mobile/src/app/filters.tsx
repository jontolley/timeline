import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { listPeople } from '@/api/people'
import { listThreads } from '@/api/threads'
import type { Person, Thread } from '@/api/types'
import { Avatar, Icon, Skeleton, TintButton } from '@/components/ui'
import { useFilterStore, type Filters, type SortBy } from '@/store/filters'
import { cardShadow, font, paletteColor, useTheme, type Theme } from '@/theme'

// The phone version of the web FilterModal: narrow the Timeline and Search to
// some threads and/or people, and sort by when it happened or when it was
// added. Edits a draft, so swiping the sheet away changes nothing; ✓ applies.
// Clear empties threads and people but keeps the sort (it isn't a filter).

const SORTS: { key: SortBy; label: string }[] = [
  { key: 'date', label: 'When it happened' },
  { key: 'created_at', label: 'When it was added' },
]

export default function FiltersSheet() {
  const router = useRouter()
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const current = useFilterStore((st) => st.filters)
  const setFilters = useFilterStore((st) => st.setFilters)
  const [draft, setDraft] = useState<Filters>(current)
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [people, setPeople] = useState<Person[] | null>(null)

  useEffect(() => {
    listThreads()
      .then(setThreads)
      .catch(() => setThreads([]))
    listPeople()
      .then((list) => setPeople([...list].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setPeople([]))
  }, [])

  const toggle = (key: 'threadIds' | 'personIds', id: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id] }))

  const apply = () => {
    setFilters(draft)
    router.back()
  }

  return (
    // The header lives inside the ScrollView (sticky): a sibling header above
    // it gets drawn over by the ScrollView inside an iOS form sheet.
    // (RN swaps a sticky child's own style for flex: 1, hence the wrapper.)
    <ScrollView style={s.sheet} contentContainerStyle={s.scroll} stickyHeaderIndices={[0]}>
      <View style={s.headerWrap}>
        <View style={s.header}>
          <Pressable
            onPress={() => setDraft((d) => ({ ...d, threadIds: [], personIds: [] }))}
            hitSlop={8}
            accessibilityRole="button"
            style={{ width: 60 }}
          >
            <Text style={s.link}>Clear</Text>
          </Pressable>
          <Text style={s.title}>Filter</Text>
          <View style={{ width: 60, alignItems: 'flex-end' }}>
            <TintButton icon="checkmark" accessibilityLabel="Apply filters" onPress={apply} />
          </View>
        </View>
      </View>

      <View style={s.body}>
        {threads === null || threads.length > 1 ? (
          <>
            <Text style={s.sect}>THREADS</Text>
            <View style={s.card}>
              {threads === null ? (
                <Skeleton style={{ height: 52, margin: 8 }} />
              ) : (
                threads.map((th, i) => {
                  const on = draft.threadIds.includes(th._id)
                  return (
                    <Pressable
                      key={th._id}
                      style={({ pressed }) => [s.row, i > 0 && s.rule, pressed && s.pressed]}
                      onPress={() => toggle('threadIds', th._id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <View style={[s.dot, { backgroundColor: paletteColor(th.color, t.dark) }]} />
                      <Text style={s.rowText} numberOfLines={1}>
                        {th.name}
                      </Text>
                      {th.subscription ? <Text style={s.shared}>Shared</Text> : null}
                      {on ? (
                        <View style={s.check}>
                          <Icon name="checkmark" size={14} color={t.onTint} weight="bold" />
                        </View>
                      ) : (
                        <View style={s.uncheck} />
                      )}
                    </Pressable>
                  )
                })
              )}
            </View>
            <Text style={s.note}>None ticked shows every thread.</Text>
          </>
        ) : null}

        <Text style={s.sect}>PEOPLE</Text>
        {people === null ? (
          <Skeleton style={{ height: 34, marginHorizontal: 4 }} />
        ) : people.length === 0 ? (
          <Text style={s.note}>No people yet. Add them to a moment and they’ll show up here.</Text>
        ) : (
          <View style={s.chips}>
            {people.map((p) => {
              const on = draft.personIds.includes(p._id)
              return (
                <Pressable
                  key={p._id}
                  style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}
                  onPress={() => toggle('personIds', p._id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Avatar name={p.name} size={26} />
                  <Text style={[s.chipText, on && s.chipTextOn]}>{p.name}</Text>
                </Pressable>
              )
            })}
          </View>
        )}

        <Text style={s.sect}>SORT BY</Text>
        <View style={s.seg} accessibilityRole="radiogroup">
          {SORTS.map((o) => {
            const on = draft.sortBy === o.key
            return (
              <Pressable
                key={o.key}
                style={[s.segItem, on && s.segOn]}
                onPress={() => setDraft((d) => ({ ...d, sortBy: o.key }))}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <Text style={[s.segText, on && s.segTextOn]}>{o.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
    </ScrollView>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: t.bg },
    scroll: { paddingBottom: 48 },
    pressed: { opacity: 0.6 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 6,
    },
    headerWrap: { backgroundColor: t.bg },
    link: { fontFamily: font.heavy, fontSize: 16, color: t.tintText },
    title: { fontFamily: font.heavy, fontSize: 17, color: t.label },
    body: { paddingHorizontal: 16 },
    sect: {
      fontFamily: font.heavy,
      fontSize: 12,
      letterSpacing: 1,
      color: t.secondary,
      paddingHorizontal: 6,
      paddingTop: 22,
      paddingBottom: 8,
    },
    note: { fontFamily: font.semibold, fontSize: 13.5, color: t.secondary, paddingHorizontal: 6, paddingTop: 8 },
    card: { backgroundColor: t.card, borderRadius: 22, overflow: 'hidden', ...cardShadow(t) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 56 },
    rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.separator },
    dot: { width: 14, height: 14, borderRadius: 7 },
    rowText: { flex: 1, fontFamily: font.heavy, fontSize: 16, color: t.label },
    shared: { fontFamily: font.bold, fontSize: 13, color: t.second },
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: t.tint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    uncheck: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: t.separator },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 34,
      paddingLeft: 4,
      paddingRight: 12,
      borderRadius: 17,
      backgroundColor: t.surface2,
    },
    chipOn: { backgroundColor: t.tint },
    chipText: { fontFamily: font.heavy, fontSize: 14.5, color: t.label },
    chipTextOn: { color: t.onTint },
    seg: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: t.surface2 },
    segItem: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    segOn: { backgroundColor: t.card, ...cardShadow(t) },
    segText: { fontFamily: font.bold, fontSize: 14.5, color: t.secondary },
    segTextOn: { fontFamily: font.heavy, color: t.label },
  })
}
