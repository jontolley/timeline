import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
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
import { cardShadow, font, useTheme, type Theme } from '@/theme'

type Step = 'email' | 'code'

export default function LoginScreen() {
  const sendCode = useAuthStore((s) => s.sendCode)
  const verifyCode = useAuthStore((s) => s.verifyCode)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
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

  async function onGoogle() {
    setError(null)
    setGoogleBusy(true)
    try {
      // Success flips the auth store to 'authed' and the _layout guard takes
      // over; backing out of the browser sheet just leaves us here.
      await signInWithGoogle()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setGoogleBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.hero}>
          <View style={styles.appIcon}>
            <Icon name="clock" size={52} color="#FFFFFF" weight="regular" />
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
                disabled={busy || googleBusy}
              >
                {busy ? <ActivityIndicator color={t.onTint} /> : <Text style={styles.buttonText}>Continue</Text>}
              </Pressable>
              <Text style={styles.footnote}>We’ll email you a 6-digit code. No password needed.</Text>
              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>or</Text>
                <View style={styles.orLine} />
              </View>
              <Pressable
                style={({ pressed }) => [styles.googleButton, (googleBusy || pressed) && styles.buttonDim]}
                onPress={onGoogle}
                disabled={busy || googleBusy}
                accessibilityRole="button"
              >
                {googleBusy ? (
                  <ActivityIndicator color={t.label} />
                ) : (
                  <>
                    <Image source={require('../../assets/google-g.png')} style={styles.googleLogo} />
                    <Text style={styles.googleText}>Continue with Google</Text>
                  </>
                )}
              </Pressable>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Text style={styles.footnote}>
                <Text style={styles.footLink} onPress={() => void Linking.openURL('https://hindsite.app/privacy')}>
                  Privacy Policy
                </Text>
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.codeTitle}>Check your email</Text>
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
                {busy ? <ActivityIndicator color={t.onTint} /> : <Text style={styles.buttonText}>Sign in</Text>}
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
                <Text style={styles.link}>Use a different email</Text>
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
    // paddingBottom keeps the tagline clear of the email field when the
    // keyboard is up and squeezes the hero.
    hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 32, paddingBottom: 30 },
    // Sized to fit above the form with the keyboard up (the email field
    // autofocuses, so that's the layout people actually see).
    appIcon: {
      width: 92,
      height: 92,
      borderRadius: 24,
      backgroundColor: t.tint,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: t.tint,
      shadowOpacity: 0.3,
      shadowRadius: 15,
      shadowOffset: { width: 0, height: 10 },
    },
    brand: { fontFamily: font.serif, fontSize: 40, lineHeight: 48, color: t.label, marginTop: 10, letterSpacing: -0.4 },
    tagline: { fontFamily: font.serifItalic, fontSize: 19, lineHeight: 24, color: t.secondary, textAlign: 'center' },
    form: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
    field: {
      height: 56,
      borderRadius: 18,
      backgroundColor: t.card,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      gap: 10,
      ...cardShadow(t),
    },
    input: { flex: 1, fontFamily: font.semibold, fontSize: 17, color: t.label, height: '100%' },
    codeInput: {
      letterSpacing: 8,
      textAlign: 'center',
      fontFamily: font.heavy,
      fontSize: 24,
      fontVariant: ['tabular-nums'],
    },
    button: { height: 56, borderRadius: 28, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
    buttonDim: { opacity: 0.7 },
    buttonText: { color: t.onTint, fontFamily: font.heavy, fontSize: 17 },
    orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 },
    orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.separator },
    orText: { fontFamily: font.bold, fontSize: 13, color: t.secondary },
    googleButton: {
      height: 56,
      borderRadius: 28,
      backgroundColor: t.card,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      ...cardShadow(t),
    },
    googleLogo: { width: 20, height: 20 },
    googleText: { color: t.label, fontFamily: font.heavy, fontSize: 17 },
    footnote: { fontFamily: font.semibold, fontSize: 13.5, lineHeight: 19, color: t.secondary, textAlign: 'center' },
    footLink: { color: t.tintText, fontFamily: font.heavy },
    link: { color: t.tintText, textAlign: 'center', fontFamily: font.heavy, fontSize: 16, marginTop: 6 },
    codeTitle: { fontFamily: font.serif, fontSize: 28, color: t.label, textAlign: 'center' },
    hint: {
      fontFamily: font.semibold,
      fontSize: 15.5,
      lineHeight: 22,
      color: t.secondary,
      textAlign: 'center',
      marginBottom: 6,
    },
    hintStrong: { color: t.label, fontFamily: font.heavy },
    error: { color: t.danger, textAlign: 'center', fontFamily: font.bold, fontSize: 15 },
  })
}
