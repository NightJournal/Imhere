/** Pure helpers shared by the invite UI and its tests. */
export function parsePeople(value) {
  if (!/^\d+$/.test(String(value).trim())) throw new Error("Enter a whole number from 1 to 20");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 20) throw new Error("Enter a whole number from 1 to 20");
  return n;
}
export function inviteToken(value) {
  const text = String(value).trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(text)) return text.toLowerCase();
  try {
    const params = new URLSearchParams(new URL(text).hash.slice(1));
    const token = params.get("join") || params.get("group");
    return token && uuid.test(token) ? token.toLowerCase() : null;
  } catch { return null; }
}
export function shareURL(kind, token) {
  return `${location.origin}${location.pathname}#${kind}=${encodeURIComponent(token)}`;
}
