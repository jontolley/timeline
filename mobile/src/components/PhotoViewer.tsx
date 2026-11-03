import { useCallback, useRef, useState, type ComponentRef } from 'react'
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Image } from 'expo-image'
import type { MediaRef } from '@/api/types'
import { Icon } from '@/components/ui'

// Full-screen photo viewer, Photos-app style: swipe left/right between items,
// pinch to zoom, double-tap to zoom in/out, single tap to show/hide the chrome.
//
// Each page is a native zoomable ScrollView (UIScrollView maximumZoomScale)
// nested inside a horizontal paging FlatList — Apple's PhotoScroller pattern,
// so a zoomed photo pans to its edge and then hands off to paging, with no
// gesture library needed. Pages are reset to 1× when they scroll off-screen.

const MAX_ZOOM = 4
const DOUBLE_TAP_MS = 250
const DOUBLE_TAP_ZOOM = 2.5
const GESTURE_GRACE_MS = 300

type ZoomRef = ComponentRef<typeof ScrollView> & {
  scrollResponderZoomTo?: (rect: { x: number; y: number; width: number; height: number; animated?: boolean }) => void
}

function fullSource(m: MediaRef): { uri: string; cacheKey: string } | null {
  // Same cache key as the detail hero, so an already-loaded photo opens instantly.
  const isPhoto = (m.kind || 'photo') === 'photo'
  const uri = isPhoto ? m.url || m.thumb_url : m.thumb_url
  return uri ? { uri, cacheKey: m.key } : null
}

function ZoomPage({
  item,
  width,
  height,
  register,
  onSingleTap,
}: {
  item: MediaRef
  width: number
  height: number
  register: (ref: ZoomRef | null) => void
  onSingleTap: () => void
}) {
  const ref = useRef<ZoomRef | null>(null)
  const scale = useRef(1)
  const lastTap = useRef(0)
  // Last time the page zoomed or panned. A pinch's lift-off reaches the
  // Pressable as a tap, so taps right after (or during) a gesture are ignored.
  const lastGesture = useRef(0)
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const src = fullSource(item)
  const isVideo = item.kind === 'video'

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const z = e.nativeEvent.zoomScale ?? 1
    if (Math.abs(z - scale.current) > 0.001) lastGesture.current = Date.now()
    scale.current = z
  }
  const markGesture = () => {
    lastGesture.current = Date.now()
  }

  // Single vs double tap: hold the single tap briefly so a double tap can
  // cancel it. Double tap zooms toward the tapped point, or back out to fit.
  const onPress = (e: GestureResponderEvent) => {
    if (isVideo) {
      if (item.url) void Linking.openURL(item.url)
      return
    }
    const now = Date.now()
    if (now - lastGesture.current < GESTURE_GRACE_MS) return
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      if (singleTimer.current) clearTimeout(singleTimer.current)
      if (scale.current > 1.01) {
        ref.current?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height, animated: true })
      } else {
        const w = width / DOUBLE_TAP_ZOOM
        const h = height / DOUBLE_TAP_ZOOM
        const { locationX, locationY } = e.nativeEvent
        ref.current?.scrollResponderZoomTo?.({ x: locationX - w / 2, y: locationY - h / 2, width: w, height: h, animated: true })
      }
      return
    }
    lastTap.current = now
    singleTimer.current = setTimeout(() => {
      if (lastGesture.current < now) onSingleTap()
    }, DOUBLE_TAP_MS)
  }

  return (
    <ScrollView
      ref={(r) => {
        ref.current = r as ZoomRef | null
        register(ref.current)
      }}
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      maximumZoomScale={isVideo ? 1 : MAX_ZOOM}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={32}
      onScroll={onScroll}
      onScrollBeginDrag={markGesture}
      onScrollEndDrag={markGesture}
    >
      <Pressable onPress={onPress} style={{ width, height }} accessibilityLabel={isVideo ? 'Play video' : 'Photo'}>
        {src ? <Image source={src} style={{ width, height }} contentFit="contain" /> : null}
        {isVideo ? (
          <View style={styles.center}>
            <Icon name="play.circle.fill" size={64} color="rgba(255,255,255,0.92)" />
          </View>
        ) : null}
      </Pressable>
    </ScrollView>
  )
}

export default function PhotoViewer({
  items,
  initialIndex,
  onClose,
}: {
  items: MediaRef[]
  initialIndex: number
  onClose: (lastIndex: number) => void
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(initialIndex)
  const [chrome, setChrome] = useState(true)
  const pages = useRef(new Map<number, ZoomRef>())

  const onPageEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width)
      if (next === index) return
      // Leaving a zoomed photo: put it back to fit for when the user returns.
      pages.current.get(index)?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height, animated: false })
      setIndex(next)
    },
    [index, width, height],
  )

  const close = () => onClose(index)

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} supportedOrientations={['portrait']}>
      <StatusBar hidden={!chrome} style="light" />
      <View style={styles.backdrop}>
        <FlatList
          data={items}
          keyExtractor={(m) => m.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={onPageEnd}
          windowSize={3}
          initialNumToRender={1}
          renderItem={({ item, index: i }) => (
            <ZoomPage
              item={item}
              width={width}
              height={height}
              register={(r) => {
                if (r) pages.current.set(i, r)
                else pages.current.delete(i)
              }}
              onSingleTap={() => setChrome((v) => !v)}
            />
          )}
        />
        {chrome ? (
          <>
            <Pressable
              style={[styles.close, { top: insets.top + 8 }]}
              onPress={close}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Icon name="xmark" size={18} color="#FFFFFF" weight="bold" />
            </Pressable>
            {items.length > 1 ? (
              <View style={[styles.count, { bottom: insets.bottom + 20 }]} pointerEvents="none">
                <Text style={styles.countText}>
                  {index + 1} of {items.length}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    alignSelf: 'center',
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
  },
  countText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
})
