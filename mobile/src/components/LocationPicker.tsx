import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { AppleMaps } from 'expo-maps'
import { reverseGeocode, searchPlaces } from '../api/geocode'
import { looksLikeMapLink, resolvePlaceLink } from '../api/places'
import type { LocationDetail } from '../api/types'
import { FillButton, Icon, TintButton } from '@/components/ui'
import { useTheme, type Theme } from '@/theme'

// Full-screen place picker for the event form, the native take on the web
// LocationPicker: search places (Nominatim, debounced like the web), paste a
// Google / Apple Maps link (resolved by the backend), or tap the map to drop a
// pin (reverse-geocoded). The name stays editable, so a pin can be called
// "Grandma's house", and a name with no pin is still a valid location.

const SEARCH_DEBOUNCE_MS = 400
const PLACE_ZOOM = 15

function hasCoords(p: LocationDetail | null): p is LocationDetail & { lat: number; lng: number } {
  return p?.lat != null && p?.lng != null
}

export default function LocationPicker({
  visible,
  initial,
  onDone,
  onCancel,
}: {
  visible: boolean
  initial: LocationDetail | null
  onDone: (place: LocationDetail | null) => void
  onCancel: () => void
}) {
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])
  const map = useRef<AppleMaps.MapView>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocationDetail[]>([])
  const [searching, setSearching] = useState(false)
  const [place, setPlace] = useState<LocationDetail | null>(initial)
  const [name, setName] = useState(initial?.name || initial?.address || '')
  const [naming, setNaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each open starts from the form's current location.
  useEffect(() => {
    if (!visible) return
    setQuery('')
    setResults([])
    setError(null)
    setPlace(initial)
    setName(initial?.name || initial?.address || '')
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search; a pasted map link resolves to its place instead. The
  // `stale` flag drops responses for text the user has already changed.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    let stale = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        if (looksLikeMapLink(q)) {
          const resolved = await resolvePlaceLink(q)
          if (!stale) choose(resolved)
          return
        }
        const hits = await searchPlaces(q)
        if (!stale) setResults(hits)
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : "Couldn't search for that place.")
      } finally {
        if (!stale) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  function choose(p: LocationDetail) {
    Keyboard.dismiss()
    setQuery('')
    setResults([])
    setError(null)
    setPlace(p)
    setName(p.name || p.address || '')
    if (hasCoords(p)) {
      void map.current?.setCameraPosition({ coordinates: { latitude: p.lat, longitude: p.lng }, zoom: PLACE_ZOOM })
    }
  }

  async function dropPin(latitude?: number, longitude?: number) {
    if (latitude == null || longitude == null) return
    Keyboard.dismiss()
    setError(null)
    setPlace({ lat: latitude, lng: longitude })
    setNaming(true)
    const found = await reverseGeocode(latitude, longitude).catch(() => null)
    setNaming(false)
    // Ignore a slow lookup for a pin the user has already moved.
    setPlace((cur) => (cur?.lat === latitude && cur?.lng === longitude ? (found ?? cur) : cur))
    if (found?.name) setName(found.name)
  }

  function done() {
    const trimmed = name.trim()
    if (!place && !trimmed) onDone(null)
    else onDone({ ...place, name: trimmed || place?.name || null })
  }

  const camera = hasCoords(initial)
    ? { coordinates: { latitude: initial.lat, longitude: initial.lng }, zoom: PLACE_ZOOM }
    : undefined
  const showResults = query.trim().length > 0

  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onCancel}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <FillButton icon="xmark" accessibilityLabel="Cancel" onPress={onCancel} />
          <Text style={styles.headerTitle}>Location</Text>
          <TintButton icon="checkmark" accessibilityLabel="Done" onPress={done} />
        </View>

        <View style={styles.search}>
          <Icon name="magnifyingglass" size={16} color={t.secondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search or paste a map link"
            placeholderTextColor={t.placeholder}
            autoFocus={!initial}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searching ? <ActivityIndicator color={t.secondary} /> : null}
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {/* The map stays mounted under the results so choosing one can move
              its camera straight away. */}
          <View style={styles.mapWrap}>
            <AppleMaps.View
              ref={map}
              style={styles.flex}
              cameraPosition={camera}
              uiSettings={{ myLocationButtonEnabled: false }}
              markers={
                hasCoords(place)
                  ? [{ id: 'pin', coordinates: { latitude: place.lat, longitude: place.lng }, tintColor: t.tint }]
                  : []
              }
              onMapClick={(e) => void dropPin(e.coordinates.latitude, e.coordinates.longitude)}
            />
            <View style={styles.hint} pointerEvents="none">
              <Text style={styles.hintText}>Tap the map to drop a pin</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.nameRow}>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder={naming ? 'Finding place…' : 'Name this place'}
                placeholderTextColor={t.placeholder}
                returnKeyType="done"
              />
              {naming ? <ActivityIndicator color={t.secondary} /> : null}
            </View>
            {place?.address ? (
              <Text style={styles.address} numberOfLines={2}>
                {place.address}
              </Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {place || name ? (
              <Pressable onPress={() => onDone(null)} hitSlop={8}>
                <Text style={styles.remove}>Remove Location</Text>
              </Pressable>
            ) : null}
          </View>

          {showResults ? (
            <FlatList
              style={styles.resultsLayer}
              data={results}
              keyExtractor={(p, i) => `${p.lat},${p.lng},${i}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.results}
              ListEmptyComponent={
                searching ? undefined : <Text style={styles.empty}>{error ?? 'No places found.'}</Text>
              }
              renderItem={({ item }) => (
                <Pressable style={({ pressed }) => [styles.result, pressed && styles.pressed]} onPress={() => choose(item)}>
                  <Icon name="mappin.circle.fill" size={28} color={t.tint} weight="regular" />
                  <View style={styles.resultText}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.resultAddress} numberOfLines={2}>
                      {item.address}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: t.modalBg },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
    },
    headerTitle: { fontSize: 17, fontWeight: '600', color: t.label },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 12,
      paddingHorizontal: 12,
      height: 44,
      borderRadius: 12,
      backgroundColor: t.fill,
    },
    searchInput: { flex: 1, fontSize: 17, color: t.label },
    resultsLayer: { ...StyleSheet.absoluteFill, backgroundColor: t.modalBg },
    results: { paddingHorizontal: 16, paddingBottom: 40 },
    result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    resultText: { flex: 1, gap: 2 },
    resultName: { fontSize: 17, color: t.label },
    resultAddress: { fontSize: 13, lineHeight: 17, color: t.secondary },
    pressed: { opacity: 0.6 },
    empty: { fontSize: 15, color: t.secondary, textAlign: 'center', marginTop: 24 },
    mapWrap: { flex: 1, marginHorizontal: 16, borderRadius: 22, overflow: 'hidden' },
    hint: {
      position: 'absolute',
      top: 10,
      alignSelf: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: t.overlay,
    },
    hintText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
    card: {
      margin: 16,
      marginBottom: 40,
      padding: 16,
      gap: 8,
      borderRadius: 22,
      backgroundColor: t.modalCard,
    },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nameInput: { flex: 1, fontSize: 20, fontWeight: '600', color: t.label },
    address: { fontSize: 15, lineHeight: 20, color: t.secondary },
    error: { fontSize: 15, color: t.danger },
    remove: { fontSize: 17, color: t.danger, marginTop: 4 },
  })
}
