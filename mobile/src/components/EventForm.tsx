import { Fragment, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { attachMedia, createEvent, deleteEvent, getEvent, removeMedia, updateEvent } from '../api/events'
import { listPeople } from '../api/people'
import { listThreads } from '../api/threads'
import { extractExif, isPdfAsset, isVideoAsset, uploadMedia, videoPoster, type PickedAsset } from '../api/uploads'
import {
  canScanDocuments,
  documentsAvailable,
  imagesToPdf,
  pdfInfo,
  scanDocument,
  type DocumentFile,
} from '../../modules/hindsite-documents'
import { reverseGeocode } from '../api/geocode'
import { resolvePlaceLink } from '../api/places'
import { extractVideoMetadata } from '../lib/videoMetadata'
import { currentPlace } from '../lib/currentPlace'
import type { LocationDetail, MediaRef, Person, Thread, TimelineEvent } from '../api/types'
import { useTimelineSignal } from '../store/timeline'
import LocationPicker from '@/components/LocationPicker'
import PeoplePicker from '@/components/PeoplePicker'
import { MapThumb } from '@/components/EventCard'
import VoiceRecorder from '@/components/VoiceRecorder'
import {
  AvatarStack,
  EmptyState,
  FillButton,
  Icon,
  RowIcon,
  Skeleton,
  TintButton,
  Waveform,
  Button,
} from '@/components/ui'
import { fmtDuration, seedOf } from '@/lib/format'
import { cardShadow, font, paletteColor, useTheme, type Theme } from '@/theme'

// Shared create/edit form. `eventId` undefined → create; present → edit (loads
// the event, supports delete, and manages media through the dedicated attach/
// remove endpoints since EventUpdate has no media field).
//
// `sharedAssets` (create mode) are photos / videos handed over from the iOS
// share sheet: they're attached like picked photos, and — like the web's
// "Event from photo or video" — the first one's metadata (photo EXIF, or the
// video's own QuickTime metadata) prefills the date and, via reverse
// geocoding, the location. `sharedLink` is a Google / Apple Maps share link
// that becomes the location; `sharedText` (any other shared text or link)
// seeds the description. The title keeps focus so the user just types it.

type PendingMedia = {
  localUri: string
  status: 'uploading' | 'done' | 'error'
  ref?: MediaRef
  isVideo?: boolean
  // A voice note recorded in the form (drawn as a waveform tile).
  isAudio?: boolean
  // A PDF: its page 1 once rendered, the document tile until then.
  isPdf?: boolean
  durationSeconds?: number
  // Tile image: the photo itself, a video's first-frame poster, or a PDF's page 1.
  previewUri?: string
}

// Dates store UTC wall-clock: the calendar day and time the user picked are
// written as if they were UTC, and formatted/parsed in UTC, so nothing shifts
// with the device's time zone (CLAUDE.md dates invariant). A date with no time
// is UTC midnight; any other time-of-day means "has a time", like the web's
// hasTime(). In edit mode untouched dates aren't resubmitted at all.
function toCalendarDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function hasTime(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0
}
function hhmm(d: Date): string {
  return d.toISOString().slice(11, 16)
}
// The picked day (and time, when the event has one) as the stored ISO string.
function toIso(d: Date, withTime: boolean): string {
  return `${toCalendarDate(d)}T${withTime ? hhmm(d) : '00:00'}:00.000Z`
}
// Keep `d`'s calendar day, take the time-of-day from `time` (both UTC).
function withDay(time: Date, day: Date): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), time.getUTCHours(), time.getUTCMinutes()),
  )
}
// A default time for a newly switched-on Time: this device's current clock
// time, rounded to 5 minutes, as UTC wall-clock on the event's day.
function nowOn(day: Date): Date {
  const now = new Date()
  const mins = Math.round((now.getHours() * 60 + now.getMinutes()) / 5) * 5
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, Math.min(mins, 23 * 60 + 55)))
}
function displayTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })
}
// Today's *local* calendar day as UTC midnight. new Date() alone would be read
// as a UTC date, which is already tomorrow on a US evening.
function todayUtcMidnight(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}
function displayDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
function initialLocation(loc: TimelineEvent['location']): LocationDetail | null {
  if (!loc) return null
  return typeof loc === 'string' ? { name: loc } : loc
}
function thumbUriFor(m: MediaRef): string | null {
  return m.thumb_url || m.url || null
}

export default function EventForm({
  eventId,
  sharedAssets,
  sharedLink,
  sharedText,
}: {
  eventId?: string
  sharedAssets?: PickedAsset[]
  sharedLink?: string
  sharedText?: string
}) {
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
  // `date` / `endDate` carry the time-of-day too, used only while `timeOn`.
  const [date, setDate] = useState<Date>(todayUtcMidnight)
  const [timeOn, setTimeOn] = useState(false)
  const [endOn, setEndOn] = useState(false)
  const [endDate, setEndDate] = useState<Date>(todayUtcMidnight)
  const [dateTouched, setDateTouched] = useState(false)
  // Which inline date/time picker is open under the date rows.
  const [openPicker, setOpenPicker] = useState<'date' | 'time' | 'end' | 'endTime' | null>(null)
  const [location, setLocation] = useState<LocationDetail | null>(null)
  const [locationTouched, setLocationTouched] = useState(false)
  const [findingPlace, setFindingPlace] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const tagRef = useRef<ComponentRef<typeof TextInput>>(null)
  const [people, setPeople] = useState<string[]>([])
  const [allPeople, setAllPeople] = useState<Person[]>([])
  // Shared events name their people here; the ids belong to the owner.
  const [peopleDisplay, setPeopleDisplay] = useState<{ id: string; name: string }[]>([])
  const [sheet, setSheet] = useState<'location' | 'people' | null>(null)
  const [recording, setRecording] = useState(false)
  // "Date and place filled in from your photo." after a metadata prefill.
  const [prefillNote, setPrefillNote] = useState<string | null>(null)
  // Set by the date/location handlers and read inside the async EXIF prefill,
  // which must not overwrite a user edit.
  const touched = useRef({ date: false, location: false })
  // Dev effects run twice; the shared photos must only be queued once.
  const sharedTaken = useRef(false)
  const linkTaken = useRef(false)
  const hereTried = useRef(false)
  // Set once a photo or video has filled in the date or place, so adding more
  // media later doesn't keep moving them.
  const mediaPrefilled = useRef(false)

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
    listPeople()
      .then(setAllPeople)
      .catch(() => {})
  }, [])

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
        setLocation(initialLocation(ev.location))
        setDate(new Date(ev.date))
        setTimeOn(hasTime(ev.date) || hasTime(ev.end_date))
        setEndOn(!!ev.end_date)
        if (ev.end_date) setEndDate(new Date(ev.end_date))
        setTags(ev.tags || [])
        setPeople(ev.people || [])
        setPeopleDisplay(ev.people_display || [])
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
    // A shared map link names the place better than a reverse-geocoded pin.
    // A PDF carries no date or place to read.
    void prefillFromFirst(sharedAssets)
  }, [sharedAssets, isEdit])

  useEffect(() => {
    if (isEdit || linkTaken.current || (!sharedLink && !sharedText)) return
    linkTaken.current = true
    if (sharedText) setDescription((cur) => cur || sharedText)
    if (sharedLink) void prefillFromLink(sharedLink)
  }, [sharedLink, sharedText, isEdit])

  // A new moment written from scratch defaults to where the phone is, like
  // the web form. Not when something was shared in: a shared photo or video
  // brings its own place (or is from somewhere else entirely), and a shared
  // Maps link is the place. Never replaces a place the user has set.
  useEffect(() => {
    if (isEdit || hereTried.current || sharedAssets?.length || sharedLink) return
    // No cleanup-cancel: dev runs effects twice, and the ref means only the
    // first run looks the place up.
    hereTried.current = true
    setFindingPlace(true)
    currentPlace()
      .then((place) => {
        if (!place || touched.current.location) return
        setLocation((cur) => cur ?? place)
        setPrefillNote((cur) => cur ?? 'Place filled in from where you are.')
      })
      .finally(() => setFindingPlace(false))
  }, [isEdit, sharedAssets, sharedLink])

  async function prefillFromLink(link: string) {
    setFindingPlace(true)
    try {
      const place = await resolvePlaceLink(link)
      if (touched.current.location) return
      setLocation(place)
      setPrefillNote('Place added from your Maps link.')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that map link.")
    } finally {
      setFindingPlace(false)
    }
  }

  // New moments only: fill the date and place from the first photo or video
  // (in the order given) that carries them, like the web's "Event from photo
  // or video". Screenshots and PDFs have nothing to read, so try the next.
  // A shared Maps link names the place better than a reverse-geocoded pin.
  async function prefillFromFirst(assets: PickedAsset[]) {
    if (isEdit || mediaPrefilled.current) return
    const visual = assets.filter((a) => !isPdfAsset(a) && !(a.mimeType || '').startsWith('audio/')).slice(0, 3)
    for (const asset of visual) {
      if (mediaPrefilled.current) return
      if (await prefillFromMedia(asset, !sharedLink)) {
        mediaPrefilled.current = true
        return
      }
    }
  }

  // True when the asset had a date or place to read.
  async function prefillFromMedia(asset: PickedAsset, useLocation: boolean): Promise<boolean> {
    try {
      const isVideo = isVideoAsset(asset)
      const exif = isVideo ? await extractVideoMetadata(asset.uri) : await extractExif(asset)
      const from = isVideo ? 'your video' : 'your photo'
      if (exif.date && !touched.current.date) {
        setDate(new Date(`${exif.date}T${exif.time || '00:00'}:00.000Z`))
        if (exif.time) setTimeOn(true)
        setPrefillNote(`Date filled in from ${from}.`)
      }
      const { lat, lng } = exif
      const hasPlace = lat != null && lng != null
      if (!useLocation || !hasPlace || touched.current.location) return !!exif.date || hasPlace
      setFindingPlace(true)
      const place = await reverseGeocode(lat, lng).catch(() => null)
      if (touched.current.location) return true
      setLocation(place ?? { lat, lng })
      setPrefillNote(
        exif.date && !touched.current.date ? `Date and place filled in from ${from}.` : `Place filled in from ${from}.`,
      )
      return true
    } catch {
      // No metadata (or a screenshot) — the form just keeps today's date.
      return false
    } finally {
      setFindingPlace(false)
    }
  }

  async function pickMedia() {
    // No permission request: the system picker (PHPicker / Android Photo
    // Picker) runs out of process and only hands back what the user picks, so
    // asking for full library access would just be a needless prompt.
    setError(null)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
      // Hand back the video as recorded (HEVC stays HEVC) — the default may
      // transcode it to H.264 first, which is slow for long videos.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    })
    if (result.canceled) return
    const picked = result.assets.map((asset) => ({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    }))
    addAssets(picked)
    void prefillFromFirst(picked)
  }

  // "Add a document": scan pages, combine photos into one PDF, or pick PDFs
  // from Files. Every route ends as a PDF in addAssets.
  function addDocument() {
    setError(null)
    const choices: { label: string; run: () => void }[] = []
    if (canScanDocuments()) choices.push({ label: 'Scan with camera', run: () => void buildDocument(scanDocument) })
    choices.push({ label: 'Combine photos into a PDF', run: () => void combinePhotos() })
    choices.push({ label: 'Choose a PDF from Files', run: () => void pickPdfs() })
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Add a document', options: [...choices.map((c) => c.label), 'Cancel'], cancelButtonIndex: choices.length },
        (i) => choices[i]?.run(),
      )
    } else {
      Alert.alert('Add a document', undefined, [
        ...choices.map((c) => ({ text: c.label, onPress: c.run })),
        { text: 'Cancel', style: 'cancel' as const },
      ])
    }
  }

  async function combinePhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      // Numbered picks: the order you tap them is the page order.
      orderedSelection: true,
      selectionLimit: 0,
      quality: 1,
    })
    if (result.canceled || result.assets.length === 0) return
    const uris = result.assets.map((a) => a.uri)
    await buildDocument(() => imagesToPdf(uris))
  }

  // Run a PDF builder with a spinner tile standing in until it's ready.
  async function buildDocument(build: () => Promise<DocumentFile | null>) {
    const placeholder = `building-${Date.now()}`
    setPending((prev) => [...prev, { localUri: placeholder, status: 'uploading', isPdf: true }])
    try {
      const doc = await build()
      if (doc) addAssets([{ uri: doc.uri, mimeType: 'application/pdf', fileName: 'Document.pdf', document: doc }])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make that PDF.")
    } finally {
      setPending((prev) => prev.filter((m) => m.localUri !== placeholder))
    }
  }

  async function pickPdfs() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: true,
      copyToCacheDirectory: true,
    })
    if (result.canceled) return
    addAssets(result.assets.map((a) => ({ uri: a.uri, mimeType: 'application/pdf', fileName: a.name })))
  }

  // Queue each photo / video / voice note and upload it; create mode holds the
  // refs until save, edit mode attaches each one to the event as soon as it
  // lands. `extra` adds fields the upload can't know (a recording's length).
  function addAssets(assets: PickedAsset[], extra?: Partial<MediaRef>) {
    for (const picked of assets) {
      const localUri = picked.uri
      const isVideo = isVideoAsset(picked)
      const isAudio = (picked.mimeType || '').startsWith('audio/')
      const isPdf = isPdfAsset(picked)
      setPending((prev) => [
        ...prev,
        {
          localUri,
          status: 'uploading',
          isVideo,
          isAudio,
          isPdf,
          durationSeconds: extra?.duration_seconds ?? undefined,
          previewUri: isVideo || isAudio ? undefined : isPdf ? picked.document?.thumbUri : localUri,
        },
      ])
      if (isVideo) {
        videoPoster(localUri)
          .then((frame) =>
            setPending((prev) => prev.map((m) => (m.localUri === localUri ? { ...m, previewUri: frame.uri } : m))),
          )
          .catch(() => {})
      }
      // A PDF from Files is read here (page count + page 1) so its tile shows
      // the page while it uploads; one built on the phone already has both.
      const prepared: Promise<PickedAsset> =
        isPdf && !picked.document
          ? pdfInfo(localUri)
              .then((document) => {
                if (document.thumbUri) {
                  setPending((prev) =>
                    prev.map((m) => (m.localUri === localUri ? { ...m, previewUri: document.thumbUri } : m)),
                  )
                }
                return { ...picked, document }
              })
              .catch(() => picked)
          : Promise.resolve(picked)
      prepared
        .then(uploadMedia)
        .then(async (uploaded) => {
          const ref: MediaRef = { ...uploaded, ...extra }
          if (isEdit && eventId) {
            // Edit mode attaches immediately; resync from the server response.
            const updated = await attachMedia(eventId, ref)
            setServerMedia(updated.media || [])
            setPending((prev) => prev.filter((m) => m.localUri !== localUri))
          } else {
            setPending((prev) => prev.map((m) => (m.localUri === localUri ? { ...m, status: 'done', ref } : m)))
          }
        })
        .catch((e) => {
          setPending((prev) => prev.map((m) => (m.localUri === localUri ? { ...m, status: 'error' } : m)))
          const why = e instanceof Error ? e.message : String(e)
          setError(`Couldn't upload that ${isVideo ? 'video' : isAudio ? 'recording' : isPdf ? 'document' : 'photo'}: ${why}`)
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
      setError('Could not remove that item.')
    }
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('A title is required.')
      return
    }
    const dateIso = toIso(date, timeOn)
    const endIso = endOn ? toIso(endDate, timeOn) : null
    if (endIso && endIso < dateIso) {
      setError('The end is before the start.')
      return
    }
    // A tag typed but not yet added with Return still counts.
    const allTags = tagInput.trim() && !tags.includes(tagInput.trim()) ? [...tags, tagInput.trim()] : tags
    setSaving(true)
    try {
      if (isEdit && eventId) {
        // Send only the fields that should change. Dates/location are guarded
        // so an untouched edit never rewrites them.
        const payload: Partial<TimelineEvent> = {
          title: title.trim(),
          description: description.trim() || null,
          thread_id: threadId ?? undefined,
          tags: allTags,
          people,
        }
        if (dateTouched) {
          payload.date = dateIso
          payload.end_date = endIso
        }
        if (locationTouched) payload.location = location
        await updateEvent(eventId, payload)
      } else {
        const attached = pending.filter((m) => m.status === 'done' && m.ref).map((m) => m.ref as MediaRef)
        await createEvent({
          title: title.trim(),
          description: description.trim() || undefined,
          date: dateIso,
          end_date: endIso,
          location: location ?? undefined,
          tags: allTags,
          people,
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
      Alert.alert(
        'Thread',
        undefined,
        threads.map((th) => ({ text: th.name, onPress: () => setThreadId(th._id) })),
      )
    }
  }

  if (loading) {
    return (
      <View style={styles.sheet}>
        <View style={styles.header}>
          <FillButton icon="xmark" accessibilityLabel="Cancel" onPress={() => close()} />
          <Text style={styles.headerTitle}>Edit moment</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.body}>
          <Skeleton style={{ height: 104, width: 104, borderRadius: 20 }} />
          <Skeleton style={{ height: 120, borderRadius: 24 }} />
          <Skeleton style={{ height: 260, borderRadius: 24 }} />
        </View>
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={styles.sheet}>
        <View style={styles.header}>
          <FillButton icon="xmark" accessibilityLabel="Cancel" onPress={() => close()} />
          <View style={{ width: 44 }} />
        </View>
        <EmptyState
          icon="exclamationmark.triangle"
          tone="neutral"
          title="We couldn’t open this moment"
          text={loadError}
          style={{ marginTop: 60, paddingHorizontal: 32 }}
        >
          <Button label="Go back" variant="tonal" small onPress={() => close()} style={{ marginTop: 10 }} />
        </EmptyState>
      </View>
    )
  }

  const thread = threads.find((th) => th._id === threadId)
  const heading = readOnly ? 'Moment' : isEdit ? 'Edit moment' : 'New moment'

  function markDates() {
    touched.current.date = true
    setDateTouched(true)
  }
  const togglePicker = (which: NonNullable<typeof openPicker>) => setOpenPicker((cur) => (cur === which ? null : which))

  // One inline date (calendar) or time (wheels) picker, rendered in UTC so the
  // shown day/time is exactly what's stored.
  function inlinePicker(which: NonNullable<typeof openPicker>, value: Date, onPick: (picked: Date) => void) {
    if (openPicker !== which || readOnly) return null
    const mode = which === 'time' || which === 'endTime' ? 'time' : 'date'
    const picker = (
      <DateTimePicker
        value={value}
        mode={mode}
        timeZoneName="UTC"
        accentColor={t.tint}
        themeVariant={t.dark ? 'dark' : 'light'}
        display={Platform.OS === 'ios' ? (mode === 'date' ? 'inline' : 'spinner') : 'default'}
        style={styles.picker}
        onValueChange={(_event, picked) => {
          // The calendar closes when a day is tapped. Spinning its month/year
          // wheels also changes the value, but keeps the day of the month, so
          // a change that leaves the day alone keeps the calendar up (tap the
          // month heading to get back to the days, or Done). The time wheels
          // stay up while they spin.
          const dayTapped = mode === 'date' && picked.getUTCDate() !== value.getUTCDate()
          if (Platform.OS !== 'ios' || dayTapped) setOpenPicker(null)
          markDates()
          onPick(picked)
        }}
        onDismiss={() => setOpenPicker(null)}
      />
    )
    if (Platform.OS !== 'ios') return picker
    return (
      <View>
        {picker}
        <Pressable
          style={({ pressed }) => [styles.pickerDone, pressed && styles.pressed]}
          onPress={() => setOpenPicker(null)}
          accessibilityRole="button"
          accessibilityLabel={mode === 'date' ? 'Done choosing the date' : 'Done choosing the time'}
          hitSlop={8}
        >
          <Text style={styles.pickerDoneText}>Done</Text>
        </Pressable>
      </View>
    )
  }

  function pill(which: NonNullable<typeof openPicker>, text: string) {
    const on = openPicker === which
    return (
      <Pressable
        style={({ pressed }) => [styles.datePill, on && styles.datePillOn, pressed && styles.pressed]}
        onPress={() => togglePicker(which)}
        disabled={readOnly}
      >
        <Text style={[styles.datePillText, readOnly && { color: t.label }]}>{text}</Text>
      </Pressable>
    )
  }

  function setTime(on: boolean) {
    markDates()
    setTimeOn(on)
    if (!on) {
      setOpenPicker((cur) => (cur === 'time' || cur === 'endTime' ? null : cur))
      return
    }
    // A date-only event gets a sensible starting time (now), and its end an
    // hour later, rather than midnight.
    const start = hhmm(date) === '00:00' ? nowOn(date) : date
    setDate(start)
    setEndDate((e) => (hhmm(e) === '00:00' ? withDay(new Date(start.getTime() + 3600_000), e) : e))
    setOpenPicker('time')
  }

  function setEnd(on: boolean) {
    markDates()
    setEndOn(on)
    if (on) {
      setEndDate(new Date(date.getTime() + (timeOn ? 3600_000 : 86400_000)))
      setOpenPicker('end')
    } else {
      setOpenPicker((cur) => (cur === 'end' || cur === 'endTime' ? null : cur))
    }
  }

  function addTags(raw: string[]) {
    const fresh = raw.map((x) => x.trim()).filter(Boolean)
    if (fresh.length) setTags((cur) => [...cur, ...fresh.filter((x, i) => !cur.includes(x) && fresh.indexOf(x) === i)])
  }
  // Return or a comma adds the tag. The field is cleared natively too: with
  // fast typing a controlled reset to '' can be dropped, leaving the old text.
  function onTagText(v: string) {
    if (!v.includes(',')) return setTagInput(v)
    const parts = v.split(',')
    const rest = parts.pop() ?? ''
    addTags(parts)
    if (!rest) tagRef.current?.clear()
    setTagInput(rest)
  }

  const personName = (id: string) =>
    allPeople.find((p) => p._id === id)?.name ?? peopleDisplay.find((p) => p.id === id)?.name
  const peopleNames = people.map(personName).filter((n): n is string => !!n)
  const placeText = location?.name || location?.address || ''
  const coords = location?.lat != null && location?.lng != null ? { lat: location.lat, lng: location.lng } : null
  const hasMedia = serverMedia.length > 0 || pending.length > 0

  const chevron = <Icon name="chevron.right" size={14} color={t.secondary} weight="bold" />

  // Grouped detail rows: round tinted icon, label, value.
  const rows: { key: string; node: ReactNode }[] = [
    {
      key: 'date',
      node: (
        <View>
          <View style={styles.row}>
            <RowIcon icon="calendar" />
            <Text style={styles.rowLabel}>{endOn ? 'Starts' : 'Date'}</Text>
            <View style={styles.pills}>
              {pill('date', displayDate(date))}
              {timeOn && endOn ? pill('time', displayTime(date)) : null}
            </View>
          </View>
          {inlinePicker('date', date, (picked) => {
            const next = withDay(date, picked)
            setDate(next)
            // Moving the start past the end drags the end along.
            if (endOn && endDate.getTime() < next.getTime()) setEndDate(next)
          })}
          {endOn ? inlinePicker('time', date, (picked) => setDate(withDay(picked, date))) : null}
        </View>
      ),
    },
  ]
  if (!readOnly || timeOn) {
    rows.push({
      key: 'time',
      node: (
        <View>
          <View style={styles.row}>
            <RowIcon icon="clock.fill" tone="second" />
            <Text style={styles.rowLabel}>{readOnly ? 'Time' : 'Add a time'}</Text>
            <View style={styles.pills}>
              {timeOn && !endOn ? pill('time', displayTime(date)) : null}
              {!readOnly ? <Switch value={timeOn} onValueChange={setTime} trackColor={{ true: t.tint }} /> : null}
            </View>
          </View>
          {!endOn ? inlinePicker('time', date, (picked) => setDate(withDay(picked, date))) : null}
        </View>
      ),
    })
  }
  if (!readOnly) {
    rows.push({
      key: 'range',
      node: (
        <View style={styles.row}>
          <RowIcon icon="calendar.badge.clock" tone="third" />
          <Text style={styles.rowLabel}>{timeOn ? 'Add an end' : 'Ends on another day'}</Text>
          <View style={styles.pills}>
            <Switch value={endOn} onValueChange={setEnd} trackColor={{ true: t.tint }} />
          </View>
        </View>
      ),
    })
  }
  if (endOn) {
    rows.push({
      key: 'end',
      node: (
        <View>
          <View style={styles.row}>
            <RowIcon icon="calendar" tone="third" />
            <Text style={styles.rowLabel}>Ends</Text>
            <View style={styles.pills}>
              {pill('end', displayDate(endDate))}
              {timeOn ? pill('endTime', displayTime(endDate)) : null}
            </View>
          </View>
          {inlinePicker('end', endDate, (picked) => setEndDate(withDay(endDate, picked)))}
          {inlinePicker('endTime', endDate, (picked) => setEndDate(withDay(picked, endDate)))}
        </View>
      ),
    })
  }
  rows.push(
    {
      key: 'location',
      node: (
        <View>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && !readOnly && styles.rowPressed]}
            onPress={() => setSheet('location')}
            disabled={readOnly}
          >
            <RowIcon icon="mappin" />
            <Text style={styles.rowLabel}>Place</Text>
            <View style={styles.rowValue}>
              {findingPlace && !placeText ? <ActivityIndicator size="small" color={t.secondary} /> : null}
              <Text style={[styles.rowValueText, !!placeText && styles.rowValueOn]} numberOfLines={1}>
                {placeText || (findingPlace ? 'Finding place…' : readOnly ? 'None' : 'Add a place')}
              </Text>
              {!readOnly ? chevron : null}
            </View>
          </Pressable>
          {coords ? (
            <Pressable onPress={() => setSheet('location')} disabled={readOnly} style={styles.miniMap}>
              <MapThumb lat={coords.lat} lng={coords.lng} style={StyleSheet.absoluteFill} />
            </Pressable>
          ) : null}
        </View>
      ),
    },
    {
      key: 'people',
      node: (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && !readOnly && styles.rowPressed]}
          onPress={() => setSheet('people')}
          disabled={readOnly}
        >
          <RowIcon icon="person.2.fill" tone="second" />
          <Text style={styles.rowLabel}>People</Text>
          <View style={styles.rowValue}>
            {peopleNames.length ? <AvatarStack names={peopleNames} size={26} ring={t.card} /> : null}
            <Text style={[styles.rowValueText, !!peopleNames.length && styles.rowValueOn]} numberOfLines={1}>
              {peopleNames.length
                ? peopleNames.length > 2
                  ? `${peopleNames.length} people`
                  : peopleNames.join(', ')
                : readOnly
                  ? 'None'
                  : 'Add people'}
            </Text>
            {!readOnly ? chevron : null}
          </View>
        </Pressable>
      ),
    },
    {
      key: 'tags',
      node: (
        <View style={[styles.row, styles.tagsRow]}>
          <RowIcon icon="tag.fill" tone="third" />
          <View style={styles.tagWrap}>
            {!tags.length && readOnly ? <Text style={styles.rowLabel}>No tags</Text> : null}
            {tags.map((tag) => (
              <Pressable
                key={tag}
                style={styles.tag}
                onPress={() => setTags((cur) => cur.filter((x) => x !== tag))}
                disabled={readOnly}
                accessibilityLabel={readOnly ? tag : `Remove tag ${tag}`}
              >
                <Text style={styles.tagText}>{tag}</Text>
                {!readOnly ? <Icon name="xmark" size={9} color={t.secondary} weight="bold" /> : null}
              </Pressable>
            ))}
            {!readOnly ? (
              <TextInput
                style={styles.tagInput}
                value={tagInput}
                ref={tagRef}
                onChangeText={onTagText}
                onSubmitEditing={() => {
                  addTags([tagInput])
                  tagRef.current?.clear()
                  setTagInput('')
                }}
                placeholder={tags.length ? 'Add tag' : 'Add a tag'}
                placeholderTextColor={t.secondary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                submitBehavior="submit"
              />
            ) : null}
          </View>
        </View>
      ),
    },
  )
  if (threads.length > 1) {
    rows.push({
      key: 'thread',
      node: (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && !readOnly && styles.rowPressed]}
          onPress={pickThread}
          disabled={readOnly}
        >
          <RowIcon icon="line.3.horizontal" tone="neutral" />
          <Text style={styles.rowLabel}>Thread</Text>
          <View style={styles.rowValue}>
            {thread ? <View style={[styles.dot, { backgroundColor: paletteColor(thread.color, t.dark) }]} /> : null}
            <Text style={[styles.rowValueText, styles.rowValueOn]} numberOfLines={1}>
              {thread?.name ?? 'Choose'}
            </Text>
            {!readOnly ? chevron : null}
          </View>
        </Pressable>
      ),
    })
  }

  const removeButton = (onPress: () => void) => (
    <Pressable style={styles.remove} onPress={onPress} hitSlop={8} accessibilityLabel="Remove">
      <Icon name="xmark" size={11} color="#FFFFFF" weight="bold" />
    </Pressable>
  )

  // Tile art for media without a picture: a waveform for audio, a page for a PDF.
  const glyphTile = (kind: 'audio' | 'pdf', duration?: number | null, seed = 7) =>
    kind === 'audio' ? (
      <View style={[styles.tileCenter, { backgroundColor: t.audioSoft, paddingHorizontal: 14, gap: 6 }]}>
        <Waveform seed={seed} bars={12} height={30} on={t.audio} off={t.audio} />
        {fmtDuration(duration) ? <Text style={styles.tileDur}>{fmtDuration(duration)}</Text> : null}
      </View>
    ) : (
      <View style={[styles.tileCenter, { backgroundColor: t.dangerSoft }]}>
        <Icon name="doc.text.fill" size={30} color={t.danger} weight="regular" />
      </View>
    )

  // On a PDF tile showing its first page, so it doesn't pass for a photo.
  const docBadge = (
    <View style={styles.docBadge} pointerEvents="none">
      <Icon name="doc.text.fill" size={13} color="#FFFFFF" />
    </View>
  )

  const mediaStrip = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
      {serverMedia.map((m) => {
        // A PDF shows its page-1 thumb when it has one, never the PDF itself.
        const uri = m.kind === 'audio' ? null : m.kind === 'pdf' ? (m.thumb_url ?? null) : thumbUriFor(m)
        return (
          <View key={m.key} style={styles.tile}>
            {uri ? (
              <Image source={{ uri, cacheKey: `${m.key}:thumb` }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : m.kind === 'audio' || m.kind === 'pdf' ? (
              glyphTile(m.kind, m.duration_seconds, seedOf(m.key))
            ) : null}
            {m.kind === 'video' ? (
              <View style={styles.tileCenter} pointerEvents="none">
                <Icon name="play.fill" size={24} color="#FFFFFF" weight="regular" />
              </View>
            ) : null}
            {m.kind === 'pdf' && uri ? docBadge : null}
            {!readOnly ? removeButton(() => detachServerMedia(m.key)) : null}
          </View>
        )
      })}
      {pending.map((m) => (
        <View key={m.localUri} style={styles.tile}>
          {m.isAudio ? glyphTile('audio', m.durationSeconds, seedOf(m.localUri)) : null}
          {m.isPdf && !m.previewUri ? glyphTile('pdf') : null}
          {m.previewUri ? (
            <Image source={{ uri: m.previewUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          {m.isPdf && m.previewUri ? docBadge : null}
          {m.isVideo && m.status === 'done' ? (
            <View style={styles.tileCenter} pointerEvents="none">
              <Icon name="play.fill" size={24} color="#FFFFFF" weight="regular" />
            </View>
          ) : null}
          {m.status === 'uploading' ? (
            <View style={[styles.tileCenter, styles.tileDim]}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : m.status === 'error' ? (
            <View style={[styles.tileCenter, styles.tileError]}>
              <Text style={styles.tileErrorText}>Failed</Text>
            </View>
          ) : null}
          {m.status !== 'uploading' ? removeButton(() => dropPending(m.localUri)) : null}
        </View>
      ))}
      {!readOnly ? (
        <>
          <Pressable
            style={({ pressed }) => [styles.tile, styles.addTile, pressed && styles.pressed]}
            onPress={pickMedia}
            accessibilityLabel="Add photos or videos"
          >
            <Icon name="plus" size={22} color={t.tintText} weight="bold" />
            <Text style={styles.addTileText}>Add</Text>
          </Pressable>
          {!recording ? (
            <Pressable
              style={({ pressed }) => [styles.tile, styles.addTile, styles.voiceTile, pressed && styles.pressed]}
              onPress={() => setRecording(true)}
              accessibilityLabel="Record a voice note"
            >
              <Icon name="mic.fill" size={22} color={t.audio} />
              <Text style={[styles.addTileText, { color: t.audio }]}>Voice</Text>
            </Pressable>
          ) : null}
          {documentsAvailable ? (
            <Pressable
              style={({ pressed }) => [styles.tile, styles.addTile, styles.docTile, pressed && styles.pressed]}
              onPress={addDocument}
              accessibilityLabel="Add a document"
            >
              <Icon name="doc.text.fill" size={22} color={t.danger} />
              <Text style={[styles.addTileText, { color: t.danger }]}>Document</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  )

  const recorder = recording ? (
    <VoiceRecorder
      onCancel={() => setRecording(false)}
      onRecorded={(asset, secs) => {
        setRecording(false)
        addAssets([asset], { duration_seconds: secs })
      }}
    />
  ) : null

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
          {readOnly ? (
            <View style={styles.banner}>
              <Icon name="lock.fill" size={16} color={t.second} />
              <Text style={styles.bannerText}>This moment is shared with you — read only.</Text>
            </View>
          ) : null}

          {recorder}

          {hasMedia ? (
            <View>
              {mediaStrip}
              {isEdit && !readOnly ? (
                <Text style={styles.footnote}>Media changes save right away.</Text>
              ) : null}
            </View>
          ) : !readOnly && !recording ? (
            <View style={{ gap: 10 }}>
              <Pressable
                style={({ pressed }) => [styles.addMedia, pressed && styles.pressed]}
                onPress={pickMedia}
                accessibilityRole="button"
              >
                <View style={styles.addMediaIcon}>
                  <Icon name="photo.badge.plus" size={24} color={t.onTint} />
                </View>
                <View>
                  <Text style={styles.addMediaTitle}>Add photos or videos</Text>
                  <Text style={styles.addMediaSub}>From your library</Text>
                </View>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.voiceRow, pressed && styles.pressed]}
                onPress={() => setRecording(true)}
                accessibilityRole="button"
              >
                <Icon name="mic.fill" size={17} color={t.audio} />
                <Text style={styles.voiceRowText}>Record a voice note</Text>
              </Pressable>
              {documentsAvailable ? (
                <Pressable
                  style={({ pressed }) => [styles.voiceRow, styles.docRow, pressed && styles.pressed]}
                  onPress={addDocument}
                  accessibilityRole="button"
                >
                  <Icon name="doc.text.fill" size={17} color={t.danger} />
                  <Text style={[styles.voiceRowText, { color: t.danger }]}>Add a document</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {prefillNote && !readOnly ? (
            <View style={styles.banner}>
              <Icon name="sparkles" size={17} color={t.second} />
              <Text style={styles.bannerText}>{prefillNote}</Text>
            </View>
          ) : null}

          <View style={styles.fields}>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Give it a title"
              placeholderTextColor={t.placeholder}
              autoFocus={!isEdit}
              editable={!readOnly}
              returnKeyType="next"
            />
            <View style={styles.fieldRule} />
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
              style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
              onPress={confirmDelete}
              disabled={saving}
              accessibilityRole="button"
            >
              <Icon name="trash" size={18} color={t.danger} />
              <Text style={styles.deleteText}>Delete moment</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <LocationPicker
        visible={sheet === 'location'}
        initial={location}
        onCancel={() => setSheet(null)}
        onDone={(place) => {
          touched.current.location = true
          setLocationTouched(true)
          setLocation(place)
          setSheet(null)
        }}
      />
      <PeoplePicker
        visible={sheet === 'people'}
        people={allPeople}
        selected={people}
        onCancel={() => setSheet(null)}
        onPersonCreated={(person) => setAllPeople((cur) => [...cur, person])}
        onDone={(ids) => {
          setPeople(ids)
          setSheet(null)
        }}
      />
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 6,
    },
    headerTitle: { fontFamily: font.heavy, fontSize: 17, color: t.label },
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
    footnote: {
      fontFamily: font.semibold,
      fontSize: 13.5,
      lineHeight: 18,
      color: t.secondary,
      paddingHorizontal: 6,
      marginTop: 8,
    },
    pressed: { opacity: 0.6 },
    addMedia: {
      height: 124,
      borderRadius: 24,
      borderWidth: 2.5,
      borderStyle: 'dashed',
      borderColor: t.tint + '80',
      backgroundColor: t.primarySoft + '55',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    addMediaIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: t.tint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addMediaTitle: { fontFamily: font.heavy, fontSize: 17, color: t.tintText },
    addMediaSub: { fontFamily: font.semibold, fontSize: 14, color: t.secondary, marginTop: 2 },
    voiceRow: {
      height: 48,
      borderRadius: 24,
      backgroundColor: t.audioSoft,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    voiceRowText: { fontFamily: font.heavy, fontSize: 15.5, color: t.audio },
    photos: { gap: 10 },
    tile: { width: 104, height: 104, borderRadius: 20, overflow: 'hidden', backgroundColor: t.photoPlaceholder },
    addTile: {
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      borderStyle: 'dashed',
      borderColor: t.tint + '80',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    voiceTile: { borderColor: t.audio + '66' },
    docTile: { borderColor: t.danger + '66' },
    docBadge: {
      position: 'absolute',
      left: 8,
      bottom: 8,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.danger,
    },
    docRow: { backgroundColor: t.dangerSoft },
    addTileText: { fontFamily: font.heavy, fontSize: 13, color: t.tintText },
    tileCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    tileDur: { fontFamily: font.heavy, fontSize: 12, color: t.audio },
    tileDim: { backgroundColor: 'rgba(0,0,0,0.35)' },
    tileError: { backgroundColor: 'rgba(184,67,58,0.7)' },
    tileErrorText: { color: '#FFFFFF', fontSize: 13, fontFamily: font.heavy },
    remove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: t.secondSoft,
    },
    bannerText: { flex: 1, fontFamily: font.bold, fontSize: 14.5, lineHeight: 19, color: t.label },
    fields: { backgroundColor: t.card, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 6, ...cardShadow(t) },
    titleInput: {
      fontFamily: font.serif,
      fontSize: 24,
      lineHeight: 30,
      color: t.label,
      paddingTop: 10,
      paddingBottom: 12,
    },
    fieldRule: { height: StyleSheet.hairlineWidth, backgroundColor: t.separator },
    descInput: {
      fontFamily: font.semibold,
      fontSize: 16.5,
      lineHeight: 24,
      color: t.label,
      paddingTop: 12,
      paddingBottom: 12,
      minHeight: 84,
      textAlignVertical: 'top',
    },
    group: { backgroundColor: t.card, borderRadius: 24, overflow: 'hidden', ...cardShadow(t) },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.separator },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      minHeight: 62,
    },
    rowPressed: { backgroundColor: t.surface2 },
    rowLabel: { fontFamily: font.heavy, fontSize: 16.5, color: t.label },
    rowValue: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
    rowValueText: { fontFamily: font.bold, fontSize: 15.5, color: t.secondary, flexShrink: 1 },
    rowValueOn: { color: t.label },
    miniMap: { height: 112, marginHorizontal: 12, marginBottom: 12, borderRadius: 16, overflow: 'hidden' },
    dot: { width: 10, height: 10, borderRadius: 5 },
    datePill: {
      height: 36,
      paddingHorizontal: 13,
      borderRadius: 12,
      backgroundColor: t.surface2,
      justifyContent: 'center',
    },
    datePillOn: { backgroundColor: t.primarySoft },
    datePillText: { fontFamily: font.heavy, fontSize: 15, color: t.tintText },
    pills: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },
    picker: { marginHorizontal: 8 },
    pickerDone: {
      alignSelf: 'flex-end',
      height: 36,
      paddingHorizontal: 16,
      marginRight: 14,
      marginBottom: 12,
      borderRadius: 12,
      backgroundColor: t.primarySoft,
      justifyContent: 'center',
    },
    pickerDoneText: { fontFamily: font.heavy, fontSize: 15, color: t.tintText },
    tagsRow: { alignItems: 'flex-start' },
    tagWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, minHeight: 38 },
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 17,
      backgroundColor: t.thirdSoft,
    },
    tagText: { fontFamily: font.heavy, fontSize: 14.5, color: t.label },
    tagInput: { flexGrow: 1, minWidth: 90, fontFamily: font.bold, fontSize: 16, color: t.label, paddingVertical: 6 },
    deleteBtn: {
      height: 56,
      borderRadius: 20,
      backgroundColor: t.card,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 4,
      ...cardShadow(t),
    },
    deleteText: { fontFamily: font.heavy, fontSize: 17, color: t.danger },
    error: { color: t.danger, fontFamily: font.bold, fontSize: 15, textAlign: 'center' },
  })
}
