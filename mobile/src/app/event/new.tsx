import { useEffect, useRef, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { File } from 'expo-file-system'
import { useIncomingShare } from 'expo-sharing'
import EventForm from '@/components/EventForm'
import type { PickedAsset } from '@/api/uploads'

// Create mode. The shared form handles everything; edit mode lives in [id].tsx.
//
// `?shared=1` means we arrived from the iOS share sheet (see +native-intent.ts):
// take the shared photos once, hand them to the form, and clear them so they
// aren't picked up again by the next New Moment. The extension copies each
// photo into the App Group container and never deletes it, so drop those
// copies when this screen closes (save is blocked until uploads finish).
export default function NewEventScreen() {
  const { shared } = useLocalSearchParams<{ shared?: string }>()
  const { resolvedSharedPayloads, isResolving, clearSharedPayloads } = useIncomingShare()
  const [sharedAssets, setSharedAssets] = useState<PickedAsset[] | undefined>()
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
    if (!shared || sharedAssets || isResolving) return
    const images = resolvedSharedPayloads.filter((p) => p.contentType === 'image' && p.contentUri)
    if (images.length === 0) return
    toDelete.current = images.map((p) => p.contentUri as string)
    setSharedAssets(
      images.map((p) => ({
        uri: p.contentUri as string,
        mimeType: p.contentMimeType ?? undefined,
        fileName: p.originalName,
      })),
    )
    clearSharedPayloads()
  }, [shared, sharedAssets, isResolving, resolvedSharedPayloads, clearSharedPayloads])

  return <EventForm sharedAssets={sharedAssets} />
}
