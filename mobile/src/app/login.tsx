import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthStore } from '@/store/auth'
import { Icon } from '@/components/ui'
import { useTheme, type Theme } from '@/theme'

type Step = 'email' | 'code'

export default function LoginScreen() {
  const sendCode = useAuthStore((s) => s.sendCode)
  const verifyCode = useAuthStore((s) => s.verifyCode)
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])

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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.hero}>
          <View style={styles.appIcon}>
            <Icon name="clock" size={58} color="#FFFFFF" weight="regular" />
          </View>
          <Text style={styles.brand}>Hindsite</Text>
          <Text style={styles.tagline}>Look back, on purpose.</Text>
        </View>

        <View style={styles.form}>
          {step === 'email' ? (
            <>
              <View style={styles.field}>
                <Icon name="envelope" size={19} color={t.secondary} weight="regular" />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={t.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  autoFocus
                  editable={!busy}
                  onSubmitEditing={onSendCode}
                  returnKeyType="next"
                  accessibilityLabel="Email"
                />
              </View>
              <Pressable
                style={({ pressed }) => [styles.button, (busy || pressed) && styles.buttonDim]}
                onPress={onSendCode}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color={t.onTint} /> : <Text style={styles.buttonText}>Continue</Text>}
              </Pressable>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Text style={styles.footnote}>
                We’ll email you a 6-digit code. No password needed.{'\n'}
                <Text style={styles.footLink} onPress={() => void Linking.openURL('https://hindsite.app/privacy')}>
                  Privacy Policy
                </Text>
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Enter the code we sent to{'\n'}
                <Text style={styles.hintStrong}>{email}</Text>
              </Text>
              <View style={styles.field}>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                  placeholderTextColor={t.placeholder}
                  keyboardType="number-pad"
                  // Lets iOS offer the emailed code from Mail above the keyboard.
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  autoFocus
                  editable={!busy}
                  maxLength={6}
                  onSubmitEditing={onVerify}
                  returnKeyType="go"
                  accessibilityLabel="Code"
                />
              </View>
              <Pressable
                style={({ pressed }) => [styles.button, (busy || pressed) && styles.buttonDim]}
                onPress={onVerify}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color={t.onTint} /> : <Text style={styles.buttonText}>Sign In</Text>}
              </Pressable>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                onPress={() => {
                  setStep('email')
                  setCode('')
                  setError(null)
                }}
                disabled={busy}
                hitSlop={8}
              >
                <Text style={styles.link}>Use a Different Email</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 },
    appIcon: {
      width: 104,
      height: 104,
      borderRadius: 24,
      backgroundColor: t.tint,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: t.tint,
      shadowOpacity: 0.3,
      shadowRadius: 15,
      shadowOffset: { width: 0, height: 10 },
    },
    brand: { fontSize: 34, lineHeight: 41, fontWeight: '700', color: t.label, marginTop: 6 },
    tagline: { fontSize: 17, lineHeight: 22, color: t.secondary, textAlign: 'center' },
    form: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
    field: {
      height: 54,
      borderRadius: 16,
      backgroundColor: t.card,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      gap: 10,
    },
    input: { flex: 1, fontSize: 17, color: t.label, height: '100%' },
    codeInput: { letterSpacing: 8, textAlign: 'center', fontSize: 22, fontVariant: ['tabular-nums'] },
    button: { height: 54, borderRadius: 27, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
    buttonDim: { opacity: 0.7 },
    buttonText: { color: t.onTint, fontSize: 17, fontWeight: '600' },
    footnote: { fontSize: 13, lineHeight: 18, color: t.secondary, textAlign: 'center', marginTop: 4 },
    footLink: { color: t.tintText, fontWeight: '500' },
    link: { color: t.tintText, textAlign: 'center', fontSize: 15, fontWeight: '500', marginTop: 4 },
    hint: { fontSize: 15, lineHeight: 21, color: t.secondary, textAlign: 'center', marginBottom: 4 },
    hintStrong: { color: t.label, fontWeight: '600' },
    error: { color: t.danger, textAlign: 'center', fontSize: 15 },
  })
}
