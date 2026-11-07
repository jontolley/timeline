import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import {
  streamChat,
  type ChatAction,
  type ChatMessage,
  type EditChanges,
  type PendingEdit,
  type SourceItem,
} from '@/api/chat'
import type { TimelineEvent } from '@/api/types'
import { useTimelineSignal } from '@/store/timeline'
import { EventThumb } from '@/components/EventCard'
import Markdown from '@/components/Markdown'
import { Button, EmptyState, GlassButton, Icon, TintButton } from '@/components/ui'
import { cardDay } from '@/lib/format'
import { cardShadow, font, useTheme, type Theme } from '@/theme'

// Mirrors the web ChatView: assistant turns can carry a pending-edit card (the
// edit flow asks "does that look right?" and waits for a confirm_edit action)
// or an event card for something chat just created/updated.
type Msg = ChatMessage & {
  id: string
  pendingEdit?: PendingEdit & { status: 'open' | 'confirmed' | 'cancelled' }
  eventAction?: { type: 'created' | 'updated'; event: TimelineEvent }
  sources?: string[]
  // Linked source cards; empty from an older backend, which only sends titles.
  sourceItems?: SourceItem[]
}

let idCounter = 0
const nextId = () => `m${++idCounter}`

// Starters on the empty screen; tapping one sends it.
const SUGGESTIONS = [
  'What did we do last summer?',
  'What happened this time last year?',
  'When was the last time we went to the beach?',
  'What were the highlights of last year?',
]

// Only text turns go back to the API; cards and empty placeholders don't.
function toApiMessages(msgs: Msg[]): ChatMessage[] {
  return msgs.filter((m) => m.content).map(({ role, content }) => ({ role, content }))
}

// Dates store UTC — format in UTC so the day never shifts.
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const full = iso.includes('T') ? iso : `${iso}T00:00:00Z`
  return new Date(full).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const FIELD_LABELS: Record<keyof EditChanges, string> = {
  title: 'Title',
  date: 'Date',
  end_date: 'End date',
  description: 'Description',
  location: 'Location',
  tags: 'Tags',
  people: 'People',
}

function formatChangeValue(field: keyof EditChanges, value: unknown): string {
  if (value == null) return '—'
  if (field === 'date' || field === 'end_date') return fmtDate(String(value))
  if (field === 'location') {
    if (typeof value === 'string') return value
    const loc = value as { name?: string | null; address?: string | null }
    return loc.name || loc.address || '—'
  }
  if (field === 'people') {
    const n = Array.isArray(value) ? value.length : 0
    return `${n} ${n === 1 ? 'person' : 'people'}`
  }
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function sourceSub(item: SourceItem): string {
  const day = item.date ? `${fmtDate(item.date)}` : ''
  const what =
    item.kind === 'photo'
      ? `${item.media_count} photo${item.media_count === 1 ? '' : 's'}`
      : item.kind === 'video'
        ? 'Video'
        : item.kind === 'audio'
          ? 'Audio'
          : item.kind === 'place'
            ? 'Place'
            : item.kind === 'pdf'
              ? 'Document'
              : 'Note'
  return [day, what].filter(Boolean).join(' · ')
}

export default function ChatScreen() {
  const router = useRouter()
  const requestRefresh = useTimelineSignal((s) => s.requestRefresh)
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const listRef = useRef<FlatList<Msg>>(null)

  function patch(id: string, fn: (m: Msg) => Msg) {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)))
  }

  // Stream one assistant turn for `history` (already on screen), optionally
  // carrying a confirm_edit action.
  async function run(history: Msg[], action: ChatAction | null = null) {
    const assistantId = nextId()
    setMessages([...history, { id: assistantId, role: 'assistant', content: '' }])
    setStreaming(true)
    try {
      await streamChat(
        toApiMessages(history),
        null,
        {
          onSources: (titles, items) =>
            patch(assistantId, (m) => ({
              ...m,
              sources: titles.filter(Boolean).slice(0, 3),
              sourceItems: items.slice(0, 3),
            })),
          onToken: (chunk) => patch(assistantId, (m) => ({ ...m, content: m.content + chunk })),
          onPendingEdit: (data) => patch(assistantId, (m) => ({ ...m, pendingEdit: { ...data, status: 'open' } })),
          onEventCreated: (event) => {
            patch(assistantId, (m) => ({ ...m, eventAction: { type: 'created', event } }))
            requestRefresh()
          },
          onEventUpdated: (event) => {
            patch(assistantId, (m) => ({ ...m, eventAction: { type: 'updated', event } }))
            requestRefresh()
          },
        },
        action,
      )
    } catch (e) {
      patch(assistantId, (m) => ({
        ...m,
        content: e instanceof Error ? `⚠️ ${e.message}` : '⚠️ Something went wrong.',
      }))
    } finally {
      setStreaming(false)
    }
  }

  function send(raw = input) {
    const text = raw.trim()
    if (!text || streaming) return
    setInput('')
    void run([...messages, { id: nextId(), role: 'user', content: text }])
  }

  function confirmEdit(msgId: string, eventId: string, changes: EditChanges, label: string) {
    if (streaming) return
    const history = messages.map((m) =>
      m.id === msgId && m.pendingEdit ? { ...m, pendingEdit: { ...m.pendingEdit, status: 'confirmed' as const } } : m,
    )
    void run([...history, { id: nextId(), role: 'user', content: label }], {
      type: 'confirm_edit',
      event_id: eventId,
      changes,
    })
  }

  function cancelEdit(msgId: string) {
    patch(msgId, (m) => (m.pendingEdit ? { ...m, pendingEdit: { ...m.pendingEdit, status: 'cancelled' } } : m))
  }

  const openEvent = (id: string) => router.push(`/event/${id}`)

  // A moment card in a reply: thumbnail, serif title, date line, chevron.
  const MomentCard = ({
    thumb,
    title,
    sub,
    onPress,
  }: {
    thumb: ReactNode
    title: string
    sub: string
    onPress: () => void
  }) => (
    <Pressable
      style={({ pressed }) => [styles.lcard, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}
    >
      {thumb}
      <View style={styles.lcardBody}>
        <Text style={styles.lcardTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.lcardSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Icon name="chevron.right" size={15} color={t.secondary} weight="bold" />
    </Pressable>
  )

  const sourceThumb = (item: SourceItem) => {
    if (item.thumb_url) {
      return (
        <View style={styles.lthumb}>
          <Image
            source={{ uri: item.thumb_url, cacheKey: `src:${item._id}` }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          {item.kind === 'video' ? (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Icon name="play.fill" size={18} color="#FFFFFF" />
            </View>
          ) : null}
        </View>
      )
    }
    const g =
      item.kind === 'audio'
        ? { icon: 'waveform' as const, bg: t.audioSoft, fg: t.audio }
        : item.kind === 'place'
          ? { icon: 'mappin' as const, bg: t.secondSoft, fg: t.second }
          : item.kind === 'pdf'
            ? { icon: 'doc.text' as const, bg: t.dangerSoft, fg: t.danger }
            : { icon: 'text.alignleft' as const, bg: t.thirdSoft, fg: t.third }
    return (
      <View style={[styles.lthumb, styles.center, { backgroundColor: g.bg }]}>
        <Icon name={g.icon} size={24} color={g.fg} />
      </View>
    )
  }

  const renderTurn = ({ item }: { item: Msg }) => {
    if (item.role === 'user') {
      return (
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{item.content}</Text>
        </View>
      )
    }
    const thinking = item.content === '' && streaming && !item.pendingEdit && !item.eventAction
    const showSources = !item.pendingEdit && !item.eventAction
    const items = showSources ? (item.sourceItems ?? []) : []
    const titles = showSources && !items.length ? (item.sources ?? []) : []
    return (
      <View style={styles.bot}>
        <View style={styles.botAvatar}>
          <Icon name="sparkles" size={17} color={t.second} />
        </View>
        {thinking ? (
          <View style={styles.think}>
            <ThinkingDots color={t.second} />
            <Text style={styles.thinkText}>Looking through your timeline…</Text>
          </View>
        ) : (
          <View style={styles.botBubble}>
            {item.content ? <Markdown text={item.content} style={styles.botText} /> : null}

            {items.length || titles.length ? (
              <>
                <View style={styles.fromRow}>
                  <Icon name="clock.arrow.circlepath" size={13} color={t.secondary} />
                  <Text style={styles.fromText}>FROM YOUR TIMELINE</Text>
                </View>
                {items.length ? (
                  <View style={{ gap: 8 }}>
                    {items.map((src) => (
                      <MomentCard
                        key={src._id}
                        thumb={sourceThumb(src)}
                        title={src.title}
                        sub={sourceSub(src)}
                        onPress={() => openEvent(src._id)}
                      />
                    ))}
                  </View>
                ) : (
                  <View style={styles.pills}>
                    {titles.map((title, i) => (
                      <View key={i} style={styles.pill}>
                        <Text style={styles.pillText} numberOfLines={1}>
                          {title}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : null}

            {item.pendingEdit ? (
              <PendingEditCard
                pendingEdit={item.pendingEdit}
                disabled={streaming}
                styles={styles}
                t={t}
                onConfirm={(eventId, label) => confirmEdit(item.id, eventId, item.pendingEdit!.changes, label)}
                onCancel={() => cancelEdit(item.id)}
              />
            ) : null}

            {item.eventAction ? (
              <>
                <View style={styles.okRow}>
                  <Icon name="checkmark" size={14} color={t.second} weight="bold" />
                  <Text style={styles.okText}>
                    {item.eventAction.type === 'created' ? 'ADDED TO YOUR TIMELINE' : 'MOMENT UPDATED'}
                  </Text>
                </View>
                <MomentCard
                  thumb={<EventThumb event={item.eventAction.event} size={62} radius={14} />}
                  title={item.eventAction.event.title}
                  sub={cardDay(item.eventAction.event)}
                  onPress={() => openEvent(item.eventAction!.event._id)}
                />
              </>
            ) : null}
          </View>
        )}
      </View>
    )
  }

  // 'bottom' matters: native tabs float over the screen, and inside a tab the
  // native safe area includes the tab bar, so this keeps the composer above it.
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.actions}>
          <GlassButton
            icon="square.and.pencil"
            accessibilityLabel="New chat"
            onPress={() => setMessages([])}
            disabled={streaming || messages.length === 0}
          />
        </View>
        <Text style={styles.h1} accessibilityRole="header">
          Chat
        </Text>
        <Text style={styles.sub}>Ask about your memories</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {messages.length === 0 ? (
          // A scroll view (not a plain View) so a tap or a swipe down here puts
          // the keyboard away — it covers the tab bar while it's up.
          <ScrollView
            contentContainerStyle={styles.empty}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            alwaysBounceVertical
          >
            <EmptyState
              icon="sparkles"
              tone="second"
              title="What would you like to remember?"
              text="Ask about your timeline, or tell me about a moment to add."
            />
            <View style={styles.sugg}>
              {SUGGESTIONS.map((q) => (
                <Pressable
                  key={q}
                  style={({ pressed }) => [styles.suggChip, pressed && styles.pressed]}
                  onPress={() => send(q)}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.thread}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            renderItem={renderTurn}
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about your timeline"
            placeholderTextColor={t.secondary}
            multiline
            editable={!streaming}
            onSubmitEditing={() => send()}
          />
          <TintButton
            icon="arrow.up"
            size={40}
            accessibilityLabel="Send"
            onPress={() => send()}
            disabled={!input.trim() || streaming}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// Three dots pulsing in turn while the answer is on its way (static under
// Reduce Motion).
function ThinkingDots({ color }: { color: string }) {
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce)
  }, [])
  useEffect(() => {
    if (reduce) return
    const loop = Animated.loop(
      Animated.stagger(
        160,
        anims.map((a) =>
          Animated.sequence([
            Animated.timing(a, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(a, { toValue: 0.35, duration: 300, useNativeDriver: true }),
          ]),
        ),
      ),
    )
    loop.start()
    return () => loop.stop()
  }, [anims, reduce])
  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: reduce ? 0.35 + i * 0.3 : a }}
        />
      ))}
    </View>
  )
}

function PendingEditCard({
  pendingEdit,
  disabled,
  styles,
  t,
  onConfirm,
  onCancel,
}: {
  pendingEdit: NonNullable<Msg['pendingEdit']>
  disabled: boolean
  styles: Styles
  t: Theme
  onConfirm: (eventId: string, label: string) => void
  onCancel: () => void
}) {
  const { target, alternatives, changes, status } = pendingEdit
  const [picking, setPicking] = useState(false)

  if (status === 'cancelled') {
    return (
      <View style={styles.pend}>
        <Text style={styles.pendMeta}>Edit cancelled. Try again with more detail about which moment you mean.</Text>
      </View>
    )
  }
  if (status === 'confirmed') {
    return (
      <View style={styles.pend}>
        <Text style={styles.pendMeta}>Applying your changes…</Text>
      </View>
    )
  }

  if (picking) {
    return (
      <View style={styles.pend}>
        <Text style={[styles.pendEyebrow, { marginBottom: 4 }]}>WHICH MOMENT DID YOU MEAN?</Text>
        {alternatives.map((alt, i) => (
          <Pressable
            key={alt._id}
            style={({ pressed }) => [styles.altRow, i > 0 && styles.altRule, pressed && styles.pressed]}
            disabled={disabled}
            onPress={() => onConfirm(alt._id, `Use "${alt.title}" instead.`)}
          >
            <EventThumb event={alt} size={44} radius={11} />
            <View style={{ flex: 1 }}>
              <Text style={styles.altTitle} numberOfLines={2}>
                {alt.title}
              </Text>
              <Text style={styles.pendMeta}>{fmtDate(alt.date)}</Text>
            </View>
          </Pressable>
        ))}
        <View style={styles.pendActs}>
          <Button
            label="Back"
            variant="secondary"
            small
            onPress={() => setPicking(false)}
            disabled={disabled}
            style={styles.flex}
          />
          <Button
            label="None of these"
            variant="secondary"
            small
            onPress={onCancel}
            disabled={disabled}
            style={styles.flex}
          />
        </View>
      </View>
    )
  }

  const rows = (Object.keys(FIELD_LABELS) as (keyof EditChanges)[]).filter((k) => k in changes)
  return (
    <View style={styles.pend}>
      <View style={styles.pendHead}>
        <EventThumb event={target} size={48} radius={12} />
        <View style={{ flex: 1 }}>
          <Text style={styles.pendEyebrow}>UPDATE THIS MOMENT?</Text>
          <Text style={styles.altTitle} numberOfLines={2}>
            {target.title}
          </Text>
        </View>
      </View>
      {rows.map((field) => {
        const old = field === 'date' || field === 'end_date' ? (target[field] as string | null | undefined) : null
        return (
          <View key={field} style={styles.chg}>
            <Text style={styles.chgKey}>{FIELD_LABELS[field]}</Text>
            <View style={styles.chgVal}>
              {old ? <Text style={styles.chgOld}>{fmtDate(old)}</Text> : null}
              {old ? <Icon name="chevron.right" size={12} color={t.secondary} weight="bold" /> : null}
              <Text style={styles.chgNew}>{formatChangeValue(field, changes[field])}</Text>
            </View>
          </View>
        )
      })}
      <View style={styles.pendActs}>
        <Button
          label="Update"
          small
          disabled={disabled}
          onPress={() => onConfirm(target._id, `Yes, update "${target.title}".`)}
          style={styles.flex}
        />
        <Button
          label={alternatives.length > 0 ? 'Not this one' : 'Cancel'}
          variant="secondary"
          small
          disabled={disabled}
          onPress={() => (alternatives.length > 0 ? setPicking(true) : onCancel())}
          style={styles.flex}
        />
      </View>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.6 },
    header: { paddingHorizontal: 20, paddingBottom: 8 },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      height: 50,
      marginTop: 4,
      alignItems: 'center',
      marginRight: -2,
    },
    h1: { fontFamily: font.serif, fontSize: 34, lineHeight: 40, color: t.label, letterSpacing: -0.3, marginTop: 4 },
    sub: { fontFamily: font.bold, fontSize: 15, color: t.secondary, marginTop: 2 },
    empty: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
    sugg: { gap: 8, paddingHorizontal: 20, marginTop: 22 },
    suggChip: {
      alignSelf: 'flex-start',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: t.card,
      ...cardShadow(t),
    },
    suggText: { fontFamily: font.bold, fontSize: 15.5, color: t.label },
    thread: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20, gap: 14 },
    userBubble: {
      alignSelf: 'flex-end',
      maxWidth: '80%',
      backgroundColor: t.tint,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderBottomRightRadius: 6,
      borderBottomLeftRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    userText: { color: t.onTint, fontFamily: font.bold, fontSize: 16.5, lineHeight: 23 },
    bot: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    botAvatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: t.secondSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    botBubble: {
      flex: 1,
      minWidth: 0,
      backgroundColor: t.card,
      borderTopLeftRadius: 6,
      borderTopRightRadius: 22,
      borderBottomRightRadius: 22,
      borderBottomLeftRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 14,
      ...cardShadow(t),
    },
    botText: { color: t.label, fontFamily: font.body, fontSize: 16.5, lineHeight: 24 },
    think: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
    thinkText: { fontFamily: font.bold, fontSize: 15, color: t.secondary },
    fromRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 8 },
    fromText: { fontFamily: font.heavy, fontSize: 11.5, letterSpacing: 0.8, color: t.secondary },
    okRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 8 },
    okText: { fontFamily: font.heavy, fontSize: 12, letterSpacing: 0.8, color: t.second },
    lcard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 8,
      paddingRight: 12,
      borderRadius: 18,
      backgroundColor: t.bg,
      borderWidth: 1,
      borderColor: t.separator,
    },
    lthumb: { width: 62, height: 62, borderRadius: 14, overflow: 'hidden', backgroundColor: t.surface2 },
    lcardBody: { flex: 1, minWidth: 0 },
    lcardTitle: { fontFamily: font.serif, fontSize: 16.5, lineHeight: 20, color: t.label },
    lcardSub: { fontFamily: font.bold, fontSize: 13, color: t.secondary, marginTop: 3 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill: {
      maxWidth: '100%',
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 13,
      backgroundColor: t.surface2,
    },
    pillText: { fontFamily: font.bold, fontSize: 13, color: t.secondary },
    pend: {
      marginTop: 12,
      backgroundColor: t.bg,
      borderRadius: 18,
      padding: 12,
      borderWidth: 1,
      borderColor: t.separator,
    },
    pendHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    pendEyebrow: { fontFamily: font.heavy, fontSize: 11.5, letterSpacing: 0.8, color: t.tintText },
    pendMeta: { fontFamily: font.bold, fontSize: 13.5, color: t.secondary },
    altTitle: { fontFamily: font.serif, fontSize: 16.5, lineHeight: 20, color: t.label },
    altRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4 },
    altRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.separator },
    chg: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: t.card,
    },
    chgKey: { fontFamily: font.bold, fontSize: 14.5, color: t.secondary, minWidth: 44 },
    chgVal: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    chgOld: { fontFamily: font.semibold, fontSize: 14.5, color: t.secondary, textDecorationLine: 'line-through' },
    chgNew: { fontFamily: font.bold, fontSize: 14.5, color: t.label, flexShrink: 1 },
    pendActs: { flexDirection: 'row', gap: 8, marginTop: 12 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 8,
      paddingLeft: 20,
      paddingRight: 6,
      paddingVertical: 6,
      minHeight: 54,
      borderRadius: 28,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.separator,
      shadowColor: '#000',
      shadowOpacity: t.dark ? 0.4 : 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    composerInput: {
      flex: 1,
      fontFamily: font.semibold,
      fontSize: 16.5,
      color: t.label,
      maxHeight: 120,
      paddingTop: 10,
      paddingBottom: 10,
    },
  })
}
