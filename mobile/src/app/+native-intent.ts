import { markShareLaunch } from '@/lib/shareLaunch'

// The share extension (expo-sharing) hands off to the app by opening
// `hindsite://expo-sharing`; send that to New Moment, which picks the shared
// photos up from useIncomingShare. Every other deep link passes through.
// On a cold launch the auth gate drops that route, so flag it for the root
// layout to reopen once signed in (see lib/shareLaunch.ts).
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (/^[a-z][\w+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(path)) {
    if (initial) markShareLaunch()
    return '/event/new?shared=1'
  }
  return path
}
