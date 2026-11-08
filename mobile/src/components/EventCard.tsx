import { useMemo, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { AppleMaps } from 'expo-maps'
import type { MediaRef, TimelineEvent } from '@/api/types'
import {
  asLoc,
  cardDay,
  cardKind,
  coverSource,
  fmtDuration,
  isVisual,
  joinNames,
  kindLabel,
  placeLabel,
  seedOf,
  thumbSource,
} from '@/lib/format'
import { AvatarStack, Icon, Waveform } from '@/components/ui'
import { useRecordingPlayer } from '@/lib/useRecordingPlayer'
import { cardShadow, font, paletteColor, useTheme, type Theme } from '@/theme'

// The timeline's "mat" cards — one look per kind of moment (photos, video, a
// place, audio, a note) — plus the compact row used for busy months and
// search results, and the small square thumbnail they share.

const MAP_ZOOM = 12
// expo-maps doesn't export the emphasis enum at runtime; this is its MUTED value.
const MUTED = 'MUTED' as NonNullable<AppleMaps.MapProperties['emphasis']>

// A non-interactive Apple Map of one place, used as a card's media and on the
// detail page. pointerEvents="none" so it never steals the list's scroll.
export function MapThumb({
  lat,
  lng,
  zoom = MAP_ZOOM,
  style,
}: {
  lat: number
  lng: number
  zoom?: number
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: t.surface2 }, style]} pointerEvents="none">
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={{ coordinates: { latitude: lat, longitude: lng }, zoom }}
        uiSettings={{ compassEnabled: false, myLocationButtonEnabled: false, scaleBarEnabled: false, togglePitchEnabled: false }}
        properties={{ emphasis: MUTED, selectionEnabled: false, isMyLocationEnabled: false }}
        markers={[{ id: 'pin', coordinates: { latitude: lat, longitude: lng }, tintColor: t.tint }]}
      />
    </View>
  )
}

// White pill over media ("2 photos", "▶ 0:42", a place name).
export function MediaBadge({ icon, text, left }: { icon: Parameters<typeof Icon>[0]['name']; text: string; left?: boolean }) {
  return (
    <View style={[badge.wrap, left ? { left: 9 } : { right: 9 }]}>
      <Icon name={icon} size={12} color="#1F2A37" weight="bold" />
      <Text style={badge.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  )
}

const badge = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 9,
    maxWidth: '80%',
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.94)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  text: { fontFamily: font.heavy, fontSize: 12.5, color: '#1F2A37', flexShrink: 1 },
})

// Square thumbnail for a moment: its first photo / video poster, otherwise a
// tinted glyph for its kind.
export function EventThumb({ event, size = 54, radius = 14 }: { event: TimelineEvent; size?: number; radius?: number }) {
  const t = useTheme()
  const kind = cardKind(event)
  const box = { width: size, height: size, borderRadius: radius, overflow: 'hidden' as const }
  if (kind === 'photo' || kind === 'video') {
    const m = (event.media || []).filter(isVisual)[0]
    const s = thumbSource(m)
    return (
      <View style={[box, { backgroundColor: t.surface2 }]}>
        {s ? <Image source={s} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={m.key} /> : null}
        {kind === 'video' ? (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Icon name="play.fill" size={size * 0.32} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    )
  }
  const glyph =
    kind === 'audio'
      ? { icon: 'waveform' as const, bg: t.audioSoft, fg: t.audio }
      : kind === 'map'
        ? { icon: 'mappin' as const, bg: t.secondSoft, fg: t.second }
        : kind === 'doc'
          ? { icon: 'doc.text' as const, bg: t.dangerSoft, fg: t.danger }
          : { icon: 'text.alignleft' as const, bg: t.thirdSoft, fg: t.third }
  return (
    <View style={[box, styles.center, { backgroundColor: glyph.bg }]}>
      <Icon name={glyph.icon} size={size * 0.42} color={glyph.fg} />
    </View>
  )
}

// An audio card's player: plays the recording right here, filling the
// waveform as it goes. Its own component so the player hook only exists on
// audio cards.
function AudioLead({ media, s, t }: { media: MediaRef; s: Styles; t: Theme }) {
  const rec = useRecordingPlayer(media.url, media.duration_seconds)
  const shown = fmtDuration(rec.started ? rec.position : rec.duration || media.duration_seconds)
  return (
    <View style={s.player}>
      <Pressable
        style={({ pressed }) => [s.playBtn, rec.playing && { paddingLeft: 0 }, pressed && s.pressed]}
        onPress={() => void rec.toggle()}
        disabled={!media.url}
        accessibilityRole="button"
        accessibilityLabel={rec.playing ? 'Pause recording' : 'Play recording'}
        hitSlop={6}
      >
        {rec.loading ? (
          <ActivityIndicator color={t.dark ? t.bg : '#FFFFFF'} />
        ) : (
          <Icon name={rec.playing ? 'pause.fill' : 'play.fill'} size={21} color={t.dark ? t.bg : '#FFFFFF'} />
        )}
      </Pressable>
      <Waveform seed={seedOf(media.key)} bars={30} progress={rec.progress} on={t.audio} off={t.waveOff} />
      {shown ? <Text style={s.dur}>{shown}</Text> : null}
    </View>
  )
}

export function EventCard({
  event,
  names,
  thread,
  onPress,
}: {
  event: TimelineEvent
  names: string[]
  // Shown when the viewer has more than one thread.
  thread?: { name: string; color?: string } | null
  onPress: () => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const kind = cardKind(event)
  const media = event.media || []
  const visual = media.filter(isVisual)
  const place = placeLabel(event.location)
  const loc = asLoc(event.location)
  const audio = media.find((m) => m.kind === 'audio')
  const pdf = media.find((m) => m.kind === 'pdf')

  let lead: ReactNode = null
  if (kind === 'photo' || kind === 'video') {
    const cover = coverSource(visual[0])
    const d = fmtDuration(visual[0].duration_seconds)
    lead = (
      <View style={s.mat}>
        <View style={s.media}>
          {cover ? (
            <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={event._id} />
          ) : null}
          {kind === 'video' ? (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <View style={s.play}>
                <Icon name="play.fill" size={26} color="#FFFFFF" />
              </View>
            </View>
          ) : null}
          {kind === 'video' ? (
            <MediaBadge icon="video" text={visual.length > 1 ? `${visual.length} items` : d ?? 'Video'} />
          ) : visual.length > 1 ? (
            <MediaBadge icon="photo.on.rectangle" text={kindLabel(event)} />
          ) : null}
        </View>
      </View>
    )
  } else if (kind === 'map' && loc?.lat != null && loc?.lng != null) {
    lead = (
      <View style={s.mat}>
        <View style={[s.media, { height: 140 }]}>
          <MapThumb lat={loc.lat} lng={loc.lng} style={StyleSheet.absoluteFill} />
          {place ? <MediaBadge icon="mappin" text={place} left /> : null}
        </View>
      </View>
    )
  } else if (kind === 'audio' && audio) {
    lead = <AudioLead media={audio} s={s} t={t} />
  } else if (kind === 'doc' && pdf) {
    lead = (
      <View style={[s.player, { backgroundColor: t.dangerSoft }]}>
        <View style={[s.playBtn, { backgroundColor: t.danger }]}>
          <Icon name="doc.text.fill" size={20} color={t.dark ? t.bg : '#FFFFFF'} />
        </View>
        <Text style={[s.docText]} numberOfLines={1}>
          Document{pdf.page_count ? ` · ${pdf.page_count} page${pdf.page_count === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
    )
  } else if (kind === 'note' && event.description) {
    lead = (
      <View style={s.note}>
        <Text style={s.quote}>“</Text>
        <Text style={s.noteText} numberOfLines={5}>
          {event.description}
        </Text>
      </View>
    )
  }

  // Map, audio and document cards keep a short description under the title;
  // photos speak for themselves and a note already shows its words.
  const showDesc = !!event.description && (kind === 'map' || kind === 'audio' || kind === 'doc')

  return (
    <Pressable style={({ pressed }) => [s.card, pressed && s.cardPressed]} onPress={onPress}>
      {lead}
      <View style={s.text}>
        <Text style={s.title} numberOfLines={2}>
          {event.title}
        </Text>
        {showDesc ? (
          <Text style={s.desc} numberOfLines={3}>
            {event.description}
          </Text>
        ) : null}
        <View style={s.meta}>
          {thread ? (
            <>
              <View style={[s.dot, { backgroundColor: paletteColor(thread.color, t.dark) }]} />
              <Text style={s.metaText} numberOfLines={1}>
                {thread.name}
              </Text>
              <Text style={s.metaDim}>·</Text>
            </>
          ) : null}
          <Icon name="calendar" size={13} color={t.secondary} />
          <Text style={s.metaText}>{cardDay(event)}</Text>
          {place && kind !== 'map' ? (
            <>
              <Text style={s.metaDim}>·</Text>
              <Icon name="mappin" size={13} color={t.secondary} />
              <Text style={[s.metaText, { flexShrink: 1 }]} numberOfLines={1}>
                {place}
              </Text>
            </>
          ) : null}
          {event.is_owner === false ? (
            <>
              <Text style={s.metaDim}>·</Text>
              <Text style={s.metaText}>Shared</Text>
            </>
          ) : null}
        </View>
        {names.length ? (
          <View style={s.people}>
            <AvatarStack names={names} size={26} ring={t.card} />
            <Text style={s.metaText} numberOfLines={1}>
              {joinNames(names)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

// One line of a busy month's grouped card, or a search result.
export function CompactRow({
  event,
  onPress,
  title,
  sub,
  first,
}: {
  event: TimelineEvent
  onPress: () => void
  // Optional rich title (search highlights); defaults to the event title.
  title?: ReactNode
  sub?: ReactNode
  first?: boolean
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <Pressable style={({ pressed }) => [s.crow, pressed && s.pressed]} onPress={onPress}>
      {!first ? <View style={s.crowRule} /> : null}
      <EventThumb event={event} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.crowTitle} numberOfLines={2}>
          {title ?? event.title}
        </Text>
        <Text style={s.crowSub} numberOfLines={1}>
          {sub ?? `${cardDay(event)} · ${kindLabel(event)}`}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})

type Styles = ReturnType<typeof makeStyles>

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: { backgroundColor: t.card, borderRadius: 24, ...cardShadow(t) },
    cardPressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
    pressed: { opacity: 0.6 },
    mat: { paddingHorizontal: 9, paddingTop: 9 },
    media: { height: 178, borderRadius: 17, overflow: 'hidden', backgroundColor: t.surface2 },
    play: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: 'rgba(0,0,0,0.28)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 3,
    },
    player: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginHorizontal: 9,
      marginTop: 9,
      padding: 13,
      borderRadius: 18,
      backgroundColor: t.audioSoft,
    },
    playBtn: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: t.audio,
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 3,
    },
    dur: { fontFamily: font.heavy, fontSize: 13.5, color: t.audio, fontVariant: ['tabular-nums'] },
    docText: { flex: 1, fontFamily: font.heavy, fontSize: 15, color: t.danger },
    note: {
      marginHorizontal: 9,
      marginTop: 9,
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 12,
      borderRadius: 18,
      backgroundColor: t.thirdSoft,
    },
    quote: { fontFamily: font.serif, fontSize: 40, lineHeight: 40, height: 26, color: t.third },
    noteText: { fontFamily: font.serifMedium, fontSize: 17, lineHeight: 24, color: t.label },
    text: { paddingHorizontal: 14, paddingTop: 11, paddingBottom: 14 },
    title: { fontFamily: font.serif, fontSize: 19, lineHeight: 23, color: t.label, marginBottom: 5 },
    desc: { fontFamily: font.body, fontSize: 15.5, lineHeight: 22, color: t.body, marginBottom: 8 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'nowrap' },
    metaText: { fontFamily: font.bold, fontSize: 13.5, color: t.secondary },
    metaDim: { fontFamily: font.bold, fontSize: 13.5, color: t.secondary, opacity: 0.5 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    people: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
    crow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
    crowRule: { position: 'absolute', top: 0, left: 78, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: t.separator },
    crowTitle: { fontFamily: font.serif, fontSize: 16.5, lineHeight: 20, color: t.label },
    crowSub: { fontFamily: font.bold, fontSize: 13, color: t.secondary },
  })
}
