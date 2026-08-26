export const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
export async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message ?? 'Request failed'); }
  return response.status === 204 ? null : response.json();
}
