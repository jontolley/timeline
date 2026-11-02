import { Appearance } from 'react-native'
import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

// System / Light / Dark preference (Account → Appearance). Defaults to System,
// the iOS convention — unlike the web app, which defaults to light.
//
// `apply()` is the single writer of the native override: Appearance.
// setColorScheme sets overrideUserInterfaceStyle on the app's windows, so the
// native tab bar, date picker, alerts, status bar *and* useColorScheme() all
// follow it — screens just call useTheme(). SecureStore is used only because
// it's the persistence module already linked; the value isn't sensitive.
export type AppearancePref = 'system' | 'light' | 'dark'

const KEY = 'hindsite_appearance'

function apply(pref: AppearancePref) {
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref)
}

type AppearanceState = {
  pref: AppearancePref
  init: () => Promise<void>
  setPref: (pref: AppearancePref) => void
}

export const useAppearanceStore = create<AppearanceState>((set) => ({
  pref: 'system',

  init: async () => {
    const saved = await SecureStore.getItemAsync(KEY).catch(() => null)
    const pref: AppearancePref = saved === 'light' || saved === 'dark' ? saved : 'system'
    apply(pref)
    set({ pref })
  },

  setPref: (pref) => {
    apply(pref)
    set({ pref })
    void SecureStore.setItemAsync(KEY, pref).catch(() => {})
  },
}))
