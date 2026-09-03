/**
 * Fetch the current contracting legal entity from the platform public API.
 * Uses VITE_PLATFORM_API_BASE (not VITE_API_BASE_URL). Unset → return null, never throw.
 */
const PLATFORM_BASE = (import.meta.env.VITE_PLATFORM_API_BASE as string | undefined)?.replace(/\/+$/, "") || ""

const CACHE_KEY = "claimtagx.legalEntity.current.v1"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface PublicLegalEntity {
  id: string
  legal_name: string
  jurisdiction: string
  entity_type: string
  registration_number: string | null
  registered_address_line1: string
  registered_address_line2: string | null
  registered_address_city: string
  registered_address_state: string | null
  registered_address_postal: string | null
  registered_address_country: string
  registered_address: string
  contact_email: string
  contact_phone: string | null
  effective_from: string
  active: boolean
  website: string | null
}

type CacheRecord = {
  entity: PublicLegalEntity
  etag: string | null
  cachedAt: number
  product: string
  region: string | null
}

function cacheKey(product: string, region: string | null) {
  return `${CACHE_KEY}:${product}:${region || ""}`
}

function readCache(product: string, region: string | null): CacheRecord | null {
  try {
    if (typeof localStorage === "undefined") return null
    const raw = localStorage.getItem(cacheKey(product, region))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheRecord
    if (!parsed?.entity || typeof parsed.cachedAt !== "number") return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(record: CacheRecord) {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(cacheKey(record.product, record.region), JSON.stringify(record))
  } catch {
    /* quota / private mode */
  }
}

export async function fetchCurrentLegalEntity(opts?: {
  product?: string
  region?: string | null
}): Promise<PublicLegalEntity | null> {
  if (!PLATFORM_BASE) return null
  const product = (opts?.product || "claimtagx").trim() || "claimtagx"
  const region = opts?.region == null || String(opts.region).trim() === "" ? null : String(opts.region).trim()
  const cached = readCache(product, region)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS && cached.entity) {
    return cached.entity
  }

  const url = new URL(`${PLATFORM_BASE}/api/v1/legal/entity/current`)
  url.searchParams.set("product", product)
  if (region) url.searchParams.set("region", region)

  const headers: Record<string, string> = { Accept: "application/json" }
  if (cached?.etag) headers["If-None-Match"] = cached.etag

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      headers,
    })
    if (res.status === 304 && cached?.entity) {
      writeCache({ ...cached, cachedAt: Date.now() })
      return cached.entity
    }
    if (!res.ok) return cached?.entity ?? null
    const data = (await res.json().catch(() => null)) as { entity?: PublicLegalEntity } | null
    const entity = data?.entity
    if (!entity || typeof entity !== "object" || !entity.legal_name) return cached?.entity ?? null
    writeCache({
      entity,
      etag: res.headers.get("ETag"),
      cachedAt: Date.now(),
      product,
      region,
    })
    return entity
  } catch {
    return cached?.entity ?? null
  }
}
