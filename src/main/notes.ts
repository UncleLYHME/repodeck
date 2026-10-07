// Release notes -> the few bullet points the update popup shows.

const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()

/** Bullet points from a release's notes (GitHub hands them over as HTML, sometimes Markdown). */
export function releaseBullets(notes: unknown): string[] {
  const text = Array.isArray(notes) ? notes.map((n) => (n as { note?: string }).note ?? '').join('\n') : String(notes ?? '')
  const items = [...text.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]))
  if (items.length) return items.slice(0, 6)
  return text.split('\n').filter((l) => /^\s*[-*] /.test(l)).map((l) => decode(l.trim().slice(2))).slice(0, 6)
}
