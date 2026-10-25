import { expect, test } from 'bun:test'
import { createWeather, DEFAULT_HOME, type Home } from './weather'

const FORECAST = {
  current: { temperature_2m: 31.4, apparent_temperature: 36.2, relative_humidity_2m: 70, weather_code: 2 },
  daily: {
    weather_code: [2, 61, 95],
    precipitation_probability_max: [20, 80, 90],
    temperature_2m_max: [34.2, 30.1, 29.6],
    temperature_2m_min: [26.4, 25.2, 24.8],
  },
}

/** An open-meteo that answers from tables and remembers what it was asked. */
function fakeMeteo(geo: Record<string, any> = {}) {
  const urls: URL[] = []
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    urls.push(url)
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      const found = geo[url.searchParams.get('name')!]
      return Response.json(found ? { results: [found] } : {})
    }
    return Response.json(FORECAST)
  }) as typeof globalThis.fetch
  return { fetch, forecasts: () => urls.filter(u => u.hostname === 'api.open-meteo.com'), geocodes: () => urls.filter(u => u.hostname === 'geocoding-api.open-meteo.com') }
}

const make = (meteo = fakeMeteo(), home: Home = DEFAULT_HOME) => createWeather({ fetch: meteo.fetch, home: () => home })

test('weather questions are understood without the Brain; other sentences are not', () => {
  const { understand } = make()
  expect(understand('อากาศพรุ่งนี้เป็นไง')).toEqual({ place: '', day: 1 })
  expect(understand('ฝนตกไหม')).toEqual({ place: '', day: 0 })
  expect(understand('ร้านซ่อมเครื่องปรับอากาศแถวนี้')).toBeNull()
  expect(understand('ราคาทองวันนี้')).toBeNull()
})

test('"here" is the home setting; today shows now, feels-like, humidity and the day range', async () => {
  const meteo = fakeMeteo()
  const card = await make(meteo, { city: 'ลำปาง', lat: 18.29, lon: 99.49 }).forecast({ place: '', day: 0 }, 'อากาศเป็นไง')
  const [call] = meteo.forecasts()
  expect(call!.searchParams.get('latitude')).toBe('18.29')
  expect(call!.searchParams.get('longitude')).toBe('99.49')
  expect(call!.searchParams.get('forecast_days')).toBe('3')
  expect(meteo.geocodes()).toHaveLength(0)
  expect(card).toMatchObject({
    kind: 'weather', icon: 'cloudsun', title: '31°C', emotion: 'happy', sounds: ['greet', 'happy'], seconds: 15,
    lines: ['ลำปาง · มีเมฆบางส่วน', 'รู้สึกเหมือน 36°  ชื้น 70%', 'วันนี้ 26–34°  ฝน 20%'],
  })
})

test('tomorrow shows its high as the title; rain makes Neo curious', async () => {
  const card = await make().forecast({ place: '', day: 1 }, 'พรุ่งนี้')
  expect(card).toMatchObject({
    icon: 'rain', title: '30°C', emotion: 'curious', sounds: ['greet', 'curious'],
    lines: ['กรุงเทพฯ · พรุ่งนี้', 'ฝนตก', 'ต่ำสุด 25°  ฝน 80%'],
  })
})

test('the day after tomorrow, a storm', async () => {
  const card = await make().forecast({ place: '', day: 2 }, '')
  expect(card).toMatchObject({ icon: 'storm', lines: ['กรุงเทพฯ · มะรืนนี้', 'พายุฟ้าคะนอง', 'ต่ำสุด 25°  ฝน 90%'] })
})

test('a fixed spot needs no geocoding; a province is geocoded once and remembered', async () => {
  const meteo = fakeMeteo({ 'เชียงใหม่': { latitude: 18.79, longitude: 98.98, name: 'เชียงใหม่', country_code: 'TH', country: 'ไทย' } })
  const weather = make(meteo)
  const pai = await weather.forecast({ place: '', day: 0 }, 'ปายอากาศเป็นไง')
  expect(pai.lines[0]).toStartWith('ปาย ·')
  expect(meteo.geocodes()).toHaveLength(0)

  await weather.forecast({ place: '', day: 0 }, 'อากาศที่เชียงใหม่')
  const again = await weather.forecast({ place: '', day: 1 }, 'พรุ่งนี้เชียงใหม่ฝนตกไหม')
  expect(meteo.geocodes()).toHaveLength(1)
  expect(meteo.forecasts().at(-1)!.searchParams.get('latitude')).toBe('18.79')
  expect(again.lines[0]).toBe('เชียงใหม่ · พรุ่งนี้')
})

test('the Brain names the place; a place abroad carries its country', async () => {
  const meteo = fakeMeteo({ 'โตเกียว': { latitude: 35.68, longitude: 139.69, name: 'โตเกียว', country_code: 'JP', country: 'ญี่ปุ่น' } })
  const card = await make(meteo).forecast({ place: 'โตเกียว', day: 0 }, 'ไปญี่ปุ่นเอาร่มไปไหม')
  expect(card.lines[0]).toBe('โตเกียว ญี่ปุ่น · มีเมฆบางส่วน')
})

test('a place that cannot be found says so and uses home', async () => {
  const card = await make().forecast({ place: '', day: 0 }, 'อากาศที่เมืองลับแล')
  expect(card.lines).toEqual(['หา "เมืองลับแล" ไม่เจอ ใช้กรุงเทพฯแทน', 'กรุงเทพฯ · มีเมฆบางส่วน', 'รู้สึกเหมือน 36°  ชื้น 70%', 'วันนี้ 26–34°  ฝน 20%'])
})

test('words only guessed to be a place are dropped silently unless the geocoder matches exactly', async () => {
  const wrong = fakeMeteo({ 'โซล': { latitude: 1, longitude: 2, name: 'โซลทาวน์', country_code: 'TH' } })
  const card = await make(wrong).forecast({ place: '', day: 0 }, 'โซลอากาศเป็นไง')
  expect(card.lines[0]).toStartWith('กรุงเทพฯ ·')
  const right = fakeMeteo({ 'โซล': { latitude: 37.57, longitude: 126.98, name: 'โซล', country_code: 'KR', country: 'เกาหลีใต้' } })
  expect((await make(right).forecast({ place: '', day: 0 }, 'โซลอากาศเป็นไง')).lines[0]).toStartWith('โซล เกาหลีใต้ ·')
})

test('a forecast the service refuses is an error, a failed geocode falls back to home', async () => {
  const down = (async (input: string | URL | Request) => String(input).includes('geocoding') ? Response.error() : new Response('no', { status: 503 })) as unknown as typeof fetch
  const weather = createWeather({ fetch: down, home: () => DEFAULT_HOME })
  await expect(weather.forecast({ place: '', day: 0 }, 'อากาศที่เชียงใหม่')).rejects.toThrow('weather 503')
})

test('a failed geocode is not remembered', async () => {
  let up = false
  const meteo = fakeMeteo({ 'เชียงใหม่': { latitude: 18.79, longitude: 98.98, name: 'เชียงใหม่', country_code: 'TH' } })
  const flaky = ((input: string | URL | Request) => (String(input).includes('geocoding') && !up ? Promise.reject(new Error('offline')) : meteo.fetch(input))) as typeof fetch
  const weather = createWeather({ fetch: flaky, home: () => DEFAULT_HOME })
  const first = await weather.forecast({ place: '', day: 0 }, 'อากาศที่เชียงใหม่')
  expect(first.lines[0]).toStartWith('หา "เชียงใหม่" ไม่เจอ')
  up = true
  expect((await weather.forecast({ place: '', day: 0 }, 'อากาศที่เชียงใหม่')).lines[0]).toStartWith('เชียงใหม่ ·')
})

test('long place names are cut to 20 characters', async () => {
  const card = await make(fakeMeteo(), { city: 'ก'.repeat(30), lat: 1, lon: 2 }).forecast({ place: '', day: 0 }, '')
  expect(card.lines[0]).toStartWith('ก'.repeat(20) + ' ·')
})
