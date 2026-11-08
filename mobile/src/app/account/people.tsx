import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { listPeople } from '@/api/people'
import type { Person } from '@/api/types'
import { Avatar, EmptyState, FillButton, Icon } from '@/components/ui'
import { SheetHeader, makeSettingsStyles } from '@/components/settings'
import { paletteColor, useTheme } from '@/theme'

// Account → People: everyone you can tag in a moment, A–Z. Tap to rename,
// recolour or delete; + adds someone.

export default function PeopleScreen() {
  const router = useRouter()
  const t = useTheme()
  const styles = useMemo(() => makeSettingsStyles(t), [t])
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      let live = true
      listPeople()
        .then((list) => {
          if (!live) return
          setPeople([...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
          setError(null)
        })
        .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load your people."))
      return () => {
        live = false
      }
    }, []),
  )

  const add = () => router.push({ pathname: '/account/person/[id]', params: { id: 'new' } })

  return (
    <View style={styles.sheet}>
      <SheetHeader title="People" right={<FillButton icon="plus" accessibilityLabel="Add a person" onPress={add} />} />
      <ScrollView contentContainerStyle={styles.body}>
        {people === null && !error ? <ActivityIndicator color={t.secondary} style={{ marginTop: 40 }} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {people && people.length === 0 ? (
          <EmptyState
            icon="person.2.fill"
            tone="second"
            title="No people yet"
            text="Add the people who show up in your moments, then tag them when you write one."
            style={{ marginTop: 40 }}
          />
        ) : null}

        {people && people.length > 0 ? (
          <View>
            <View style={styles.card}>
              {people.map((p, i) => (
                <View key={p._id}>
                  {i > 0 ? <View style={[styles.separator, { marginLeft: 64 }]} /> : null}
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={() => router.push({ pathname: '/account/person/[id]', params: { id: p._id } })}
                    accessibilityRole="button"
                  >
                    <Avatar name={p.name} color={paletteColor(p.color, t.dark)} size={36} />
                    <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Icon name="chevron.right" size={14} color={t.secondary} weight="bold" />
                  </Pressable>
                </View>
              ))}
            </View>
            <Text style={styles.footnote}>
              {people.length === 1 ? '1 person' : `${people.length} people`}. Only you see this list; people
              here don’t need a Hindsite account.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}
