import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { listThreads, setSubscriptionVisible } from '@/api/threads'
import type { Thread } from '@/api/types'
import { FillButton, Icon, SectionLabel } from '@/components/ui'
import { SheetHeader, makeSettingsStyles, sharingText } from '@/components/settings'
import { useTimelineSignal } from '@/store/timeline'
import { paletteColor, useTheme } from '@/theme'

// Account → Threads: your threads (tap to edit or share) and the ones other
// people share with you, each with a switch for whether it shows on your
// timeline. Import / export stay on the website.

export default function ThreadsScreen() {
  const router = useRouter()
  const t = useTheme()
  const styles = useMemo(() => makeSettingsStyles(t), [t])
  const requestRefresh = useTimelineSignal((s) => s.requestRefresh)
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reload on every return, so an edit or delete shows straight away.
  useFocusEffect(
    useCallback(() => {
      let live = true
      listThreads()
        .then((list) => {
          if (!live) return
          setThreads(list)
          setError(null)
        })
        .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load your threads."))
      return () => {
        live = false
      }
    }, []),
  )

  const own = (threads ?? []).filter((th) => !th.subscription)
  const shared = (threads ?? []).filter((th) => th.subscription)

  async function toggleVisible(thread: Thread, visible: boolean) {
    const sub = thread.subscription
    if (!sub) return
    const set = (v: boolean) =>
      setThreads((cur) =>
        (cur ?? []).map((th) => (th._id === thread._id ? { ...th, subscription: { ...sub, visible: v } } : th)),
      )
    set(visible)
    try {
      await setSubscriptionVisible(sub._id, visible)
      requestRefresh()
    } catch (e) {
      set(!visible)
      Alert.alert("Couldn't change that", e instanceof Error ? e.message : 'Please try again.')
    }
  }

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title="Threads"
        right={
          <FillButton icon="plus" accessibilityLabel="New thread" onPress={() => router.push('/account/thread/new')} />
        }
      />
      <ScrollView contentContainerStyle={styles.body}>
        {threads === null && !error ? <ActivityIndicator color={t.secondary} style={{ marginTop: 40 }} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {own.length > 0 ? (
          <View>
            <SectionLabel>Your threads</SectionLabel>
            <View style={styles.card}>
              {own.map((th, i) => (
                <View key={th._id}>
                  {i > 0 ? <View style={styles.separator} /> : null}
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={() => router.push({ pathname: '/account/thread/[id]', params: { id: th._id } })}
                    accessibilityRole="button"
                  >
                    <View style={[styles.dot, { backgroundColor: paletteColor(th.color, t.dark) }]} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {th.name}
                      </Text>
                      <Text style={styles.rowSub}>{sharingText(th)}</Text>
                    </View>
                    {th.visibility === 'shared' ? <Icon name="person.2.fill" size={15} color={t.second} /> : null}
                    <Icon name="chevron.right" size={14} color={t.secondary} weight="bold" />
                  </Pressable>
                </View>
              ))}
            </View>
            <Text style={styles.footnote}>
              Every moment belongs to one thread. Share a thread to let people you invite see its moments; they
              can’t change them.
            </Text>
          </View>
        ) : null}

        {shared.length > 0 ? (
          <View>
            <SectionLabel>Shared with you</SectionLabel>
            <View style={styles.card}>
              {shared.map((th, i) => (
                <View key={th._id}>
                  {i > 0 ? <View style={styles.separator} /> : null}
                  {/* The switch sits beside the tappable part, not inside it,
                      so a tap on it never reaches the row. */}
                  <View style={[styles.row, { paddingLeft: 0 }]}>
                    <Pressable
                      style={({ pressed }) => [styles.row, { flex: 1, paddingRight: 0 }, pressed && styles.pressed]}
                      onPress={() => router.push({ pathname: '/account/thread/[id]', params: { id: th._id } })}
                      accessibilityRole="button"
                    >
                      <View style={[styles.dot, { backgroundColor: paletteColor(th.color, t.dark) }]} />
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel} numberOfLines={1}>
                          {th.name}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {th.owner_email ? `From ${th.owner_email}` : 'Shared with you'}
                        </Text>
                      </View>
                    </Pressable>
                    <Switch
                      value={th.subscription?.visible ?? true}
                      onValueChange={(v) => void toggleVisible(th, v)}
                      trackColor={{ true: t.tint }}
                      accessibilityLabel={`Show ${th.name} on your timeline`}
                      style={{ alignSelf: 'center' }}
                    />
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.footnote}>Turn a thread off to hide its moments from your timeline and chat.</Text>
          </View>
        ) : null}

        <Text style={styles.footnote}>Importing and exporting a thread is on the website, under Settings.</Text>
      </ScrollView>
    </View>
  )
}
