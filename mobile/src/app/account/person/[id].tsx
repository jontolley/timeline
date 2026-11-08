import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { createPerson, deletePerson, listPeople, updatePerson } from '@/api/people'
import type { Person } from '@/api/types'
import { Avatar, SectionLabel, TintButton } from '@/components/ui'
import { ColorSwatches, SheetHeader, makeSettingsStyles, useAutosave } from '@/components/settings'
import { useTimelineSignal } from '@/store/timeline'
import { avatarKey, paletteColor, useTheme } from '@/theme'

// One person: name and colour (saved as you go), or delete them, which takes
// them off every moment they're tagged in. `new` adds someone.

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const isNew = id === 'new'
  const router = useRouter()
  const t = useTheme()
  const styles = useMemo(() => makeSettingsStyles(t), [t])
  const requestRefresh = useTimelineSignal((s) => s.requestRefresh)

  const [person, setPerson] = useState<Person | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  // On a new person the colour follows the name (the same pick the form's
  // quick-add makes) until a swatch is tapped.
  const [color, setColor] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (isNew) return
    let live = true
    listPeople()
      .then((list) => {
        if (!live) return
        const found = list.find((p) => p._id === id)
        if (!found) {
          setLoadError('This person is gone.')
          return
        }
        setPerson(found)
        setName(found.name)
        setColor(found.color || avatarKey(found.name))
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load this person."))
    return () => {
      live = false
    }
  }, [id, isNew])

  const shownColor = color ?? avatarKey(name.trim() || '?')

  async function save(patch: Partial<Person>, undo: () => void) {
    if (!person) return
    try {
      const updated = await updatePerson(person._id, patch)
      setPerson((cur) => (cur ? { ...cur, ...updated } : cur))
      requestRefresh()
    } catch (e) {
      undo()
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : 'Please try again.')
    }
  }

  useAutosave(name, (value) => {
    const trimmed = value.trim()
    if (isNew || !person || !trimmed || trimmed === person.name) return
    void save({ name: trimmed }, () => setName(person.name))
  })

  function pickColor(key: string) {
    const before = color
    setColor(key)
    if (!isNew && person) void save({ color: key }, () => setColor(before))
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      await createPerson({ name: trimmed, color: shownColor })
      requestRefresh()
      router.back()
    } catch (e) {
      Alert.alert("Couldn't add them", e instanceof Error ? e.message : 'Please try again.')
      setCreating(false)
    }
  }

  function confirmDelete() {
    if (!person) return
    Alert.alert(
      `Delete ${person.name}?`,
      'They’ll be taken off every moment they’re tagged in. The moments themselves stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePerson(person._id)
              requestRefresh()
              router.back()
            } catch (e) {
              Alert.alert("Couldn't delete them", e instanceof Error ? e.message : 'Please try again.')
            }
          },
        },
      ],
    )
  }

  if (!isNew && !person) {
    return (
      <View style={styles.sheet}>
        <SheetHeader title="Person" />
        <View style={styles.body}>
          {loadError ? <Text style={styles.error}>{loadError}</Text> : <ActivityIndicator color={t.secondary} />}
        </View>
      </View>
    )
  }

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={isNew ? 'New person' : 'Person'}
        right={
          isNew ? (
            <TintButton
              icon="checkmark"
              accessibilityLabel="Add person"
              disabled={!name.trim() || creating}
              onPress={() => void create()}
            />
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', paddingTop: 6 }}>
          <Avatar name={name.trim() || '?'} color={paletteColor(shownColor, t.dark)} size={88} />
        </View>

        <View>
          <SectionLabel>Name</SectionLabel>
          <View style={styles.card}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Their name"
              placeholderTextColor={t.placeholder}
              style={styles.input}
              autoFocus={isNew}
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={60}
              onSubmitEditing={isNew ? () => void create() : undefined}
            />
          </View>
        </View>

        <View>
          <SectionLabel>Colour</SectionLabel>
          <View style={styles.card}>
            <ColorSwatches value={shownColor} onChange={pickColor} />
          </View>
        </View>

        {!isNew ? (
          <Pressable
            style={({ pressed }) => [styles.card, styles.danger, pressed && styles.pressed]}
            onPress={confirmDelete}
          >
            <Text style={styles.dangerText}>Delete person</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}
