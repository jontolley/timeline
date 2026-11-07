import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { createPerson } from '../api/people'
import type { Person } from '../api/types'
import { Avatar, FillButton, Icon, TintButton } from '@/components/ui'
import { avatarKey, cardShadow, font, useTheme, type Theme } from '@/theme'

// Pick who was there: a checklist of the user's people (like the web form's
// people pills), filtered by the search field, which can also add someone new
// ("Add “Sam”") — they're created right away and selected.

export default function PeoplePicker({
  visible,
  people,
  selected,
  onDone,
  onCancel,
  onPersonCreated,
}: {
  visible: boolean
  people: Person[]
  selected: string[]
  onDone: (ids: string[]) => void
  onCancel: () => void
  onPersonCreated: (person: Person) => void
}) {
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])
  const [picked, setPicked] = useState<string[]>(selected)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setPicked(selected)
    setQuery('')
    setError(null)
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim()
  const shown = useMemo(() => {
    const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name))
    return q ? sorted.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : sorted
  }, [people, q])
  const exactMatch = people.some((p) => p.name.toLowerCase() === q.toLowerCase())

  function toggle(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  async function add() {
    if (!q || adding) return
    setAdding(true)
    setError(null)
    try {
      const person = await createPerson({ name: q, color: avatarKey(q) })
      onPersonCreated(person)
      setPicked((cur) => [...cur, person._id])
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that person.")
    } finally {
      setAdding(false)
    }
  }

  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onCancel}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <FillButton icon="xmark" accessibilityLabel="Cancel" onPress={onCancel} />
          <Text style={styles.headerTitle}>People</Text>
          <TintButton icon="checkmark" accessibilityLabel="Done" onPress={() => onDone(picked)} disabled={adding} />
        </View>

        <View style={styles.search}>
          <Icon name="magnifyingglass" size={18} color={t.secondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search or add a person"
            placeholderTextColor={t.placeholder}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType={q && !exactMatch ? 'done' : 'search'}
            onSubmitEditing={() => {
              if (q && !exactMatch) void add()
            }}
            clearButtonMode="while-editing"
          />
        </View>

        <FlatList
          data={shown}
          keyExtractor={(p) => p._id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[styles.list, (shown.length > 0 || (q && !exactMatch)) && styles.listCard]}
          ListHeaderComponent={
            <>
              {q && !exactMatch ? (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  onPress={add}
                  disabled={adding}
                >
                  <View style={[styles.avatar, { backgroundColor: t.tint }]}>
                    {adding ? (
                      <ActivityIndicator color={t.onTint} />
                    ) : (
                      <Icon name="plus" size={16} color={t.onTint} weight="bold" />
                    )}
                  </View>
                  <Text style={[styles.name, { color: t.tintText }]} numberOfLines={1}>
                    Add “{q}”
                  </Text>
                </Pressable>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </>
          }
          ListEmptyComponent={
            q ? undefined : <Text style={styles.empty}>No people yet. Type a name above to add someone.</Text>
          }
          ListFooterComponentStyle={styles.footer}
          ListFooterComponent={
            shown.length > 0 ? <Text style={styles.footnote}>Type a new name to add someone.</Text> : undefined
          }
          renderItem={({ item }) => {
            const on = picked.includes(item._id)
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => toggle(item._id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Avatar name={item.name} size={36} />
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                {on ? (
                  <View style={styles.check}>
                    <Icon name="checkmark" size={14} color={t.onTint} weight="bold" />
                  </View>
                ) : (
                  <View style={styles.uncheck} />
                )}
              </Pressable>
            )
          }}
        />
      </View>
    </Modal>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
    },
    headerTitle: { fontFamily: font.heavy, fontSize: 17, color: t.label },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 12,
      paddingHorizontal: 14,
      height: 46,
      borderRadius: 23,
      backgroundColor: t.card,
      ...cardShadow(t),
    },
    searchInput: { flex: 1, fontFamily: font.semibold, fontSize: 16.5, color: t.label },
    list: { marginHorizontal: 16, paddingBottom: 4 },
    listCard: { backgroundColor: t.card, borderRadius: 22, ...cardShadow(t) },
    footer: { marginBottom: 40 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.separator,
    },
    pressed: { opacity: 0.6 },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    name: { flex: 1, fontFamily: font.bold, fontSize: 16.5, color: t.label },
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: t.tint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    uncheck: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: t.separator },
    empty: {
      fontFamily: font.semibold,
      fontSize: 15,
      lineHeight: 20,
      color: t.secondary,
      textAlign: 'center',
      marginTop: 24,
    },
    footnote: { fontFamily: font.semibold, fontSize: 13.5, color: t.secondary, paddingHorizontal: 10, paddingTop: 12 },
    error: { fontFamily: font.semibold, fontSize: 15, color: t.danger, padding: 14 },
  })
}
