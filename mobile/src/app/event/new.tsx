import { useEffect, useRef, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { File, Paths } from 'expo-file-system'
import { useIncomingShare } from 'expo-sharing'
import EventForm from '@/components/EventForm'
import type { PickedAsset } from '@/api/uploads'
import { looksLikeMapLink } from '@/api/places'

// Create mode. The shared form handles everything; edit mode lives in [id].tsx.
//
// `?shared=1` means we arrived from the iOS share sheet (see +native-intent.ts):
// take what was shared once, hand it to the form, and clear it so it isn't
// picked up again by the next New Moment.
// - Photos / videos are attached. The extension copies each into the App
//   Group container; move them into the app's own cache first — on a device
//   the background upload session (run by a system daemon) fails to read
//   files in the App Group container. Drop the moved files when this screen
//   closes (save is blocked until uploads finish).
// - A Google / Apple Maps link (shared as a URL, or inside text) becomes the
//   location. Any other shared text or link goes into the description.
// Links and text are read from the raw payloads: resolving a URL payload makes
// a network request, and if that fails the resolved list comes back empty.
export default function NewEventScreen() {
  const { shared } = useLocalSearchParams<{ shared?: string }>()
  const { sharedPayloads, resolvedSharedPayloads, isResolving, error, clearSharedPayloads } = useIncomingShare()
  const [sharedAssets, setSharedAssets] = useState<PickedAsset[] | undefined>()
  const [sharedLink, setSharedLink] = useState<string | undefined>()
  const [sharedText, setSharedText] = useState<string | undefined>()
  const taken = useRef(false)
  const toDelete = useRef<string[]>([])

  useEffect(
    () => () => {
      for (const uri of toDelete.current) {
        try {
          new File(uri).delete()
        } catch {
          // already gone
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!shared || taken.current || isResolving || sharedPayloads.length === 0) return
    // The hook starts resolving in an effect, so the first render has payloads
    // but nothing resolved yet — wait for the result (or its failure).
    if (resolvedSharedPayloads.length === 0 && !error) return
    taken.current = true

    // Only files the extension copied locally — a shared web URL can resolve
    // to a remote image, which isn't ours to upload or delete.
    const media = resolvedSharedPayloads.filter(
      (p) => (p.shareType === 'image' || p.shareType === 'video') && p.contentUri,
    )
    if (media.length > 0) {
      void Promise.all(
        media.map(async (p, i) => {
          const file = new File(p.contentUri as string)
          try {
            await file.move(new File(Paths.cache, `shared-${Date.now()}-${i}-${file.name}`))
          } catch {
            // Keep the App Group copy; the upload may still work from there.
          }
          return { uri: file.uri, mimeType: p.contentMimeType ?? undefined, fileName: p.originalName }
        }),
      ).then((assets) => {
        toDelete.current = assets.map((a) => a.uri)
        setSharedAssets(assets)
      })
    }

    const texts = sharedPayloads
      .filter((p) => p.shareType === 'url' || p.shareType === 'text')
      .map((p) => p.value.trim())
      .filter(Boolean)
    const link = texts.find(looksLikeMapLink)
    if (link) setSharedLink(link)
    else if (texts.length > 0) setSharedText(texts.join('\n'))

    clearSharedPayloads()
  }, [shared, isResolving, error, sharedPayloads, resolvedSharedPayloads, clearSharedPayloads])

  return <EventForm sharedAssets={sharedAssets} sharedLink={sharedLink} sharedText={sharedText} />
}
