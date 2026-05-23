import { http } from './http'

const BASE = '/api/categories'

export async function listCategories() {
  const res = await http(BASE)
  if (!res.ok) throw new Error('Failed to fetch categories')
  return res.json()
}

export async function createCategory(data) {
  const res = await http(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to create category')
  }
  return res.json()
}

export async function updateCategory(id, data) {
  const res = await http(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to update category')
  }
  return res.json()
}

export async function deleteCategory(id) {
  const res = await http(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to delete category')
  }
  return res.json()
}
