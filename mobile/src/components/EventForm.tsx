import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Image } from 'expo-image'
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
import { extractExif, uploadMedia, type PickedAsset } from '../api/uploads'
import { reverseGeocode } from '../api/geocode'
import type { LocationDetail, MediaRef, Thread, TimelineEvent } from '../api/types'
import { useTimelineSignal } from '../store/timeline'
import { FillButton, Icon, IconTile, TintButton } from '@/components/ui'
import { paletteColor, useTheme, type Theme } from '@/theme'

// Shared create/edit form. `eventId` undefined → create; present → edit (loads
// the event, supports delete, and manages media through the dedicated attach/
// remove endpoints since EventUpdate has no media field).
//
// `sharedAssets` (create mode) are photos handed over from the iOS share sheet:
// they're attached like picked photos, and — like the web's "Event from photo"
// — the first one's EXIF prefills the date and, via reverse geocoding, the
// location. The title keeps focus so the user just types it.

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
// Today's *local* calendar day as UTC midnight. new Date() alone would be read
// as a UTC date, which is already tomorrow on a US evening.
function todayUtcMidnight(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}
function toUtcMidnightIso(d: Date): string {
  return `${toCalendarDate(d)}T00:00:00.000Z`
}
function displayDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
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

export default function EventForm({ eventId, sharedAssets }: { eventId?: string; sharedAssets?: PickedAsset[] }) {
  const isEdit = !!eventId
  const router = useRouter()
  const requestRefresh = useTimelineSignal((s) => s.requestRefresh)
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])

  // In edit mode we block render until the event loads.
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [locationName, setLocationName] = useState('')
  const [date, setDate] = useState<Date>(todayUtcMidnight)
  const [dateTouched, setDateTouched] = useState(false)
  const [locationTouched, setLocationTouched] = useState(false)
  // Coords + full address from photo EXIF; dropped as soon as the user edits
  // the place text, since they'd no longer describe what's typed.
  const [locationDetail, setLocationDetail] = useState<LocationDetail | null>(null)
  const [findingPlace, setFindingPlace] = useState(false)
  // Set by the date/location handlers and read inside the async EXIF prefill,
  // which must not overwrite a user edit.
  const touched = useRef({ date: false, location: false })
  // Dev effects run twice; the shared photos must only be queued once.
  const sharedTaken = useRef(false)
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

  // A share from Photos can cold-start the app straight into this modal, with
  // nothing underneath to go back to — land on the Timeline instead.
  function close() {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  const uploading = pending.some((m) => m.status === 'uploading')
  const canSave = title.trim().length > 0 && !saving && !uploading && !readOnly

  useEffect(() => {
    if (isEdit || !sharedAssets?.length || sharedTaken.current) return
    sharedTaken.current = true
    addAssets(sharedAssets)
    void prefillFromPhoto(sharedAssets[0])
  }, [sharedAssets, isEdit])

  async function prefillFromPhoto(asset: PickedAsset) {
    try {
      const exif = await extractExif(asset)
      if (exif.date && !touched.current.date) setDate(new Date(`${exif.date}T00:00:00.000Z`))
      if (exif.lat == null || exif.lng == null || touched.current.location) return
      setFindingPlace(true)
      const place = await reverseGeocode(exif.lat, exif.lng).catch(() => null)
      if (touched.current.location) return
      setLocationDetail(place ?? { lat: exif.lat, lng: exif.lng })
      if (place?.name) setLocationName(place.name)
    } catch {
      // No EXIF (or a screenshot) — the form just keeps today's date.
    } finally {
      setFindingPlace(false)
    }
  }

  async function pickImages() {
    // No permission request: the system picker (PHPicker / Android Photo
    // Picker) runs out of process and only hands back what the user picks, so
    // asking for full library access would just be a needless prompt.
    setError(null)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    })
    if (result.canceled) return
    addAssets(
      result.assets.map((asset) => ({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      })),
    )
  }

  // Queue each photo and upload it; create mode holds the refs until save,
  // edit mode attaches each one to the event as soon as it lands.
  function addAssets(assets: PickedAsset[]) {
    for (const picked of assets) {
      const localUri = picked.uri
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
          location: locationName.trim()
            ? { ...locationDetail, name: locationName.trim() }
            : locationDetail ?? undefined,
          thread_id: threadId ?? undefined,
          media: attached,
        })
      }
      requestRefresh()
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save event.')
      setSaving(false)
    }
  }

  function confirmDelete() {
    if (!eventId) return
    Alert.alert('Delete this moment?', 'This permanently removes it and its photos.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true)
          try {
            await deleteEvent(eventId)
            requestRefresh()
            close()
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete event.')
            setSaving(false)
          }
        },
      },
    ])
  }

  function pickThread() {
    if (readOnly || threads.length < 2) return
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Thread', options: [...threads.map((th) => th.name), 'Cancel'], cancelButtonIndex: threads.length },
        (i) => {
          if (i < threads.length) setThreadId(threads[i]._id)
        },
      )
    } else {
      Alert.alert('Thread', undefined, threads.map((th) => ({ text: th.name, onPress: () => setThreadId(th._id) })))
    }
  }

  if (loading) {
    return (
      <View style={[styles.sheet, styles.center]}>
        <ActivityIndicator color={t.secondary} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={[styles.sheet, styles.center]}>
        <Text style={styles.error}>{loadError}</Text>
        <Pressable onPress={() => close()}>
          <Text style={styles.link}>Go Back</Text>
        </Pressable>
      </View>
    )
  }

  const thread = threads.find((th) => th._id === threadId)
  const heading = readOnly ? 'Moment' : isEdit ? 'Edit Moment' : 'New Moment'

  // Grouped detail rows, iOS Settings style: coloured icon tile, label, value.
  const rows: { key: string; node: ReactNode }[] = [
    {
      key: 'date',
      node: (
        <View>
          <Pressable style={styles.row} onPress={() => !readOnly && setShowPicker((v) => !v)} disabled={readOnly}>
            <IconTile icon="calendar" color="#E5484D" />
            <Text style={styles.rowLabel}>Date</Text>
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>{displayDate(date)}</Text>
            </View>
          </Pressable>
          {showPicker && !readOnly ? (
            <DateTimePicker
              value={date}
              mode="date"
              // Render in UTC so the highlighted day matches the stored date
              // (local rendering shows the previous day west of Greenwich).
              timeZoneName="UTC"
              accentColor={t.tint}
              themeVariant={t.dark ? 'dark' : 'light'}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              style={styles.picker}
              onValueChange={(_event, picked) => {
                if (Platform.OS !== 'ios') setShowPicker(false)
                touched.current.date = true
                setDateTouched(true)
                setDate(new Date(Date.UTC(picked.getUTCFullYear(), picked.getUTCMonth(), picked.getUTCDate())))
              }}
              onDismiss={() => setShowPicker(false)}
            />
          ) : null}
        </View>
      ),
    },
    {
      key: 'location',
      node: (
        <View style={styles.row}>
          <IconTile icon="mappin" color={t.tint} />
          <Text style={styles.rowLabel}>Location</Text>
          <TextInput
            style={styles.rowInput}
            value={locationName}
            onChangeText={(v) => {
              touched.current.location = true
              setLocationTouched(true)
              setLocationDetail(null)
              setLocationName(v)
            }}
            placeholder={findingPlace ? 'Finding place…' : 'Add place'}
            placeholderTextColor={t.placeholder}
            editable={!readOnly}
            returnKeyType="done"
          />
        </View>
      ),
    },
  ]
  if (threads.length > 1) {
    rows.push({
      key: 'thread',
      node: (
        <Pressable style={styles.row} onPress={pickThread} disabled={readOnly}>
          <IconTile icon="line.3.horizontal" color="#8E8E93" />
          <Text style={styles.rowLabel}>Thread</Text>
          <View style={styles.rowValue}>
            {thread ? <View style={[styles.dot, { backgroundColor: paletteColor(thread.color, t.dark) }]} /> : null}
            <Text style={styles.rowValueText} numberOfLines={1}>
              {thread?.name ?? 'Choose'}
            </Text>
            {!readOnly ? <Icon name="chevron.right" size={13} color={t.chevron} weight="bold" /> : null}
          </View>
        </Pressable>
      ),
    })
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <FillButton icon="xmark" accessibilityLabel="Cancel" onPress={() => close()} disabled={saving} />
        <Text style={styles.headerTitle}>{heading}</Text>
        {readOnly ? (
          <View style={{ width: 44 }} />
        ) : (
          <TintButton icon="checkmark" accessibilityLabel="Save" onPress={save} disabled={!canSave}>
            {saving ? <ActivityIndicator color={t.onTint} /> : undefined}
          </TintButton>
        )}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {readOnly ? <Text style={styles.footnote}>This moment is shared with you — read only.</Text> : null}

          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
              {!readOnly ? (
                <Pressable style={({ pressed }) => [styles.addTile, pressed && styles.pressed]} onPress={pickImages}>
                  <Icon name="photo.badge.plus" size={28} color={t.tintText} weight="regular" />
                  <Text style={styles.addTileText}>Add Photos</Text>
                </Pressable>
              ) : null}
              {serverMedia.map((m) => {
                const uri = thumbUriFor(m)
                return (
                  <View key={m.key} style={styles.tile}>
                    {uri ? (
                      <Image source={{ uri, cacheKey: `${m.key}:thumb` }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <View style={styles.tileCenter}>
                        <Text style={styles.tileKind}>{m.kind}</Text>
                      </View>
                    )}
                    {!readOnly ? (
                      <Pressable
                        style={styles.remove}
                        onPress={() => detachServerMedia(m.key)}
                        hitSlop={8}
                        accessibilityLabel="Remove photo"
                      >
                        <Icon name="xmark" size={10} color="#FFFFFF" weight="bold" />
                      </Pressable>
                    ) : null}
                  </View>
                )
              })}
              {pending.map((m) => (
                <View key={m.localUri} style={styles.tile}>
                  <Image source={{ uri: m.localUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  {m.status === 'uploading' ? (
                    <View style={[styles.tileCenter, styles.tileDim]}>
                      <ActivityIndicator color="#FFFFFF" />
                    </View>
                  ) : m.status === 'error' ? (
                    <View style={[styles.tileCenter, styles.tileError]}>
                      <Text style={styles.tileErrorText}>Failed</Text>
                    </View>
                  ) : null}
                  {m.status !== 'uploading' ? (
                    <Pressable
                      style={styles.remove}
                      onPress={() => dropPending(m.localUri)}
                      hitSlop={8}
                      accessibilityLabel="Remove photo"
                    >
                      <Icon name="xmark" size={10} color="#FFFFFF" weight="bold" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
            {isEdit && !readOnly ? <Text style={[styles.footnote, { marginTop: 8 }]}>Photo changes save immediately.</Text> : null}
          </View>

          <View style={styles.group}>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor={t.placeholder}
              autoFocus={!isEdit}
              editable={!readOnly}
              returnKeyType="next"
            />
            <View style={[styles.separator, { marginLeft: 16 }]} />
            <TextInput
              style={styles.descInput}
              value={description}
              onChangeText={setDescription}
              placeholder="What do you want to remember?"
              placeholderTextColor={t.placeholder}
              multiline
              editable={!readOnly}
            />
          </View>

          <View style={styles.group}>
            {rows.map((r, i) => (
              <Fragment key={r.key}>
                {i > 0 ? <View style={styles.separator} /> : null}
                {r.node}
              </Fragment>
            ))}
          </View>

          {isEdit && !readOnly ? (
            <Pressable
              style={({ pressed }) => [styles.group, styles.deleteBtn, pressed && styles.pressed]}
              onPress={confirmDelete}
              disabled={saving}
            >
              <Text style={styles.deleteText}>Delete Moment</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: t.modalBg },
    flex: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 4,
    },
    headerTitle: { fontSize: 17, fontWeight: '600', color: t.label },
    body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 48, gap: 22 },
    footnote: { fontSize: 13, lineHeight: 18, color: t.secondary, paddingHorizontal: 4 },
    photos: { gap: 10 },
    addTile: {
      width: 104,
      height: 104,
      borderRadius: 18,
      backgroundColor: t.modalCard,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    addTileText: { fontSize: 13, fontWeight: '600', color: t.tintText },
    pressed: { opacity: 0.6 },
    tile: { width: 104, height: 104, borderRadius: 18, overflow: 'hidden', backgroundColor: t.photoPlaceholder },
    tileCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    tileKind: { fontSize: 12, color: t.secondary, textTransform: 'uppercase' },
    tileDim: { backgroundColor: 'rgba(0,0,0,0.35)' },
    tileError: { backgroundColor: 'rgba(229,72,77,0.6)' },
    tileErrorText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
    remove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.overlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    group: { backgroundColor: t.modalCard, borderRadius: 22, overflow: 'hidden' },
    titleInput: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '600',
      color: t.label,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
    },
    descInput: {
      fontSize: 17,
      lineHeight: 23,
      color: t.label,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 14,
      minHeight: 92,
      textAlignVertical: 'top',
    },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.modalSeparator, marginLeft: 56 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52 },
    rowLabel: { fontSize: 17, color: t.label },
    rowInput: { flex: 1, fontSize: 17, color: t.label, textAlign: 'right', paddingVertical: 14 },
    rowValue: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
    rowValueText: { fontSize: 17, color: t.secondary, flexShrink: 1 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    datePill: {
      marginLeft: 'auto',
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: t.fill,
      justifyContent: 'center',
    },
    datePillText: { fontSize: 17, color: t.tintText },
    picker: { marginHorizontal: 8 },
    deleteBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
    deleteText: { fontSize: 17, fontWeight: '500', color: t.danger },
    error: { color: t.danger, fontSize: 15, textAlign: 'center' },
    link: { color: t.tintText, fontSize: 17, fontWeight: '600' },
  })
}
