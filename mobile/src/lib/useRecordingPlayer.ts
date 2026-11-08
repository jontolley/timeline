import { useEffect, useRef, useState } from 'react'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio'

// The one recording playing right now, so starting another pauses it.
let current: AudioPlayer | null = null

// Plays a moment's recording in the app (it used to open in the browser).
// The player starts empty and only loads the recording on the first tap, so
// a Timeline full of audio cards doesn't fetch every file up front.
export function useRecordingPlayer(url?: string | null, knownDuration?: number | null) {
  const player = useAudioPlayer(null, { updateInterval: 100 })
  const status = useAudioPlayerStatus(player)
  const loadedUrl = useRef<string | null>(null)
  const [started, setStarted] = useState(false)

  // At the end, rewind so the next tap plays it again from the start.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause()
      void player.seekTo(0)
    }
  }, [status.didJustFinish, player])

  // useAudioPlayer releases the player on unmount; forget it here too.
  useEffect(
    () => () => {
      if (current === player) current = null
    },
    [player],
  )

  const toggle = async () => {
    if (!url) return
    if (status.playing) {
      player.pause()
      return
    }
    // Play even with the ring/silent switch on, like any media app. Set each
    // time, since the voice recorder changes the mode while it records.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {})
    if (current && current !== player) current.pause()
    current = player
    if (loadedUrl.current !== url) {
      player.replace({ uri: url })
      loadedUrl.current = url
    }
    player.play()
    setStarted(true)
  }

  const duration = status.duration > 0 ? status.duration : (knownDuration ?? 0)
  // Paused back at 0 (never played, or rewound after finishing) reads as not
  // started, so the card shows the length again rather than 0:00.
  const inProgress = started && (status.playing || status.currentTime > 0.05)
  const progress = inProgress && duration > 0 ? Math.min(1, status.currentTime / duration) : 0
  return {
    playing: status.playing,
    // Still fetching after the first tap.
    loading: started && !status.playing && (!status.isLoaded || status.isBuffering),
    started: inProgress,
    position: inProgress ? status.currentTime : 0,
    duration,
    progress,
    toggle,
  }
}
