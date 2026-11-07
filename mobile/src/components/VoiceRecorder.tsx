import { useEffect, useMemo, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import * as Haptics from 'expo-haptics'
import type { PickedAsset } from '@/api/uploads'
import { Waveform } from '@/components/ui'
import { fmtDuration } from '@/lib/format'
import { font, useTheme, type Theme } from '@/theme'

// Records a voice note for a moment. Starts recording as soon as it mounts
// (after the microphone permission prompt the first time); the big red button
// stops it and hands back an .m4a (AAC, audio/mp4 — on the backend's allowed
// list) that the form uploads like any other media. Discard throws it away.

const BARS = 26
// Metering is in dBFS (-160…0); speech sits roughly in the top 50 dB.
const toLevel = (db: number | undefined) => (db == null ? 0 : Math.min(1, Math.max(0, (db + 50) / 50)))

export default function VoiceRecorder({
  onRecorded,
  onCancel,
}: {
  onRecorded: (asset: PickedAsset, durationSeconds: number) => void
  onCancel: () => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })
  const state = useAudioRecorderState(recorder, 100)
  const [levels, setLevels] = useState<number[]>([])
  const [stopping, setStopping] = useState(false)

  // Keyed on the recorder (the hook can swap it, e.g. on a dev double-mount)
  // and cancelled on cleanup, so only the live recorder is ever started.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const perm = await requestRecordingPermissionsAsync()
      if (cancelled) return
      if (!perm.granted) {
        Alert.alert(
          'Microphone access is off',
          'To record voice notes, allow Hindsite to use the microphone in Settings.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        )
        onCancel()
        return
      }
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        if (cancelled) return
        await recorder.prepareToRecordAsync()
        if (cancelled) return
        recorder.record()
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      } catch {
        if (cancelled) return
        Alert.alert('Couldn’t start recording', 'Something else may be using the microphone.')
        onCancel()
      }
    })()
    // Stop (and release the mic) if the sheet closes mid-recording.
    return () => {
      cancelled = true
      if (recorder.isRecording) void recorder.stop().catch(() => {})
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder])

  useEffect(() => {
    if (!state.isRecording) return
    setLevels((cur) => [...cur.slice(-(BARS - 1)), toLevel(state.metering)])
  }, [state.durationMillis, state.isRecording, state.metering])

  const stop = async () => {
    if (stopping) return
    setStopping(true)
    const secs = state.durationMillis / 1000
    try {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {})
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      const uri = recorder.uri
      if (!uri || secs < 0.5) {
        onCancel()
        return
      }
      onRecorded({ uri, mimeType: 'audio/mp4', fileName: 'voice-note.m4a' }, Math.round(secs))
    } catch {
      setStopping(false)
      Alert.alert('Couldn’t save the recording')
    }
  }

  const discard = async () => {
    if (recorder.isRecording) await recorder.stop().catch(() => {})
    onCancel()
  }

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Pressable
          style={({ pressed }) => [s.stop, pressed && { opacity: 0.7 }]}
          onPress={stop}
          disabled={stopping || !state.isRecording}
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
        >
          <View style={s.square} />
        </Pressable>
        <Waveform bars={BARS} height={40} on={t.audio} off={t.waveOff} levels={levels} />
      </View>
      <View style={s.cap}>
        <View style={s.capLeft}>
          <View style={[s.recDot, !state.isRecording && { opacity: 0.3 }]} />
          <Text style={s.capText}>{state.isRecording ? 'Recording' : stopping ? 'Saving…' : 'Starting…'}</Text>
          <Text style={[s.capText, { fontVariant: ['tabular-nums'] }]}>{fmtDuration(state.durationMillis / 1000)}</Text>
        </View>
        <Pressable onPress={discard} hitSlop={10} accessibilityRole="button" disabled={stopping}>
          <Text style={s.discard}>Discard</Text>
        </Pressable>
      </View>
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    wrap: { padding: 18, borderRadius: 24, backgroundColor: t.audioSoft },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    stop: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    square: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#FFFFFF' },
    cap: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
    capLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.danger },
    capText: { fontFamily: font.heavy, fontSize: 14, color: t.audio },
    discard: { fontFamily: font.heavy, fontSize: 14, color: t.secondary },
  })
}
