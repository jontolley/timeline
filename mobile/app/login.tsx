import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthStore } from '../src/store/auth'
import { colors } from '../src/theme'

type Step = 'email' | 'code'

export default function LoginScreen() {
  const sendCode = useAuthStore((s) => s.sendCode)
  const verifyCode = useAuthStore((s) => s.verifyCode)

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSendCode() {
    setError(null)
    if (!email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    try {
      await sendCode(email)
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function onVerify() {
    setError(null)
    if (code.trim().length < 4) {
      setError('Enter the code from your email.')
      return
    }
    setBusy(true)
    try {
      // On success the auth store flips to 'authed' and the _layout guard
      // redirects into the tabs — no manual navigation needed here.
      await verifyCode(email, code)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Text style={styles.brand}>Hindsite</Text>
          <Text style={styles.tagline}>Look back, on purpose.</Text>
        </View>

        {step === 'email' ? (
          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoFocus
              editable={!busy}
              onSubmitEditing={onSendCode}
              returnKeyType="next"
            />
            <Pressable
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={onSendCode}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Send me a code</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.hint}>
              We emailed a 6-digit code to{'\n'}
              <Text style={styles.hintStrong}>{email}</Text>
            </Text>
            <Text style={styles.label}>Code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.inkSoft}
              keyboardType="number-pad"
              autoFocus
              editable={!busy}
              maxLength={6}
              onSubmitEditing={onVerify}
              returnKeyType="go"
            />
            <Pressable
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={onVerify}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
              disabled={busy}
            >
              <Text style={styles.linkText}>Use a different email</Text>
            </Pressable>
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  brand: { fontSize: 40, fontWeight: '600', color: colors.ink, letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: colors.inkSoft, marginTop: 6, fontStyle: 'italic' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: 12,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontSize: 22 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { color: colors.accent, textAlign: 'center', marginTop: 4, fontSize: 14 },
  hint: { fontSize: 14, color: colors.inkSoft, textAlign: 'center', lineHeight: 20 },
  hintStrong: { color: colors.ink, fontWeight: '600' },
  error: { color: colors.danger, textAlign: 'center', marginTop: 16, fontSize: 14 },
})
