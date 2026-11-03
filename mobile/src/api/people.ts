import { httpJson } from './client'
import type { Person } from './types'

export function listPeople(): Promise<Person[]> {
  return httpJson<Person[]>('/people')
}

export function createPerson(data: Partial<Person>): Promise<Person> {
  return httpJson<Person>('/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function updatePerson(id: string, data: Partial<Person>): Promise<Person> {
  return httpJson<Person>(`/people/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function deletePerson(id: string): Promise<{ ok: boolean }> {
  return httpJson(`/people/${id}`, { method: 'DELETE' })
}
