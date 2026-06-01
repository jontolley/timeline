import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import {
  attachMedia,
  createEvent,
  deleteEvent,
  getEvent,
  removeMedia,
  updateEvent,
} from '../api/events'
import { listThreads } from '../api/threads'
import { uploadMedia, type PickedAsset } from '../api/uploads'
import type { LocationDetail, MediaRef, Thread, TimelineEvent } from '../api/types'
import { useTimelineSignal } from '../store/timeline'
import { colors } from '../theme'

// Shared create/edit form. `eventId` undefined → create; present → edit (loads
// the event, supports delete, and manages media through the dedicated attach/
// remove endpoints since EventUpdate has no media field).

type PendingMedia = {
  localUri: string
  status: 'uploading' | 'done' | 'error'
  ref?: MediaRef
}

// Dates store UTC; format/parse in UTC and submit at UTC midnight so the day
// never shifts (CLAUDE.md dates invariant). In edit mode an untouched date is
// submitted verbatim so any existing time-of-day is preserved.
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
function initialLocationName(loc: TimelineEvent['location']): string {
  if (!loc) return ''
  if (typeof loc === 'string') return loc
  return loc.name || loc.address || ''
}
function thumbUriFor(m: MediaRef): string | null {
  return m.thumb_url || m.url || null
}

export default function EventForm({ eventId }: { eventId?: string }) {
  const isEdit = !!eventId
  const router = useRouter()
  const requestRefresh = useTimelineSignal((s) => s.requestRefresh)

  // In edit mode we block render until the event loads.
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [locationName, setLocationName] = useState('')
  const [date, setDate] = useState<Date>(() => new Date())
  const [dateTouched, setDateTouched] = useState(false)
  const [locationTouched, setLocationTouched] = useState(false)
  const [originalDateIso, setOriginalDateIso] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const [threads, setThreads] = useState<Thread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)

  // Create mode holds media locally until save; edit mode mirrors the server.
  const [pending, setPending] = useState<PendingMedia[]>([])
  const [serverMedia, setServerMedia] = useState<MediaRef[]>([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listThreads()
      .then((list) => {
        setThreads(list)
        // Only auto-select in create mode; edit sets it from the event.
        if (!isEdit && list.length > 0) setThreadId((cur) => cur ?? list[0]._id)
      })
      .catch(() => {})
  }, [isEdit])

  useEffect(() => {
    if (!eventId) return
    // Guard against stale responses: dev double-invokes effects and the
    // endpoint can intermittently time out, so a late reject from a discarded
    // attempt must not clobber a good load (or vice-versa).
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    getEvent(eventId)
      .then((ev) => {
        if (cancelled) return
        setTitle(ev.title)
        setDescription(ev.description || '')
        setLocationName(initialLocationName(ev.location))
        setOriginalDateIso(ev.date)
        setDate(new Date(ev.date))
        setThreadId(ev.thread_id)
        setServerMedia(ev.media || [])
        setLoadError(null)
        // Shared (non-owned) events are read-only — update/delete are
        // owner-scoped on the backend and would 404.
        if (ev.is_owner === false) setReadOnly(true)
      })
      .catch((e) => {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : 'Could not load event.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  const uploading = pending.some((m) => m.status === 'uploading')
  const canSave = title.trim().length > 0 && !saving && !uploading && !readOnly

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
      const picked: PickedAsset = {
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      }
      setPending((prev) => [...prev, { localUri, status: 'uploading' }])
      uploadMedia(picked)
        .then(async (ref) => {
          if (isEdit && eventId) {
            // Edit mode attaches immediately; resync from the server response.
            const updated = await attachMedia(eventId, ref)
            setServerMedia(updated.media || [])
            setPending((prev) => prev.filter((m) => m.localUri !== localUri))
          } else {
            setPending((prev) =>
              prev.map((m) => (m.localUri === localUri ? { ...m, status: 'done', ref } : m)),
            )
          }
        })
        .catch(() => {
          setPending((prev) =>
            prev.map((m) => (m.localUri === localUri ? { ...m, status: 'error' } : m)),
          )
        })
    }
  }

  function dropPending(localUri: string) {
    setPending((prev) => prev.filter((m) => m.localUri !== localUri))
  }

  async function detachServerMedia(key: string) {
    if (!eventId) return
    const prev = serverMedia
    setServerMedia((cur) => cur.filter((m) => m.key !== key)) // optimistic
    try {
      await removeMedia(eventId, key)
    } catch {
      setServerMedia(prev) // roll back on failure
      setError('Could not remove that photo.')
    }
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('A title is required.')
      return
    }
    setSaving(true)
    try {
      if (isEdit && eventId) {
        // Send only the fields that should change. Date/location are guarded
        // so an untouched edit doesn't clobber an existing time or coords.
        const payload: Partial<TimelineEvent> = {
          title: title.trim(),
          description: description.trim() || null,
          thread_id: threadId ?? undefined,
        }
        if (dateTouched) payload.date = toUtcMidnightIso(date)
        if (locationTouched) {
          payload.location = locationName.trim()
            ? ({ name: locationName.trim() } as LocationDetail)
            : null
        }
        await updateEvent(eventId, payload)
      } else {
        const attached = pending
          .filter((m) => m.status === 'done' && m.ref)
          .map((m) => m.ref as MediaRef)
        await createEvent({
          title: title.trim(),
          description: description.trim() || undefined,
          date: toUtcMidnightIso(date),
          location: locationName.trim() ? { name: locationName.trim() } : undefined,
          thread_id: threadId ?? undefined,
          media: attached,
        })
      }
      requestRefresh()
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save event.')
      setSaving(false)
    }
  }

  function confirmDelete() {
    if (!eventId) return
    Alert.alert('Delete event?', 'This permanently removes the event and its photos.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true)
          try {
            await deleteEvent(eventId)
            requestRefresh()
            router.back()
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete event.')
            setSaving(false)
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    )
  }

  if (loadError) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Text style={styles.error}>{loadError}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.cancel}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} disabled={saving}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {readOnly ? 'Event' : isEdit ? 'Edit event' : 'New event'}
        </Text>
        {readOnly ? (
          <View style={{ width: 48 }} />
        ) : (
          <Pressable onPress={save} hitSlop={8} disabled={!canSave}>
            <Text style={[styles.save, !canSave && styles.saveDisabled]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {readOnly ? (
            <Text style={styles.readOnlyNote}>This event is shared with you — read only.</Text>
          ) : null}

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="What happened?"
            placeholderTextColor={colors.inkSoft}
            autoFocus={!isEdit}
            editable={!readOnly}
          />

          <Text style={styles.label}>Date</Text>
          <Pressable
            style={styles.input}
            onPress={() => !readOnly && setShowPicker((v) => !v)}
            disabled={readOnly}
          >
            <Text style={styles.dateText}>{displayDate(date)}</Text>
          </Pressable>
          {showPicker && !readOnly ? (
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_event, picked) => {
                if (Platform.OS !== 'ios') setShowPicker(false)
                if (picked) {
                  setDateTouched(true)
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
            editable={!readOnly}
          />

          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={locationName}
            onChangeText={(t) => {
              setLocationTouched(true)
              setLocationName(t)
            }}
            placeholder="Place name (optional)"
            placeholderTextColor={colors.inkSoft}
            editable={!readOnly}
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
                        selected && {
                          backgroundColor: t.color || colors.accent,
                          borderColor: t.color || colors.accent,
                        },
                      ]}
                      onPress={() => !readOnly && setThreadId(t._id)}
                      disabled={readOnly}
                    >
                      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{t.name}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          ) : null}

          <Text style={styles.label}>Photos</Text>
          {isEdit && !readOnly ? (
            <Text style={styles.mediaHint}>Photo changes save immediately.</Text>
          ) : null}
          <View style={styles.mediaGrid}>
            {serverMedia.map((m) => {
              const uri = thumbUriFor(m)
              return (
                <Pressable
                  key={m.key}
                  style={styles.mediaTile}
                  onPress={() => !readOnly && detachServerMedia(m.key)}
                  disabled={readOnly}
                >
                  {uri ? (
                    <Image source={{ uri }} style={styles.mediaImg} />
                  ) : (
                    <View style={[styles.mediaImg, styles.mediaPlaceholder]}>
                      <Text style={styles.mediaKindText}>{m.kind}</Text>
                    </View>
                  )}
                  {!readOnly ? (
                    <View style={styles.removeBadge}>
                      <Text style={styles.removeBadgeText}>×</Text>
                    </View>
                  ) : null}
                </Pressable>
              )
            })}
            {pending.map((m) => (
              <Pressable key={m.localUri} style={styles.mediaTile} onPress={() => dropPending(m.localUri)}>
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
            {!readOnly ? (
              <Pressable style={styles.addTile} onPress={pickImages}>
                <Text style={styles.addTilePlus}>＋</Text>
                <Text style={styles.addTileText}>Add</Text>
              </Pressable>
            ) : null}
          </View>

          {isEdit && !readOnly ? (
            <Pressable style={styles.deleteBtn} onPress={confirmDelete} disabled={saving}>
              <Text style={styles.deleteText}>Delete event</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
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
  readOnlyNote: { fontSize: 14, color: colors.inkSoft, fontStyle: 'italic', marginBottom: 4 },
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
  mediaHint: { fontSize: 12, color: colors.inkSoft, fontStyle: 'italic' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaTile: { width: 84, height: 84, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.rule },
  mediaImg: { width: '100%', height: '100%' },
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  mediaKindText: { fontSize: 11, color: colors.inkSoft, textTransform: 'uppercase' },
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
  deleteBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  deleteText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, marginTop: 12 },
})
