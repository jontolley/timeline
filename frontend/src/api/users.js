import { http } from './http'

const BASE = '/api/users'

export async function listUsers() {
  const res = await http(BASE)
  if (!res.ok) throw new Error('Failed to fetch users')
  return res.json()
}

export async function inviteUser({ email, role = 'user' }) {
  const res = await http(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to invite user')
  }
  return res.json()
}

export async function updateUserRole(id, role) {
  const res = await http(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to update user')
  }
  return res.json()
}

export async function getUserFootprint(id) {
  const res = await http(`${BASE}/${id}/footprint`)
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to load user footprint')
  }
  return res.json()
}

export async function deleteUser(id) {
  const res = await http(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to delete user')
  }
  return res.json()
}
