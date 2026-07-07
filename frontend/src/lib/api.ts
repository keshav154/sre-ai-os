const TOKEN_KEY = 'sre_ai_os_token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function logout() {
  clearToken()
  window.location.href = '/login'
}

/**
 * Drop-in replacement for `fetch()` that attaches the auth token and
 * redirects to /login on a 401 (expired/invalid session) instead of
 * silently returning an error every caller would otherwise need to
 * special-case individually.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(input, { ...init, headers })
  if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login' && window.location.pathname !== '/signup') {
    clearToken()
    window.location.href = '/login'
  }
  return res
}
