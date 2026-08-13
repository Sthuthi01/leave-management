/** Reads the `csrftoken` cookie Django's CsrfView sets — echoed back as X-CSRFToken on every
 *  mutating request (see api-client.ts). Mirrors how the source app's browser-native cookie trust
 *  worked, adapted for a cross-origin SPA talking to a separate Django backend. */
export function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}
