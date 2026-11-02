import { useRef, useState } from 'react'
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
import { colors } from '@/theme'

// Mirrors the web ChatView: assistant turns can carry a pending-edit card (the
// edit flow asks "does that look right?" and waits for a confirm_edit action)
// or an event card for something chat just created/updated.
type Msg = ChatMessage & {
  id: string
  pendingEdit?: PendingEdit & { status: 'open' | 'confirmed' | 'cancelled' }
  eventAction?: { type: 'created' | 'updated'; event: TimelineEvent }
}

let idCounter = 0
const nextId = () => `m${++idCounter}`

// Only text turns go back to the API; cards and empty placeholders don't.
function toApiMessages(msgs: Msg[]): ChatMessage[] {
  return msgs.filter((m) => m.content).map(({ role, content }) => ({ role, content }))
}

// Dates store UTC — format in UTC so the day never shifts.
function fmtDate(iso: string): string {
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

  // 'bottom' matters: native tabs float over the screen, and inside a tab the
  // native safe area includes the tab bar, so this keeps the composer above it.
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.h1}>Chat</Text>
        {messages.length > 0 ? (
          <Pressable onPress={() => setMessages([])} hitSlop={8} disabled={streaming}>
            <Text style={[styles.newChat, streaming && { opacity: 0.4 }]}>New chat</Text>
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>What do you want to know?</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.thread}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => (
              <View style={styles.turn}>
                <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.botBubble]}>
                  {item.content === '' && streaming ? (
                    <ActivityIndicator color={colors.inkSoft} />
                  ) : (
                    <Text style={item.role === 'user' ? styles.userText : styles.botText}>{item.content}</Text>
                  )}
                </View>
                {item.pendingEdit ? (
                  <PendingEditCard
                    pendingEdit={item.pendingEdit}
                    disabled={streaming}
                    onConfirm={(eventId, label) => confirmEdit(item.id, eventId, item.pendingEdit!.changes, label)}
                    onCancel={() => cancelEdit(item.id)}
                  />
                ) : null}
                {item.eventAction ? (
                  <Pressable
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                    onPress={() => router.push(`/event/${item.eventAction!.event._id}`)}
                  >
                    <Text style={styles.cardEyebrow}>
                      {item.eventAction.type === 'created' ? 'Added to your timeline' : 'Event updated'}
                    </Text>
                    <Text style={styles.cardTitle}>{item.eventAction.event.title}</Text>
                    <Text style={styles.cardMeta}>{fmtDate(item.eventAction.event.date)} · View ›</Text>
                  </Pressable>
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
            placeholder="Ask about your timeline…"
            placeholderTextColor={colors.inkSoft}
            multiline
            editable={!streaming}
            onSubmitEditing={send}
          />
          <Pressable
            style={[styles.sendBtn, (!input.trim() || streaming) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!input.trim() || streaming}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function PendingEditCard({
  pendingEdit,
  disabled,
  onConfirm,
  onCancel,
}: {
  pendingEdit: NonNullable<Msg['pendingEdit']>
  disabled: boolean
  onConfirm: (eventId: string, label: string) => void
  onCancel: () => void
}) {
  const { target, alternatives, changes, status } = pendingEdit
  const [picking, setPicking] = useState(false)

  if (status === 'cancelled') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardMeta}>Edit cancelled. Try again with more detail about which event you mean.</Text>
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
        <Text style={styles.cardEyebrow}>Pick the event you meant</Text>
        {alternatives.map((alt) => (
          <Pressable
            key={alt._id}
            style={styles.altRow}
            disabled={disabled}
            onPress={() => onConfirm(alt._id, `Use "${alt.title}" instead.`)}
          >
            <Text style={styles.cardTitle}>{alt.title}</Text>
            <Text style={styles.cardMeta}>{fmtDate(alt.date)}</Text>
          </Pressable>
        ))}
        <View style={styles.cardActions}>
          <Pressable style={styles.btn} onPress={() => setPicking(false)} disabled={disabled}>
            <Text style={styles.btnText}>Back</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={onCancel} disabled={disabled}>
            <Text style={styles.btnText}>None of these</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  const rows = (Object.keys(FIELD_LABELS) as (keyof EditChanges)[]).filter((k) => k in changes)
  return (
    <View style={styles.card}>
      <Text style={styles.cardEyebrow}>Pending update</Text>
      <Text style={styles.cardTitle}>{target.title}</Text>
      <Text style={styles.cardMeta}>{fmtDate(target.date)}</Text>
      {rows.map((field) => (
        <Text key={field} style={styles.changeRow}>
          <Text style={styles.cardMeta}>{FIELD_LABELS[field]}: </Text>
          {formatChangeValue(field, changes[field])}
        </Text>
      ))}
      <View style={styles.cardActions}>
        <Pressable
          style={[styles.btn, styles.btnPrimary, disabled && styles.sendBtnDisabled]}
          disabled={disabled}
          onPress={() => onConfirm(target._id, `Yes, update "${target.title}".`)}
        >
          <Text style={[styles.btnText, styles.btnPrimaryText]}>Confirm</Text>
        </Pressable>
        {alternatives.length > 0 ? (
          <Pressable style={styles.btn} disabled={disabled} onPress={() => setPicking(true)}>
            <Text style={styles.btnText}>Choose another</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.btn} disabled={disabled} onPress={onCancel}>
          <Text style={styles.btnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  h1: { fontSize: 28, fontWeight: '700', color: colors.ink },
  newChat: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 22, color: colors.inkSoft, textAlign: 'center', fontStyle: 'italic' },
  thread: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  turn: { gap: 8 },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accent },
  botBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rule },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  botText: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  card: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: 12,
    gap: 4,
  },
  cardPressed: { opacity: 0.6 },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  cardMeta: { fontSize: 13, color: colors.inkSoft },
  changeRow: { fontSize: 14, color: colors.ink, marginTop: 2 },
  altRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.rule },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  btnPrimaryText: { color: '#fff' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    backgroundColor: colors.surface,
  },
  composerInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 20, fontWeight: '700' },
})
