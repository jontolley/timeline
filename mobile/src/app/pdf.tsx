import { useMemo, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { WebView } from 'react-native-webview'
import { Button, EmptyState, TintButton } from '@/components/ui'
import { font, useTheme, type Theme } from '@/theme'

// A moment's PDF, shown inside the app (it used to open in the browser).
// WKWebView renders PDFs natively — every page scrolls, pinch zooms — so this
// is just a header with Done over a web view pointed at the signed R2 URL.
export default function PdfViewer() {
  const { url, title } = useLocalSearchParams<{ url?: string; title?: string }>()
  const router = useRouter()
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  // Pad by the window's top inset directly. A SafeAreaView inside this
  // full-screen modal measured a 0 inset on a real iPhone, which put the
  // header — and Done — under the status bar where it couldn't be tapped.
  const insets = useSafeAreaInsets()
  const [failed, setFailed] = useState(false)
  // Bumped by Try again to remount the web view.
  const [attempt, setAttempt] = useState(0)

  return (
    <View style={[s.safe, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ width: 44 }} />
        <Text style={s.title} numberOfLines={1}>
          {title || 'Document'}
        </Text>
        <TintButton icon="checkmark" accessibilityLabel="Done" onPress={() => router.back()} />
      </View>
      {!url || failed ? (
        <EmptyState
          icon="doc.text"
          tone="neutral"
          title="We couldn’t open this document"
          text="Check your connection, then try again."
          style={s.empty}
        >
          {url ? (
            <Button
              label="Try again"
              icon="arrow.clockwise"
              small
              onPress={() => {
                setFailed(false)
                setAttempt((n) => n + 1)
              }}
              style={{ marginTop: 10 }}
            />
          ) : null}
        </EmptyState>
      ) : (
        <WebView
          key={attempt}
          source={{ uri: url }}
          style={s.web}
          startInLoadingState
          renderLoading={() => (
            <View style={s.loading}>
              <ActivityIndicator color={t.secondary} />
            </View>
          )}
          onError={() => setFailed(true)}
          onHttpError={() => setFailed(true)}
          // Stay on the document: a link inside the PDF opens in Safari rather
          // than replacing it here.
          onShouldStartLoadWithRequest={(req) => {
            if (req.url === url || req.url === 'about:blank') return true
            void Linking.openURL(req.url)
            return false
          }}
          allowsBackForwardNavigationGestures={false}
          contentInsetAdjustmentBehavior="automatic"
        />
      )}
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 10,
    },
    title: { flex: 1, textAlign: 'center', fontFamily: font.heavy, fontSize: 17, color: t.label },
    web: { flex: 1, backgroundColor: t.bg },
    loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
    empty: { marginTop: 80, paddingHorizontal: 32 },
  })
}
