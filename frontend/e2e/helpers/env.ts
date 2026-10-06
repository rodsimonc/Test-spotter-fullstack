// What this run is pointed at. The config and the specs both read it, so the rules live here.

const e = process.env

const portFrom = (name: string, fallback: number) => Number(e[name]) || fallback

/**
 * Ports for the local stack. Django and the fake upstream are fixed (Vite proxies to 8000).
 * The page ports can move when something else holds 5173 or 4173.
 */
export const ports = {
  django: 8000,
  vite: portFrom('E2E_VITE_PORT', 5173),
  preview: portFrom('E2E_PREVIEW_PORT', 4173),
  upstream: 8787,
}

/** Run against a deployed site. No servers are started. */
export const isRemote = Boolean(e.E2E_BASE_URL)

/** Run the local stack against the real OSRM, Photon and Nominatim. */
export const isLive = e.E2E_LIVE === '1'

/** Serve the production build with `vite preview` (CSP headers on) instead of `vite`. */
export const usePreview = e.E2E_PREVIEW === '1'

/** True when places and routes come from real services, so exact numbers are unknowable. */
export const realUpstream = isRemote || isLive

/** Specs tagged @live only run when this is true. */
export const liveEnabled = realUpstream

export const baseURL = (
  e.E2E_BASE_URL ?? `http://127.0.0.1:${usePreview ? ports.preview : ports.vite}`
).replace(/\/+$/, '')

export const origin = new URL(baseURL).origin

export const isHttps = baseURL.startsWith('https:')

/** The fake OSRM, Photon and Nominatim. Only exists in local runs. */
export const upstreamURL = `http://127.0.0.1:${ports.upstream}`
