import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import { createEvent } from '../../src/api/events'
import { listThreads } from '../../src/api/threads'
import { uploadMedia, type PickedAsset } from '../../src/api/uploads'
import type { MediaRef, Thread } from '../../src/api/types'
import { useTimelineSignal } from '../../src/store/timeline'
import { colors } from '../../src/theme'

// A media item the user has added: tracked through its upload lifecycle so the
// UI can show a spinner per tile and block Save until uploads settle.
type PendingMedia = {
  localUri: string
  status: 'uploading' | 'done' | 'error'
  ref?: MediaRef
}

// Format a Date as a YYYY-MM-DD calendar string in UTC, then submit it at
// UTC midnight — matching the web form's `${date}T00:00:00.000Z` contract so
// the day never shifts (see the dates invariant in CLAUDE.md).
function toCalendarDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function toUtcMidnightIso(d: Date): string {
  return `${toCalendarDate(d)}T00:00:00.000Z`
}
function displayDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function NewEventScreen() {
  const router = useRouter()
  const requestRefresh = useTimelineSignal((s) => s.requestRefresh)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [locationName, setLocationName] = useState('')
  const [date, setDate] = useState<Date>(() => new Date())
  const [showPicker, setShowPicker] = useState(false)

  const [threads, setThreads] = useState<Thread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)

  const [media, setMedia] = useState<PendingMedia[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Default-select the first (oldest) thread, mirroring the backend default.
    listThreads()
      .then((list) => {
        setThreads(list)
        if (list.length > 0) setThreadId(list[0]._id)
      })
      .catch(() => {
        /* non-fatal; backend defaults the thread if we send none */
      })
  }, [])

  const uploading = media.some((m) => m.status === 'uploading')
  const canSave = title.trim().length > 0 && !saving && !uploading

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      setError('Photo library permission is needed to add photos.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
    })
    if (result.canceled) return

    for (const asset of result.assets) {
      const localUri = asset.uri
      setMedia((prev) => [...prev, { localUri, status: 'uploading' }])
      const picked: PickedAsset = {
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      }
      uploadMedia(picked)
        .then((ref) => {
          setMedia((prev) =>
            prev.map((m) => (m.localUri === localUri ? { ...m, status: 'done', ref } : m)),
          )
        })
        .catch(() => {
          setMedia((prev) =>
            prev.map((m) => (m.localUri === localUri ? { ...m, status: 'error' } : m)),
          )
        })
    }
  }

  function removeMedia(localUri: string) {
    setMedia((prev) => prev.filter((m) => m.localUri !== localUri))
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('A title is required.')
      return
    }
    setSaving(true)
    try {
      const attached = media.filter((m) => m.status === 'done' && m.ref).map((m) => m.ref as MediaRef)
      await createEvent({
        title: title.trim(),
        description: description.trim() || undefined,
        date: toUtcMidnightIso(date),
        location: locationName.trim() ? { name: locationName.trim() } : undefined,
        thread_id: threadId ?? undefined,
        media: attached,
      })
      requestRefresh()
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save event.')
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} disabled={saving}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>New event</Text>
        <Pressable onPress={save} hitSlop={8} disabled={!canSave}>
          <Text style={[styles.save, !canSave && styles.saveDisabled]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="What happened?"
            placeholderTextColor={colors.inkSoft}
            autoFocus
          />

          <Text style={styles.label}>Date</Text>
          <Pressable style={styles.input} onPress={() => setShowPicker((v) => !v)}>
            <Text style={styles.dateText}>{displayDate(date)}</Text>
          </Pressable>
          {showPicker ? (
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              // Treat the picked wall-clock date as a UTC calendar date so it
              // round-trips through toUtcMidnightIso without a day shift.
              onChange={(_event, picked) => {
                if (Platform.OS !== 'ios') setShowPicker(false)
                if (picked) {
                  setDate(new Date(Date.UTC(picked.getFullYear(), picked.getMonth(), picked.getDate())))
                }
              }}
            />
          ) : null}

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="Add some detail…"
            placeholderTextColor={colors.inkSoft}
            multiline
          />

          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={locationName}
            onChangeText={setLocationName}
            placeholder="Place name (optional)"
            placeholderTextColor={colors.inkSoft}
          />

          {threads.length > 1 ? (
            <>
              <Text style={styles.label}>Thread</Text>
              <View style={styles.pills}>
                {threads.map((t) => {
                  const selected = t._id === threadId
                  return (
                    <Pressable
                      key={t._id}
                      style={[
                        styles.pill,
                        selected && { backgroundColor: t.color || colors.accent, borderColor: t.color || colors.accent },
                      ]}
                      onPress={() => setThreadId(t._id)}
                    >
                      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{t.name}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          ) : null}

          <Text style={styles.label}>Photos</Text>
          <View style={styles.mediaGrid}>
            {media.map((m) => (
              <Pressable key={m.localUri} style={styles.mediaTile} onPress={() => removeMedia(m.localUri)}>
                <Image source={{ uri: m.localUri }} style={styles.mediaImg} />
                {m.status === 'uploading' ? (
                  <View style={styles.mediaOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : m.status === 'error' ? (
                  <View style={[styles.mediaOverlay, styles.mediaError]}>
                    <Text style={styles.mediaErrText}>failed</Text>
                  </View>
                ) : (
                  <View style={styles.removeBadge}>
                    <Text style={styles.removeBadgeText}>×</Text>
                  </View>
                )}
              </Pressable>
            ))}
            <Pressable style={styles.addTile} onPress={pickImages}>
              <Text style={styles.addTilePlus}>＋</Text>
              <Text style={styles.addTileText}>Add</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  cancel: { fontSize: 16, color: colors.inkSoft },
  save: { fontSize: 16, fontWeight: '700', color: colors.accent },
  saveDisabled: { color: colors.inkSoft, opacity: 0.5 },
  body: { padding: 20, gap: 8, paddingBottom: 48 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  dateText: { fontSize: 16, color: colors.ink },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  pillText: { fontSize: 14, color: colors.ink },
  pillTextSelected: { color: '#fff', fontWeight: '600' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaTile: { width: 84, height: 84, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.rule },
  mediaImg: { width: '100%', height: '100%' },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaError: { backgroundColor: 'rgba(176,67,46,0.55)' },
  mediaErrText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 16 },
  addTile: {
    width: 84,
    height: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.rule,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  addTilePlus: { fontSize: 22, color: colors.accent },
  addTileText: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  error: { color: colors.danger, fontSize: 14, marginTop: 12 },
})
