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
import {
  attachMedia,
  createEvent,
  deleteEvent,
  getEvent,
  removeMedia,
  updateEvent,
} from '../api/events'
import { listPeople } from '../api/people'
import { listThreads } from '../api/threads'
import { extractExif, isVideoAsset, uploadMedia, videoPoster, type PickedAsset } from '../api/uploads'
import { reverseGeocode } from '../api/geocode'
import { resolvePlaceLink } from '../api/places'
import { extractVideoMetadata } from '../lib/videoMetadata'
import type { LocationDetail, MediaRef, Person, Thread, TimelineEvent } from '../api/types'
import { useTimelineSignal } from '../store/timeline'
import LocationPicker from '@/components/LocationPicker'
import PeoplePicker from '@/components/PeoplePicker'
import { FillButton, Icon, IconTile, TintButton } from '@/components/ui'
import { avatarColor, initials, paletteColor, useTheme, type Theme } from '@/theme'

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
  // Tile image: the photo itself, or a video's first-frame poster.
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
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), time.getUTCHours(), time.getUTCMinutes()))
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
  // Set by the date/location handlers and read inside the async EXIF prefill,
  // which must not overwrite a user edit.
  const touched = useRef({ date: false, location: false })
  // Dev effects run twice; the shared photos must only be queued once.
  const sharedTaken = useRef(false)
  const linkTaken = useRef(false)

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
    void prefillFromMedia(sharedAssets[0], !sharedLink)
  }, [sharedAssets, isEdit])

  useEffect(() => {
    if (isEdit || linkTaken.current || (!sharedLink && !sharedText)) return
    linkTaken.current = true
    if (sharedText) setDescription((cur) => cur || sharedText)
    if (sharedLink) void prefillFromLink(sharedLink)
  }, [sharedLink, sharedText, isEdit])

  async function prefillFromLink(link: string) {
    setFindingPlace(true)
    try {
      const place = await resolvePlaceLink(link)
      if (touched.current.location) return
      setLocation(place)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that map link.")
    } finally {
      setFindingPlace(false)
    }
  }

  async function prefillFromMedia(asset: PickedAsset, useLocation: boolean) {
    try {
      const exif = isVideoAsset(asset) ? await extractVideoMetadata(asset.uri) : await extractExif(asset)
      if (exif.date && !touched.current.date) {
        setDate(new Date(`${exif.date}T${exif.time || '00:00'}:00.000Z`))
        if (exif.time) setTimeOn(true)
      }
      if (!useLocation || exif.lat == null || exif.lng == null || touched.current.location) return
      setFindingPlace(true)
      const place = await reverseGeocode(exif.lat, exif.lng).catch(() => null)
      if (touched.current.location) return
      setLocation(place ?? { lat: exif.lat, lng: exif.lng })
    } catch {
      // No metadata (or a screenshot) — the form just keeps today's date.
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
      const isVideo = isVideoAsset(picked)
      setPending((prev) => [...prev, { localUri, status: 'uploading', isVideo, previewUri: isVideo ? undefined : localUri }])
      if (isVideo) {
        videoPoster(localUri)
          .then((frame) =>
            setPending((prev) => prev.map((m) => (m.localUri === localUri ? { ...m, previewUri: frame.uri } : m))),
          )
          .catch(() => {})
      }
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
        .catch((e) => {
          setPending((prev) =>
            prev.map((m) => (m.localUri === localUri ? { ...m, status: 'error' } : m)),
          )
          const why = e instanceof Error ? e.message : String(e)
          setError(`Couldn't upload that ${isVideo ? 'video' : 'photo'}: ${why}`)
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
        const attached = pending
          .filter((m) => m.status === 'done' && m.ref)
          .map((m) => m.ref as MediaRef)
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
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        timeZoneName="UTC"
        accentColor={t.tint}
        themeVariant={t.dark ? 'dark' : 'light'}
        display={Platform.OS === 'ios' ? (mode === 'date' ? 'inline' : 'spinner') : 'default'}
        style={styles.picker}
        onValueChange={(_event, picked) => {
          // A calendar closes on a pick; the time wheels stay up while they spin.
          if (Platform.OS !== 'ios' || mode === 'date') setOpenPicker(null)
          markDates()
          onPick(picked)
        }}
        onDismiss={() => setOpenPicker(null)}
      />
    )
  }

  function pill(which: NonNullable<typeof openPicker>, text: string) {
    return (
      <Pressable
        style={styles.datePill}
        onPress={() => togglePicker(which)}
        disabled={readOnly}
      >
        <Text style={styles.datePillText}>{text}</Text>
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

  // Grouped detail rows, iOS Settings style: coloured icon tile, label, value.
  const rows: { key: string; node: ReactNode }[] = [
    {
      key: 'date',
      node: (
        <View>
          <View style={styles.row}>
            <IconTile icon="calendar" color="#E5484D" />
            <Text style={styles.rowLabel}>{endOn ? 'Starts' : 'Date'}</Text>
            <View style={styles.pills}>
              {pill('date', displayDate(date))}
              {timeOn ? pill('time', displayTime(date)) : null}
            </View>
          </View>
          {inlinePicker('date', date, (picked) => {
            const next = withDay(date, picked)
            setDate(next)
            // Moving the start past the end drags the end along.
            if (endOn && endDate.getTime() < next.getTime()) setEndDate(next)
          })}
          {inlinePicker('time', date, (picked) => setDate(withDay(picked, date)))}
        </View>
      ),
    },
  ]
  if (!readOnly) {
    rows.push(
      {
        key: 'time',
        node: (
          <View style={styles.row}>
            <IconTile icon="clock.fill" color="#007AFF" />
            <Text style={styles.rowLabel}>Time</Text>
            <Switch style={styles.switch} value={timeOn} onValueChange={setTime} />
          </View>
        ),
      },
      {
        key: 'range',
        node: (
          <View style={styles.row}>
            <IconTile icon="calendar.badge.clock" color="#FF9500" />
            <Text style={styles.rowLabel}>End Date</Text>
            <Switch style={styles.switch} value={endOn} onValueChange={setEnd} />
          </View>
        ),
      },
    )
  }
  if (endOn) {
    rows.push({
      key: 'end',
      node: (
        <View>
          <View style={styles.row}>
            <IconTile icon="calendar" color="#E5484D" />
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
        <Pressable style={styles.row} onPress={() => setSheet('location')} disabled={readOnly}>
          <IconTile icon="mappin" color={t.tint} />
          <Text style={styles.rowLabel}>Location</Text>
          <View style={styles.rowValue}>
            <Text style={[styles.rowValueText, !placeText && { color: t.placeholder }]} numberOfLines={1}>
              {placeText || (findingPlace ? 'Finding place…' : readOnly ? 'None' : 'Add place')}
            </Text>
            {!readOnly ? <Icon name="chevron.right" size={13} color={t.chevron} weight="bold" /> : null}
          </View>
        </Pressable>
      ),
    },
    {
      key: 'people',
      node: (
        <Pressable style={styles.row} onPress={() => setSheet('people')} disabled={readOnly}>
          <IconTile icon="person.2.fill" color="#34A853" />
          <Text style={styles.rowLabel}>People</Text>
          <View style={styles.rowValue}>
            {peopleNames.length ? (
              <View style={styles.avatars}>
                {peopleNames.slice(0, 3).map((name, i) => (
                  <View
                    key={`${name}-${i}`}
                    style={[styles.avatar, { backgroundColor: avatarColor(name) }, i > 0 && { marginLeft: -6 }]}
                  >
                    <Text style={styles.avatarText}>{initials(name)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={[styles.rowValueText, !peopleNames.length && { color: t.placeholder }]} numberOfLines={1}>
              {peopleNames.length ? peopleNames.join(', ') : readOnly ? 'None' : 'Add people'}
            </Text>
            {!readOnly ? <Icon name="chevron.right" size={13} color={t.chevron} weight="bold" /> : null}
          </View>
        </Pressable>
      ),
    },
    {
      key: 'tags',
      node: (
        <View style={[styles.row, styles.tagsRow]}>
          <IconTile icon="tag.fill" color="#E8833A" />
          <View style={styles.tagWrap}>
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
                placeholder={tags.length ? 'Add tag' : 'Tags'}
                placeholderTextColor={t.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                submitBehavior="submit"
              />
            ) : !tags.length ? (
              <Text style={[styles.rowLabel, { color: t.placeholder }]}>No tags</Text>
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
                <Pressable style={({ pressed }) => [styles.addTile, pressed && styles.pressed]} onPress={pickMedia}>
                  <Icon name="photo.badge.plus" size={28} color={t.tintText} weight="regular" />
                  <Text style={styles.addTileText}>Add Media</Text>
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
                        accessibilityLabel="Remove"
                      >
                        <Icon name="xmark" size={10} color="#FFFFFF" weight="bold" />
                      </Pressable>
                    ) : null}
                  </View>
                )
              })}
              {pending.map((m) => (
                <View key={m.localUri} style={styles.tile}>
                  {m.previewUri ? (
                    <Image source={{ uri: m.previewUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : null}
                  {m.isVideo && m.status === 'done' ? (
                    <View style={styles.tileCenter} pointerEvents="none">
                      <Icon name="play.fill" size={26} color="#FFFFFF" weight="regular" />
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
                  {m.status !== 'uploading' ? (
                    <Pressable
                      style={styles.remove}
                      onPress={() => dropPending(m.localUri)}
                      hitSlop={8}
                      accessibilityLabel="Remove"
                    >
                      <Icon name="xmark" size={10} color="#FFFFFF" weight="bold" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
            {isEdit && !readOnly ? <Text style={[styles.footnote, { marginTop: 8 }]}>Media changes save immediately.</Text> : null}
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
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: t.fill,
      justifyContent: 'center',
    },
    datePillText: { fontSize: 17, color: t.tintText },
    pills: { marginLeft: 'auto', flexDirection: 'row', gap: 6 },
    picker: { marginHorizontal: 8 },
    // RN's iOS Switch defaults to alignSelf: 'flex-start' (top of the row).
    switch: { marginLeft: 'auto', alignSelf: 'center' },
    avatars: { flexDirection: 'row' },
    avatar: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: t.modalCard,
    },
    avatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
    tagsRow: { alignItems: 'flex-start', paddingVertical: 11 },
    tagWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, minHeight: 30 },
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 30,
      paddingHorizontal: 11,
      borderRadius: 15,
      backgroundColor: t.fill,
    },
    tagText: { fontSize: 15, color: t.label },
    tagInput: { flexGrow: 1, minWidth: 90, fontSize: 17, color: t.label, paddingVertical: 4 },
    deleteBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
    deleteText: { fontSize: 17, fontWeight: '500', color: t.danger },
    error: { color: t.danger, fontSize: 15, textAlign: 'center' },
    link: { color: t.tintText, fontSize: 17, fontWeight: '600' },
  })
}
