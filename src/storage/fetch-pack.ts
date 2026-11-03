/**
 * Downloads a career pack from an https URL. The response is only parsed as JSON; it is never run.
 */

/**
 * Why fetchCareerPack failed: "not-https" for a link that isn't an https URL (no request is made),
 * "http-status" for a response outside 200-299, "blocked-or-offline" when the request itself failed
 * (the browser reports a CORS block and a network failure the same way), and "not-json" when the
 * body is not JSON.
 */
export type FetchPackError =
  | { kind: 'not-https' }
  | { kind: 'http-status'; status: number }
  | { kind: 'blocked-or-offline' }
  | { kind: 'not-json' }

/** The result of fetchCareerPack: the parsed JSON body, or the reason it failed. */
export type FetchPackResult = { ok: true; data: unknown } | { ok: false; error: FetchPackError }

/** The fetch function fetchCareerPack calls. Tests pass their own; the default is the browser's fetch. */
export type FetchFn = (url: string) => Promise<Response>

/**
 * Fetches `url` and parses the body as JSON. Refuses anything that does not parse as a URL with the
 * https: scheme, without making a request. Does not throw; every failure is returned as an error.
 */
export async function fetchCareerPack(url: string, fetchFn: FetchFn = (u) => fetch(u)): Promise<FetchPackResult> {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { ok: false, error: { kind: 'not-https' } }
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: { kind: 'not-https' } }
  let response: Response
  try {
    response = await fetchFn(parsed.href)
  } catch {
    return { ok: false, error: { kind: 'blocked-or-offline' } }
  }
  if (!response.ok) return { ok: false, error: { kind: 'http-status', status: response.status } }
  try {
    const data: unknown = await response.json()
    return { ok: true, data }
  } catch {
    return { ok: false, error: { kind: 'not-json' } }
  }
}

/** Returns the message the app shows for a FetchPackError, naming `url`. */
export function describeFetchError(url: string, error: FetchPackError): string {
  switch (error.kind) {
    case 'not-https':
      return `${url}: only https:// links are accepted.`
    case 'http-status':
      return `${url}: the server answered with HTTP status ${error.status}.`
    case 'blocked-or-offline':
      return `${url}: the request was blocked or the host could not be reached. Some hosts don't allow loading from other sites; download the file and use Import from file instead.`
    case 'not-json':
      return `${url}: the response is not valid JSON.`
  }
}
