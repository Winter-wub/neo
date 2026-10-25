import type { Card } from '../../protocol'
import { isWeather } from '../conversation/phrases'
import { dayOf, placeOf } from './places'

export interface Home {
  city: string
  lat: number
  lon: number
}
/** Bangkok: what "here" means until the setting `home` is set. */
export const DEFAULT_HOME: Home = { city: 'กรุงเทพฯ', lat: 13.75, lon: 100.52 }

/** What a weather question asks: `place` is empty when the question itself names it (or means home). */
export interface WeatherIntent {
  place: string
  day: number
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_TIMEOUT_MS = 6000
const FORECAST_TIMEOUT_MS = 8000
const NAME_MAX = 20
const CARD_SECONDS = 15
const WET_PERCENT = 60
const WHEN = ['วันนี้', 'พรุ่งนี้', 'มะรืนนี้'] as const

/** WMO weather code → card icon and a Thai description. */
function describe(code: number): [icon: string, text: string] {
  if (code === 0) return ['sun', 'ท้องฟ้าแจ่มใส']
  if (code <= 2) return ['cloudsun', 'มีเมฆบางส่วน']
  if (code === 3) return ['cloud', 'เมฆมาก']
  if (code <= 48) return ['fog', 'มีหมอก']
  if (code <= 57) return ['rain', 'ฝนปรอย']
  if (code <= 67) return ['rain', 'ฝนตก']
  if (code <= 77) return ['cloud', 'อากาศเย็นจัด']
  if (code <= 82) return ['rain', 'ฝนตกเป็นช่วง']
  return ['storm', 'พายุฟ้าคะนอง']
}

interface Located {
  lat: number
  lon: number
  name: string
  /** The geocoder's name is the one asked for. */
  exact?: boolean
}

interface Forecast {
  current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number }
  daily: { weather_code: number[]; precipitation_probability_max: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
}

export function createWeather({ fetch: get = fetch, home }: {
  /** Tests inject a fake open-meteo. */
  fetch?: typeof fetch
  /** The setting `home`, read on every question. */
  home: () => Home
}) {
  const known = new Map<string, Located | null>()

  /** Place name → coordinates; a miss is remembered, a network failure is not. */
  async function geocode(query: string): Promise<Located | null> {
    if (known.has(query)) return known.get(query)!
    const response = await get(`${GEOCODE_URL}?count=1&language=th&name=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) })
    const hit = response.ok ? ((await response.json()) as { results?: any[] }).results?.[0] : null
    const found: Located | null = hit
      ? { lat: hit.latitude, lon: hit.longitude, name: hit.country_code === 'TH' ? hit.name : `${hit.name} ${hit.country ?? ''}`.trim(), exact: hit.name === query }
      : null
    known.set(query, found)
    return found
  }

  return {
    /** A weather question, said in Thai. The place stays in the text; `forecast` reads it from there. */
    understand(text: string): WeatherIntent | null {
      return isWeather(text) ? { place: '', day: dayOf(text) } : null
    },

    /** The weather card for a question (`text`) or a Brain intent (`place`, `day`). Throws when open-meteo refuses. */
    async forecast(intent: WeatherIntent, text: string): Promise<Card> {
      const { city, lat, lon } = home()
      const day = [0, 1, 2].includes(intent.day) ? intent.day : dayOf(text)
      const place = intent.place ? (placeOf(intent.place) ?? { kind: 'query' as const, query: intent.place }) : placeOf(text)
      let where: Located = { lat, lon, name: city }
      let missing: string | null = null
      if (place?.kind === 'fixed') where = place
      else if (place) {
        const found = await geocode(place.query).catch(() => null)
        if (found && (place.kind !== 'guess' || found.exact)) where = found // a guess must match exactly, or a village with a similar name wins
        else if (place.kind !== 'guess') missing = place.query
      }

      const url = `${FORECAST_URL}?latitude=${where.lat}&longitude=${where.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&daily=weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`
      const response = await get(url, { signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`weather ${response.status}`)
      const { current, daily } = (await response.json()) as Forecast

      const low = Math.round(daily.temperature_2m_min[day]!)
      const high = Math.round(daily.temperature_2m_max[day]!)
      const rain = daily.precipitation_probability_max[day]!
      const [icon, description] = describe(day === 0 ? current.weather_code : daily.weather_code[day]!)
      const wet = icon === 'rain' || icon === 'storm' || rain >= WET_PERCENT
      const name = String(where.name).slice(0, NAME_MAX)
      const lines = day === 0
        ? [`${name} · ${description}`, `รู้สึกเหมือน ${Math.round(current.apparent_temperature)}°  ชื้น ${current.relative_humidity_2m}%`, `วันนี้ ${low}–${high}°  ฝน ${rain}%`]
        : [`${name} · ${WHEN[day]}`, description, `ต่ำสุด ${low}°  ฝน ${rain}%`]
      if (missing) lines.unshift(`หา "${missing}" ไม่เจอ ใช้${city}แทน`)
      return {
        kind: 'weather', layout: 'text', icon, title: `${day === 0 ? Math.round(current.temperature_2m) : high}°C`, lines, items: [],
        emotion: wet ? 'curious' : 'happy', sounds: wet ? ['greet', 'curious'] : ['greet', 'happy'], seconds: CARD_SECONDS,
      }
    },
  }
}

export type Weather = ReturnType<typeof createWeather>

/** The setting `home`, from whatever state.json holds; anything malformed means the default. */
export function homeOf(value: unknown): Home {
  const { city, lat, lon } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return typeof city === 'string' && city && typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { city, lat, lon }
    : DEFAULT_HOME
}
