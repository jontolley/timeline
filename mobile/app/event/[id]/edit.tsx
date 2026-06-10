import { useLocalSearchParams } from 'expo-router'
import EventForm from '../../../src/components/EventForm'

// Edit mode, opened from the event detail screen's "Edit" action. The static
// /event/new route handles creation; this is reached only as /event/:id/edit.
export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <EventForm eventId={id} />
}
