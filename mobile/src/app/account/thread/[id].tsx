import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  createThread,
  deleteThread,
  inviteToThread,
  listSubscribers,
  listThreads,
  revokeSubscriber,
  setSubscriptionVisible,
  unsubscribeFromThread,
  updateThread,
} from '@/api/threads'
import type { Subscriber, Thread } from '@/api/types'
import { Avatar, Button, Icon, RowIcon, SectionLabel, TintButton } from '@/components/ui'
import { ColorSwatches, PALETTE_KEYS, SheetHeader, makeSettingsStyles, useAutosave } from '@/components/settings'
import { useTimelineSignal } from '@/store/timeline'
import { font, paletteColor, useTheme } from '@/theme'

// One thread. Yours: name, colour and who can see it save as you go (like
// iOS Settings), and a shared thread lists the people it's shared with, with
// an invite box. One shared with you: show it on your timeline or stop seeing
// it. `new` creates a thread; a shared one then opens here so you can invite.

type Visibility = Thread['visibility']

const VISIBILITY: { value: Visibility; icon: 'lock.fill' | 'person.2.fill'; label: string; text: string }[] = [
  { value: 'private', icon: 'lock.fill', label: 'Only you', text: 'Nobody else sees these moments.' },
  { value: 'shared', icon: 'person.2.fill', label: 'Shared', text: 'People you invite can see these moments.' },
]

function message(e: unknown, fallback: string): string {
  const text = e instanceof Error ? e.message : ''
  const moments = text.match(/^(\d+) event\(s\) still belong/)
  if (moments) {
    const n = Number(moments[1])
    return `This thread still has ${n === 1 ? '1 moment' : `${n} moments`}. Move ${n === 1 ? 'it' : 'them'} to another thread first: open the moment, tap Edit and change its Thread.`
  }
  if (/not a valid email/.test(text)) return 'That doesn’t look like an email address.'
  if (/isn't a registered user/.test(text)) {
    return 'That email isn’t signed up for Hindsite yet. An admin can add them under Settings → Users on the website.'
  }
  return text || fallback
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const isNew = id === 'new'
  const router = useRouter()
  const t = useTheme()
  const styles = useMemo(() => makeSettingsStyles(t), [t])
  const requestRefresh = useTimelineSignal((s) => s.requestRefresh)

  const [thread, setThread] = useState<Thread | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loaded, setLoaded] = useState(isNew)

  const owned = isNew || (thread != null && !thread.subscription)

  useEffect(() => {
    let live = true
    listThreads()
      .then((list) => {
        if (!live) return
        if (isNew) {
          // A colour none of your threads uses yet, when there is one.
          const used = new Set(list.filter((th) => !th.subscription).map((th) => th.color))
          setColor(PALETTE_KEYS.find((k) => !used.has(k)) ?? 'blue')
          return
        }
        const found = list.find((th) => th._id === id)
        if (!found) {
          setLoadError('This thread is gone.')
          return
        }
        setThread(found)
        setName(found.name)
        setColor(found.color || 'blue')
        setVisibility(found.visibility)
        setLoaded(true)
      })
      .catch((e) => live && setLoadError(message(e, "Couldn't load this thread.")))
    return () => {
      live = false
    }
  }, [id, isNew])

  const loadSubscribers = useCallback(() => {
    if (isNew || !thread || thread.subscription || thread.visibility !== 'shared') return
    listSubscribers(thread._id)
      .then(setSubscribers)
      .catch(() => {})
  }, [isNew, thread])
  useEffect(loadSubscribers, [loadSubscribers])

  // Saves for an existing thread you own. Failures put the field back.
  async function save(patch: Partial<Thread>, undo: () => void): Promise<boolean> {
    if (!thread) return false
    try {
      const updated = await updateThread(thread._id, patch)
      setThread((cur) => (cur ? { ...cur, ...updated, subscriber_count: cur.subscriber_count } : cur))
      requestRefresh()
      return true
    } catch (e) {
      undo()
      Alert.alert("Couldn't save that", message(e, 'Please try again.'))
      return false
    }
  }

  useAutosave(name, (value) => {
    const trimmed = value.trim()
    if (isNew || !thread || !owned || !loaded || !trimmed || trimmed === thread.name) return
    void save({ name: trimmed }, () => setName(thread.name))
  })

  function pickColor(key: string) {
    const before = color
    setColor(key)
    if (!isNew && thread) void save({ color: key }, () => setColor(before))
  }

  function pickVisibility(value: Visibility) {
    if (value === visibility) return
    if (isNew || !thread) {
      setVisibility(value)
      return
    }
    const apply = () => {
      const before = visibility
      setVisibility(value)
      void save({ visibility: value }, () => setVisibility(before)).then((ok) => {
        if (ok && value === 'private') {
          setSubscribers([])
          setThread((cur) => (cur ? { ...cur, visibility: 'private', subscriber_count: 0 } : cur))
        }
      })
    }
    const n = subscribers.length
    if (value === 'private' && n > 0) {
      Alert.alert(
        'Make this thread private?',
        `${n === 1 ? '1 person' : `${n} people`} will stop seeing its moments. You can share it again later, but you'll need to invite them again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Make Private', style: 'destructive', onPress: apply },
        ],
      )
    } else {
      apply()
    }
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const created = await createThread({ name: trimmed, color, visibility })
      requestRefresh()
      // A shared thread opens straight away so you can invite people to it.
      if (visibility === 'shared') router.replace({ pathname: '/account/thread/[id]', params: { id: created._id } })
      else router.back()
    } catch (e) {
      Alert.alert("Couldn't create the thread", message(e, 'Please try again.'))
      setCreating(false)
    }
  }

  async function invite() {
    const address = email.trim().toLowerCase()
    if (!thread || !address || inviting) return
    setInviting(true)
    setInviteError(null)
    try {
      await inviteToThread(thread._id, address)
      setEmail('')
      setThread((cur) => (cur ? { ...cur, subscriber_count: (cur.subscriber_count ?? 0) + 1 } : cur))
      loadSubscribers()
    } catch (e) {
      setInviteError(message(e, "Couldn't share with that email."))
    } finally {
      setInviting(false)
    }
  }

  function remove(sub: Subscriber) {
    if (!thread) return
    Alert.alert(`Stop sharing with ${sub.subscriber_email}?`, 'They’ll no longer see this thread’s moments.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await revokeSubscriber(thread._id, sub.subscriber_user_id)
            setSubscribers((cur) => cur.filter((s) => s._id !== sub._id))
            setThread((cur) => (cur ? { ...cur, subscriber_count: Math.max(0, (cur.subscriber_count ?? 1) - 1) } : cur))
          } catch (e) {
            Alert.alert("Couldn't remove them", message(e, 'Please try again.'))
          }
        },
      },
    ])
  }

  function confirmDelete() {
    if (!thread) return
    Alert.alert(`Delete “${thread.name}”?`, 'Only a thread with no moments in it can be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteThread(thread._id)
            requestRefresh()
            router.back()
          } catch (e) {
            Alert.alert("Couldn't delete the thread", message(e, 'Please try again.'))
          }
        },
      },
    ])
  }

  async function toggleVisible(visible: boolean) {
    const sub = thread?.subscription
    if (!thread || !sub) return
    setThread({ ...thread, subscription: { ...sub, visible } })
    try {
      await setSubscriptionVisible(sub._id, visible)
      requestRefresh()
    } catch (e) {
      setThread({ ...thread, subscription: sub })
      Alert.alert("Couldn't change that", message(e, 'Please try again.'))
    }
  }

  function confirmLeave() {
    const sub = thread?.subscription
    if (!thread || !sub) return
    Alert.alert(
      `Stop seeing “${thread.name}”?`,
      `Its moments leave your timeline. ${thread.owner_email ?? 'The owner'} can share it with you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop Seeing',
          style: 'destructive',
          onPress: async () => {
            try {
              await unsubscribeFromThread(sub._id)
              requestRefresh()
              router.back()
            } catch (e) {
              Alert.alert("Couldn't do that", message(e, 'Please try again.'))
            }
          },
        },
      ],
    )
  }

  if (loadError || (!isNew && !thread)) {
    return (
      <View style={styles.sheet}>
        <SheetHeader title="Thread" />
        <View style={styles.body}>
          {loadError ? <Text style={styles.error}>{loadError}</Text> : <ActivityIndicator color={t.secondary} />}
        </View>
      </View>
    )
  }

  // A thread someone else shares with you: read-only, plus your two choices.
  if (thread && thread.subscription) {
    return (
      <View style={styles.sheet}>
        <SheetHeader title="Shared thread" />
        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.card, styles.row]}>
            <View style={[styles.dot, { backgroundColor: paletteColor(thread.color, t.dark) }]} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{thread.name}</Text>
              <Text style={styles.rowSub}>
                {thread.owner_email ? `Shared with you by ${thread.owner_email}` : 'Shared with you'}
              </Text>
            </View>
          </View>
          <View>
            <View style={[styles.card, styles.row]}>
              <RowIcon icon="eye.fill" tone="second" />
              <Text style={[styles.rowLabel, { flex: 1 }]}>Show on my timeline</Text>
              <Switch
                value={thread.subscription.visible}
                onValueChange={(v) => void toggleVisible(v)}
                trackColor={{ true: t.tint }}
                accessibilityLabel="Show on my timeline"
                style={{ alignSelf: 'center' }}
              />
            </View>
            <Text style={styles.footnote}>
              Off hides its moments from your timeline and chat without leaving the thread. You can see these
              moments but not change them.
            </Text>
          </View>
          <Pressable style={({ pressed }) => [styles.card, styles.danger, pressed && styles.pressed]} onPress={confirmLeave}>
            <Text style={styles.dangerText}>Stop seeing this thread</Text>
          </Pressable>
        </ScrollView>
      </View>
    )
  }

  const savedShared = thread?.visibility === 'shared'

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={isNew ? 'New thread' : 'Thread'}
        right={
          isNew ? (
            <TintButton
              icon="checkmark"
              accessibilityLabel="Create thread"
              disabled={!name.trim() || creating}
              onPress={() => void create()}
            />
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View>
          <SectionLabel>Name</SectionLabel>
          <View style={styles.card}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Family, Work, Travel…"
              placeholderTextColor={t.placeholder}
              style={styles.input}
              autoFocus={isNew}
              returnKeyType="done"
              maxLength={60}
              onSubmitEditing={isNew ? () => void create() : undefined}
            />
          </View>
        </View>

        <View>
          <SectionLabel>Colour</SectionLabel>
          <View style={styles.card}>
            <ColorSwatches value={color} onChange={pickColor} />
          </View>
        </View>

        <View>
          <SectionLabel>Who can see it</SectionLabel>
          <View style={styles.card} accessibilityRole="radiogroup">
            {VISIBILITY.map((v, i) => {
              const on = visibility === v.value
              return (
                <View key={v.value}>
                  {i > 0 ? <View style={styles.separator} /> : null}
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={() => pickVisibility(v.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                  >
                    <RowIcon icon={v.icon} tone={v.value === 'shared' ? 'second' : 'neutral'} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowLabel}>{v.label}</Text>
                      <Text style={styles.rowSub}>{v.text}</Text>
                    </View>
                    {on ? <Icon name="checkmark" size={17} color={t.tintText} weight="bold" /> : null}
                  </Pressable>
                </View>
              )
            })}
          </View>
          {isNew && visibility === 'shared' ? (
            <Text style={styles.footnote}>You can invite people once the thread is created.</Text>
          ) : null}
        </View>

        {savedShared ? (
          <View>
            <SectionLabel>Shared with</SectionLabel>
            <View style={styles.card}>
              {subscribers.map((sub, i) => (
                <View key={sub._id}>
                  {i > 0 ? <View style={styles.separator} /> : null}
                  <View style={styles.row}>
                    <Avatar name={sub.subscriber_email} color={t.second} size={34} />
                    <Text style={[styles.rowLabel, { flex: 1, fontFamily: font.bold }]} numberOfLines={1}>
                      {sub.subscriber_email}
                    </Text>
                    <Pressable
                      onPress={() => remove(sub)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Stop sharing with ${sub.subscriber_email}`}
                      style={({ pressed }) => pressed && styles.pressed}
                    >
                      <Icon name="minus.circle.fill" size={22} color={t.danger} weight="regular" />
                    </Pressable>
                  </View>
                </View>
              ))}
              {subscribers.length > 0 ? <View style={styles.separator} /> : null}
              <View style={[styles.row, { paddingRight: 10 }]}>
                <TextInput
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v)
                    setInviteError(null)
                  }}
                  placeholder="Their email"
                  placeholderTextColor={t.placeholder}
                  style={[styles.input, { flex: 1, paddingHorizontal: 0 }]}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  returnKeyType="send"
                  onSubmitEditing={() => void invite()}
                />
                <Button label="Invite" small onPress={() => void invite()} disabled={!email.trim()} loading={inviting} />
              </View>
            </View>
            {inviteError ? <Text style={[styles.error, { marginTop: 8 }]}>{inviteError}</Text> : null}
            <Text style={styles.footnote}>
              They need a Hindsite account. They’ll see this thread’s moments on their timeline and can’t change
              them.
            </Text>
          </View>
        ) : null}

        {!isNew ? (
          <Pressable
            style={({ pressed }) => [styles.card, styles.danger, pressed && styles.pressed]}
            onPress={confirmDelete}
          >
            <Text style={styles.dangerText}>Delete thread</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}
