import { useLocalSearchParams } from 'expo-router'
import EventForm from '../../src/components/EventForm'

// Edit mode. Static /event/new takes precedence over this dynamic route, so
// "new" never lands here.
export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <EventForm eventId={id} />
}
