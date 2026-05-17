import { http } from './http'

const BASE = '/api/people'

export async function listPeople() {
  const res = await http(BASE)
  if (!res.ok) throw new Error('Failed to fetch people')
  return res.json()
}

export async function createPerson(data) {
  const res = await http(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create person')
  return res.json()
}

export async function updatePerson(id, data) {
  const res = await http(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update person')
  return res.json()
}

export async function deletePerson(id) {
  const res = await http(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete person')
  return res.json()
}
