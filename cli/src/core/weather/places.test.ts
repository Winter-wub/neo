import { expect, test } from 'bun:test'
import { dayOf, placeOf } from './places'

const name = (text: string) => {
  const place = placeOf(text)
  return place && (place.kind === 'fixed' ? place.name : place.query)
}
/** No place named: the home city (a bare guess is fine, the forecast only accepts it when the geocoder agrees exactly). */
const nowhere = (text: string) => {
  const place = placeOf(text)
  expect(place === null || (place.kind === 'guess' && place.query.length >= 3), `${text} → ${JSON.stringify(place)}`).toBe(true)
}

test('provinces, aliases and fixed spots are found in the question', () => {
  expect(name('อากาศที่เชียงใหม่เป็นยังไง')).toBe('เชียงใหม่')
  expect(name('ภูเก็ตฝนตกไหม')).toBe('ภูเก็ต')
  expect(name('พรุ่งนี้โคราชร้อนไหม')).toBe('นครราชสีมา')
  expect(name('นครศรีธรรมราชฝนตกไหม')).toBe('นครศรีธรรมราช') // the long name before its short alias
  expect(name('เขาใหญ่หนาวไหม')).toBe('เขาใหญ่')
  expect(placeOf('ไปปายช่วงนี้อากาศดีไหม')).toEqual({ kind: 'fixed', lat: 19.36, lon: 98.44, name: 'ปาย' })
})

test('places outside the list come from the words after "ที่", or from the leftover words', () => {
  expect(name('อากาศที่โตเกียวเป็นไง')).toBe('โตเกียว')
  expect(name('โตเกียวอากาศเป็นไง')).toBe('โตเกียว')
  expect(name('พรุ่งนี้โซลฝนตกไหม')).toBe('โซล')
})

test('words that look like a province only count with a place cue; no place means home', () => {
  nowhere('วันนี้อากาศเป็นยังไงบ้าง')
  nowhere('นีโอ อากาศเป็นไง')
  nowhere('วันนี้อากาศดีมากเลย')
  nowhere('ตากผ้าได้ไหม ฝนจะตกไหม')
  nowhere('ฝนตกแถวบ้านไหม')
  expect(name('อากาศที่ตากเป็นไง')).toBe('ตาก')
})

test('the day: today, tomorrow, the day after', () => {
  expect(dayOf('พรุ่งนี้ฝนตกไหม')).toBe(1)
  expect(dayOf('มะรืนนี้')).toBe(2)
  expect(dayOf('วันนี้')).toBe(0)
  expect(dayOf('อากาศเป็นไง')).toBe(0)
})
