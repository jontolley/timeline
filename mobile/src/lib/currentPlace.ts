import * as Location from 'expo-location'
import { reverseGeocode } from '../api/geocode'
import type { LocationDetail } from '../api/types'

// Where the phone is right now, as a place, for a new moment's default
// location (the web form does the same with navigator.geolocation). Best
// effort: null when permission is refused or no fix comes back in time. Asks
// for when-in-use permission the first time; after a refusal it stays quiet
// rather than prompting on every new moment.
const FIX_TIMEOUT_MS = 10_000
const RECENT_FIX_MS = 10 * 60 * 1000

export async function currentPlace(): Promise<LocationDetail | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync()
    if (perm.status === Location.PermissionStatus.UNDETERMINED && perm.canAskAgain) {
      perm = await Location.requestForegroundPermissionsAsync()
    }
    if (perm.status !== Location.PermissionStatus.GRANTED) return null

    // A fix from the last few minutes is close enough and comes back at once.
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: RECENT_FIX_MS })) ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
      ]))
    if (!pos) return null
    const { latitude: lat, longitude: lng } = pos.coords
    const place = await reverseGeocode(lat, lng).catch(() => null)
    return place ?? { lat, lng }
  } catch {
    return null
  }
}
