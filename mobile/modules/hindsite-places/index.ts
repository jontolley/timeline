import { requireOptionalNativeModule } from 'expo'

// JS side of modules/hindsite-places (Swift: ios/HindsitePlacesModule.swift),
// Apple Maps place search. Optional so a build made before this module existed
// still runs; searchPlaces() then falls back to OpenStreetMap.

export type ApplePlace = { name?: string; address?: string; lat: number; lng: number }

type NativeModule = {
  search(query: string, lat: number | null, lng: number | null): Promise<ApplePlace[]>
}

const native = requireOptionalNativeModule<NativeModule>('HindsitePlaces')

export const applePlacesAvailable = native != null

export function searchApplePlaces(
  query: string,
  near?: { lat: number; lng: number } | null,
): Promise<ApplePlace[]> {
  if (!native) return Promise.reject(new Error('Apple Maps search needs a newer build of the app.'))
  return native.search(query, near?.lat ?? null, near?.lng ?? null)
}
