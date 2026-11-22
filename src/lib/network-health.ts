/**
 * Probe the same AppView used by feeds. A failed or stalled probe must release
 * its timer so later network recovery can resume paused queries.
 */
export async function checkServiceHealth(
  service: string,
  timeoutMs = 15_000,
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(
      `${service.replace(/\/$/, '')}/xrpc/_health`,
      {cache: 'no-store', signal: controller.signal},
    )
    if (!response.ok) return false
    const data: unknown = await response.json()
    return (
      typeof data === 'object' &&
      data !== null &&
      'version' in data &&
      typeof data.version === 'string' &&
      data.version.length > 0
    )
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
