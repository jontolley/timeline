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
import { lastKnownSpot } from '../lib/currentPlace'
import { FillButton, Icon, RowIcon, TintButton } from '@/components/ui'
import { cardShadow, font, useTheme, type Theme } from '@/theme'

// Full-screen place picker for the event form, the native take on the web
// LocationPicker: search places (Apple Maps search near the moment's place or
// the phone, falling back to Nominatim; debounced like the web), paste a
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
  // Where search results should cluster: the moment's place when it has one
  // (an old trip's searches stay local to it), else where the phone is.
  const [phoneSpot, setPhoneSpot] = useState<{ lat: number; lng: number } | null>(null)
  const near = hasCoords(place) ? { lat: place.lat, lng: place.lng } : phoneSpot

  // Each open starts from the form's current location.
  useEffect(() => {
    if (!visible) return
    setQuery('')
    setResults([])
    setError(null)
    setPlace(initial)
    setName(initial?.name || initial?.address || '')
    void lastKnownSpot().then(setPhoneSpot)
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
        const hits = await searchPlaces(q, near)
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
          <Text style={styles.headerTitle}>Place</Text>
          <TintButton icon="checkmark" accessibilityLabel="Done" onPress={done} />
        </View>

        <View style={styles.search}>
          <Icon name="magnifyingglass" size={18} color={t.secondary} />
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
              <Icon name="mappin" size={12} color="#1F2A37" weight="bold" />
              <Text style={styles.hintText}>
                {hasCoords(place) ? 'Tap the map to move the pin' : 'Tap the map to drop a pin'}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.nameRow}>
              <RowIcon icon="mappin" />
              <View style={styles.flex}>
                <TextInput
                  style={styles.nameInput}
                  value={name}
                  onChangeText={setName}
                  placeholder={naming ? 'Finding place…' : 'Name this place'}
                  placeholderTextColor={t.placeholder}
                  returnKeyType="done"
                />
                {place?.address ? (
                  <Text style={styles.address} numberOfLines={2}>
                    {place.address}
                  </Text>
                ) : null}
              </View>
              {naming ? (
                <ActivityIndicator color={t.secondary} />
              ) : (
                <Icon name="square.and.pencil" size={18} color={t.secondary} />
              )}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
          <Text style={styles.footnote}>The name is yours to change, like “Grandma’s house”.</Text>
          {place || name ? (
            <Pressable
              style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
              onPress={() => onDone(null)}
            >
              <Text style={styles.remove}>Remove place</Text>
            </Pressable>
          ) : null}
          <View style={{ height: 32 }} />

          {showResults ? (
            <FlatList
              style={styles.resultsLayer}
              data={results}
              keyExtractor={(p, i) => `${p.lat},${p.lng},${i}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.results, results.length > 0 && styles.resultsCard]}
              ListEmptyComponent={
                searching ? undefined : <Text style={styles.empty}>{error ?? 'No places found.'}</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.result, pressed && styles.pressed]}
                  onPress={() => choose(item)}
                >
                  <RowIcon icon="mappin" />
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
    sheet: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
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
    resultsLayer: { ...StyleSheet.absoluteFill, backgroundColor: t.bg },
    results: { marginHorizontal: 16, paddingBottom: 8 },
    resultsCard: { backgroundColor: t.card, borderRadius: 22, overflow: 'hidden', ...cardShadow(t) },
    result: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.separator,
    },
    resultText: { flex: 1, gap: 2 },
    resultName: { fontFamily: font.bold, fontSize: 16, color: t.label },
    resultAddress: { fontFamily: font.semibold, fontSize: 14, lineHeight: 18, color: t.secondary },
    pressed: { opacity: 0.6 },
    empty: { fontFamily: font.semibold, fontSize: 15, color: t.secondary, textAlign: 'center', marginTop: 24 },
    mapWrap: { flex: 1, marginHorizontal: 16, borderRadius: 24, overflow: 'hidden', backgroundColor: t.surface2 },
    hint: {
      position: 'absolute',
      top: 12,
      left: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 28,
      paddingHorizontal: 10,
      borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,0.94)',
    },
    hintText: { color: '#1F2A37', fontFamily: font.heavy, fontSize: 12.5 },
    card: {
      marginHorizontal: 16,
      marginTop: 14,
      paddingHorizontal: 16,
      paddingVertical: 13,
      gap: 8,
      borderRadius: 24,
      backgroundColor: t.card,
      ...cardShadow(t),
    },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    nameInput: { fontFamily: font.heavy, fontSize: 16.5, color: t.label, paddingVertical: 2 },
    address: { fontFamily: font.semibold, fontSize: 14, lineHeight: 18, color: t.secondary },
    error: { fontFamily: font.semibold, fontSize: 14.5, color: t.danger },
    footnote: { fontFamily: font.semibold, fontSize: 13.5, color: t.secondary, paddingHorizontal: 26, paddingTop: 8 },
    removeBtn: {
      marginHorizontal: 16,
      marginTop: 14,
      height: 52,
      borderRadius: 20,
      backgroundColor: t.card,
      alignItems: 'center',
      justifyContent: 'center',
      ...cardShadow(t),
    },
    remove: { fontFamily: font.heavy, fontSize: 17, color: t.danger },
  })
}
