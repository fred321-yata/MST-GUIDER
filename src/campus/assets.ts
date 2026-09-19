/**
 * Resolve a file served from /public for the current build.
 *
 * Vite's BASE_URL is '/' in dev and './' in production builds, so the same
 * asset reference works at the domain root, inside a subfolder, and inside the
 * Capacitor webView. Never hard-code a leading '/' for public files.
 */
export function publicAsset(file: string): string {
  return `${import.meta.env.BASE_URL}${file.replace(/^\/+/, '')}`
}
