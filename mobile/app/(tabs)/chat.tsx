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
import { streamChat, type ChatMessage } from '../../src/api/chat'
import { colors } from '../../src/theme'

type Msg = ChatMessage & { id: string }

let idCounter = 0
const nextId = () => `m${++idCounter}`

export default function ChatScreen() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const listRef = useRef<FlatList<Msg>>(null)

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')

    const userMsg: Msg = { id: nextId(), role: 'user', content: text }
    const assistantId = nextId()
    const assistantMsg: Msg = { id: assistantId, role: 'assistant', content: '' }
    const history = [...messages, userMsg]
    setMessages([...history, assistantMsg])
    setStreaming(true)

    try {
      await streamChat(
        history.map(({ role, content }) => ({ role, content })),
        null,
        {
          onToken: (chunk) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
            )
          },
          onDone: () => setStreaming(false),
        },
      )
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: e instanceof Error ? `⚠️ ${e.message}` : '⚠️ Something went wrong.' }
            : m,
        ),
      )
      setStreaming(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
              <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.botBubble]}>
                {item.content === '' && streaming ? (
                  <ActivityIndicator color={colors.inkSoft} />
                ) : (
                  <Text style={item.role === 'user' ? styles.userText : styles.botText}>
                    {item.content}
                  </Text>
                )}
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
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accent },
  botBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rule },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  botText: { color: colors.ink, fontSize: 15, lineHeight: 21 },
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
