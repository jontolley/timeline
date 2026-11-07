import { useMemo, useRef, useState, type ComponentRef } from 'react'
import { PanResponder, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import * as Haptics from 'expo-haptics'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { font, useTheme, type Theme } from '@/theme'

// The right-edge year scrubber that replaces the old row of year chips (same
// list of years, same jump). Tap a year or drag along the edge: while dragging
// it grows into a glass capsule, a big year "loupe" follows the thumb, and each
// year ticks with a selection haptic. Letting go jumps to that year.

const GLASS = isLiquidGlassAvailable()
// With more years than this, only every n-th label is drawn (all still scrub).
const MAX_LABELS = 20

export default function YearScrubber({
  years,
  active,
  onJump,
  onPrefetch,
  top,
  bottom,
}: {
  years: number[] // newest first
  active: number | null
  onJump: (year: number) => void
  onPrefetch?: (year: number) => void
  top: number
  bottom: number
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const frame = useRef({ y: 0, h: 1 })
  const view = useRef<ComponentRef<typeof View>>(null)
  const lastIndex = useRef<number | null>(null)
  // The responder callbacks are created once; read the latest props via a ref.
  const latest = useRef({ years, onJump, onPrefetch })
  latest.current = { years, onJump, onPrefetch }

  const indexAt = (e: GestureResponderEvent) => {
    const n = latest.current.years.length
    const y = e.nativeEvent.pageY - frame.current.y
    return Math.max(0, Math.min(n - 1, Math.floor((y / frame.current.h) * n)))
  }
  const move = (i: number) => {
    if (i === lastIndex.current) return
    lastIndex.current = i
    setDragIndex(i)
    void Haptics.selectionAsync()
    latest.current.onPrefetch?.(latest.current.years[i])
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the gesture once it starts, so a vertical drag doesn't hand off to
      // the list underneath.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        // Re-measure on each touch: the edge moves when the pinned bar shows.
        view.current?.measureInWindow((_x, y, _w, h) => {
          frame.current = { y, h: h || 1 }
        })
        lastIndex.current = null
        move(indexAt(e))
      },
      onPanResponderMove: (e) => move(indexAt(e)),
      onPanResponderRelease: () => {
        const i = lastIndex.current
        lastIndex.current = null
        setDragIndex(null)
        if (i != null) latest.current.onJump(latest.current.years[i])
      },
      onPanResponderTerminate: () => {
        lastIndex.current = null
        setDragIndex(null)
      },
    }),
  ).current

  const dragging = dragIndex != null
  const shown = dragging ? years[dragIndex] : active
  const step = Math.ceil(years.length / MAX_LABELS)

  const labels = years.map((y, i) => {
    const on = y === shown
    const visible = on || i % step === 0
    return (
      <View key={y} style={s.item}>
        {visible ? (
          <Text style={[s.label, dragging && s.labelWide, on && s.labelOn]}>
            {dragging ? y : `’${String(y).slice(2)}`}
          </Text>
        ) : null}
        <View style={[s.tick, on && s.tickOn]} />
      </View>
    )
  })

  return (
    <>
      <View
        ref={view}
        style={[s.wrap, { top, bottom }, dragging && s.wrapWide]}
        onLayout={() =>
          view.current?.measureInWindow((_x, y, _w, h) => {
            frame.current = { y, h: h || 1 }
          })
        }
        accessibilityRole="adjustable"
        accessibilityLabel="Jump to a year"
        accessibilityValue={{ text: shown != null ? String(shown) : undefined }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const cur = Math.max(0, years.indexOf(active ?? years[0]))
          const next = e.nativeEvent.actionName === 'increment' ? cur - 1 : cur + 1
          if (next >= 0 && next < years.length) onJump(years[next])
        }}
        {...responder.panHandlers}
      >
        {dragging ? (
          GLASS ? (
            <GlassView style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glass, borderRadius: 22 }]} />
          )
        ) : null}
        {labels}
      </View>
      {dragging && shown != null ? (
        <View
          pointerEvents="none"
          style={[
            s.loupe,
            {
              top: top + 10 + ((dragIndex + 0.5) / years.length) * Math.max(0, frame.current.h - 20) - 32,
            },
          ]}
        >
          <Text style={s.loupeText}>{shown}</Text>
          <View style={s.loupeArrow} />
        </View>
      ) : null}
    </>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      right: 2,
      width: 34,
      paddingVertical: 4,
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingRight: 4,
      zIndex: 30,
    },
    wrapWide: { width: 62, borderRadius: 22, overflow: 'hidden', paddingVertical: 10, paddingRight: 10, right: 4 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 10 },
    label: { fontFamily: font.heavy, fontSize: 10.5, color: t.secondary, fontVariant: ['tabular-nums'] },
    labelWide: { fontSize: 12 },
    labelOn: { color: t.tintText },
    tick: { width: 5, height: 2, borderRadius: 1, backgroundColor: t.secondary, opacity: 0.6 },
    tickOn: { width: 9, backgroundColor: t.tintText, opacity: 1 },
    loupe: {
      position: 'absolute',
      right: 80,
      height: 64,
      paddingHorizontal: 20,
      borderRadius: 32,
      backgroundColor: t.label,
      justifyContent: 'center',
      zIndex: 31,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 15,
      shadowOffset: { width: 0, height: 10 },
    },
    loupeText: { fontFamily: font.serif, fontSize: 34, color: t.bg, fontVariant: ['tabular-nums'] },
    loupeArrow: {
      position: 'absolute',
      right: -7,
      top: 24,
      width: 0,
      height: 0,
      borderTopWidth: 8,
      borderBottomWidth: 8,
      borderLeftWidth: 8,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor: t.label,
    },
  })
}
