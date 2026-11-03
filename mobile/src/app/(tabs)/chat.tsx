import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
} from '@/api/chat'
import type { TimelineEvent } from '@/api/types'
import { useTimelineSignal } from '@/store/timeline'
import Markdown from '@/components/Markdown'
import { GlassButton, Icon, TintButton } from '@/components/ui'
import { useTheme, type Theme } from '@/theme'

// Mirrors the web ChatView: assistant turns can carry a pending-edit card (the
// edit flow asks "does that look right?" and waits for a confirm_edit action)
// or an event card for something chat just created/updated.
type Msg = ChatMessage & {
  id: string
  pendingEdit?: PendingEdit & { status: 'open' | 'confirmed' | 'cancelled' }
  eventAction?: { type: 'created' | 'updated'; event: TimelineEvent }
  sources?: string[]
}

let idCounter = 0
const nextId = () => `m${++idCounter}`

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
      await streamChat(toApiMessages(history), null, {
        onSources: (titles) => patch(assistantId, (m) => ({ ...m, sources: titles.filter(Boolean).slice(0, 3) })),
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
      })
    } catch (e) {
      patch(assistantId, (m) => ({
        ...m,
        content: e instanceof Error ? `⚠️ ${e.message}` : '⚠️ Something went wrong.',
      }))
    } finally {
      setStreaming(false)
    }
  }

  function send() {
    const text = input.trim()
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


  const thumbOf = (ev: TimelineEvent) => {
    const m = ev.media?.find((x) => x.thumb_url)
    return m?.thumb_url ? { uri: m.thumb_url, cacheKey: `${m.key}:thumb` } : null
  }

  const EventChip = ({ ev, eyebrow }: { ev: TimelineEvent; eyebrow?: string }) => {
    const thumb = thumbOf(ev)
    return (
      <Pressable
        style={({ pressed }) => [styles.source, pressed && styles.pressed]}
        onPress={() => router.push(`/event/${ev._id}`)}
      >
        {thumb ? <Image source={thumb} style={styles.sourceThumb} contentFit="cover" /> : (
          <View style={[styles.sourceThumb, styles.sourceThumbEmpty]}>
            <Icon name="text.alignleft" size={18} color={t.secondary} />
          </View>
        )}
        <View style={styles.sourceBody}>
          {eyebrow ? <Text style={styles.sourceEyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.sourceTitle} numberOfLines={1}>
            {ev.title}
          </Text>
          <Text style={styles.sourceMeta}>{fmtDate(ev.date)}</Text>
        </View>
      </Pressable>
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
        <Text style={styles.h1}>Chat</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="sparkles" size={34} color={t.secondary} weight="regular" />
            <Text style={styles.emptyTitle}>What do you want to know?</Text>
            <Text style={styles.emptyText}>Ask about your timeline, or tell me about a moment to add.</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.thread}
            keyboardDismissMode="interactive"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => (
              <View style={styles.turn}>
                {item.role === 'user' ? (
                  <View style={styles.userBubble}>
                    <Text style={styles.userText}>{item.content}</Text>
                  </View>
                ) : item.content === '' && streaming ? (
                  <ActivityIndicator color={t.secondary} style={styles.typing} />
                ) : item.content ? (
                  <Markdown text={item.content} style={styles.botText} containerStyle={styles.bot} />
                ) : null}
                {item.sources && item.sources.length > 0 && !item.pendingEdit && !item.eventAction ? (
                  <View style={styles.sources}>
                    {item.sources.map((title, i) => (
                      <View key={i} style={styles.sourcePill}>
                        <Icon name="doc.text" size={12} color={t.secondary} />
                        <Text style={styles.sourcePillText} numberOfLines={1}>
                          {title}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {item.pendingEdit ? (
                  <PendingEditCard
                    pendingEdit={item.pendingEdit}
                    disabled={streaming}
                    styles={styles}
                    onConfirm={(eventId, label) => confirmEdit(item.id, eventId, item.pendingEdit!.changes, label)}
                    onCancel={() => cancelEdit(item.id)}
                  />
                ) : null}
                {item.eventAction ? (
                  <EventChip
                    ev={item.eventAction.event}
                    eyebrow={item.eventAction.type === 'created' ? 'Added to your timeline' : 'Moment updated'}
                  />
                ) : null}
              </View>
            )}
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about your timeline"
            placeholderTextColor={t.placeholder}
            multiline
            editable={!streaming}
            onSubmitEditing={send}
          />
          <TintButton
            icon="arrow.up"
            size={36}
            accessibilityLabel="Send"
            onPress={send}
            disabled={!input.trim() || streaming}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function PendingEditCard({
  pendingEdit,
  disabled,
  styles,
  onConfirm,
  onCancel,
}: {
  pendingEdit: NonNullable<Msg['pendingEdit']>
  disabled: boolean
  styles: Styles
  onConfirm: (eventId: string, label: string) => void
  onCancel: () => void
}) {
  const { target, alternatives, changes, status } = pendingEdit
  const [picking, setPicking] = useState(false)

  if (status === 'cancelled') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardMeta}>Edit cancelled. Try again with more detail about which moment you mean.</Text>
      </View>
    )
  }
  if (status === 'confirmed') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardMeta}>Applying your changes…</Text>
      </View>
    )
  }

  if (picking) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardEyebrow}>Which moment did you mean?</Text>
        {alternatives.map((alt) => (
          <Pressable
            key={alt._id}
            style={({ pressed }) => [styles.altRow, pressed && styles.pressed]}
            disabled={disabled}
            onPress={() => onConfirm(alt._id, `Use "${alt.title}" instead.`)}
          >
            <Text style={styles.cardTitle}>{alt.title}</Text>
            <Text style={styles.cardMeta}>{fmtDate(alt.date)}</Text>
          </Pressable>
        ))}
        <View style={styles.cardActions}>
          <Pressable style={[styles.btn, styles.btnFill]} onPress={() => setPicking(false)} disabled={disabled}>
            <Text style={styles.btnText}>Back</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnFill]} onPress={onCancel} disabled={disabled}>
            <Text style={styles.btnText}>None of These</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  const rows = (Object.keys(FIELD_LABELS) as (keyof EditChanges)[]).filter((k) => k in changes)
  return (
    <View style={styles.card}>
      <View style={{ gap: 2 }}>
        <Text style={styles.cardEyebrow}>Update this moment?</Text>
        <Text style={styles.cardTitle}>{target.title}</Text>
      </View>
      {rows.map((field) => {
        const old = field === 'date' || field === 'end_date' ? (target[field] as string | null | undefined) : null
        return (
          <View key={field} style={styles.changeRow}>
            <Text style={styles.changeLabel}>{FIELD_LABELS[field]}</Text>
            {old ? <Text style={styles.changeOld}>{fmtDate(old)}</Text> : null}
            {old ? <Text style={styles.changeLabel}>→</Text> : null}
            <Text style={styles.changeNew}>{formatChangeValue(field, changes[field])}</Text>
          </View>
        )
      })}
      <View style={styles.cardActions}>
        <Pressable
          style={[styles.btn, styles.btnPrimary, disabled && styles.disabled]}
          disabled={disabled}
          onPress={() => onConfirm(target._id, `Yes, update "${target.title}".`)}
        >
          <Text style={[styles.btnText, styles.btnPrimaryText]}>Update</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnFill]}
          disabled={disabled}
          onPress={() => (alternatives.length > 0 ? setPicking(true) : onCancel())}
        >
          <Text style={styles.btnText}>{alternatives.length > 0 ? 'Not This One' : 'Cancel'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    header: { paddingHorizontal: 16, paddingBottom: 6 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', height: 44, marginTop: 4 },
    h1: { fontSize: 34, lineHeight: 41, fontWeight: '700', color: t.label, marginTop: 4, letterSpacing: 0.2 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyTitle: { fontSize: 22, fontWeight: '600', color: t.label, textAlign: 'center' },
    emptyText: { fontSize: 15, lineHeight: 20, color: t.secondary, textAlign: 'center' },
    thread: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, gap: 14 },
    turn: { gap: 10 },
    userBubble: {
      alignSelf: 'flex-end',
      maxWidth: '78%',
      backgroundColor: t.tint,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    userText: { color: t.onTint, fontSize: 17, lineHeight: 22 },
    bot: { paddingRight: 12 },
    botText: { color: t.label, fontSize: 17, lineHeight: 24 },
    typing: { alignSelf: 'flex-start', marginVertical: 6 },
    sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    sourcePill: {
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: t.fill,
    },
    sourcePillText: { flexShrink: 1, fontSize: 13, color: t.secondary },
    source: {
      width: 220,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 8,
      borderRadius: 16,
      backgroundColor: t.card,
      alignSelf: 'flex-start',
    },
    sourceThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: t.photoPlaceholder },
    sourceThumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.fill },
    sourceBody: { flex: 1 },
    sourceEyebrow: { fontSize: 12, fontWeight: '600', color: t.tintText },
    sourceTitle: { fontSize: 15, fontWeight: '600', color: t.label },
    sourceMeta: { fontSize: 13, color: t.secondary },
    pressed: { opacity: 0.6 },
    disabled: { opacity: 0.4 },
    card: { backgroundColor: t.card, borderRadius: 22, padding: 16, gap: 12, marginRight: 12 },
    cardEyebrow: { fontSize: 13, fontWeight: '600', color: t.secondary },
    cardTitle: { fontSize: 17, fontWeight: '600', color: t.label },
    cardMeta: { fontSize: 15, color: t.secondary },
    changeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    changeLabel: { fontSize: 15, color: t.secondary, minWidth: 40 },
    changeOld: { fontSize: 15, color: t.secondary, textDecorationLine: 'line-through' },
    changeNew: { fontSize: 15, fontWeight: '600', color: t.label, flexShrink: 1 },
    altRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.separator },
    cardActions: { flexDirection: 'row', gap: 8 },
    btn: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    btnFill: { backgroundColor: t.fill },
    btnPrimary: { backgroundColor: t.tint },
    btnText: { fontSize: 17, fontWeight: '500', color: t.label },
    btnPrimaryText: { color: t.onTint, fontWeight: '600' },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      marginHorizontal: 12,
      marginBottom: 8,
      paddingLeft: 18,
      paddingRight: 6,
      paddingVertical: 6,
      minHeight: 50,
      borderRadius: 25,
      backgroundColor: t.card,
      shadowColor: '#000',
      shadowOpacity: t.dark ? 0.4 : 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    composerInput: {
      flex: 1,
      fontSize: 17,
      color: t.label,
      maxHeight: 120,
      paddingTop: 8,
      paddingBottom: 8,
    },
  })
}
