// The share extension (expo-sharing) hands off to the app by opening
// `hindsite://expo-sharing`; send that to New Moment, which picks the shared
// photos up from useIncomingShare. Every other deep link passes through.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (/^[a-z][\w+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(path)) return '/event/new?shared=1'
  return path
}
