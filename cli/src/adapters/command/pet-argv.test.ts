import { expect, test } from 'bun:test'
import { UsageError, parseArgs } from './argv'

const cmd = (...argv: string[]) => parseArgs(argv).command

test('neo pet: show, feed (fish by default), sleep', () => {
  expect(cmd('pet')).toEqual({ name: 'pet-show' })
  expect(cmd('pet', 'feed')).toEqual({ name: 'pet-feed', food: undefined })
  expect(cmd('pet', 'feed', 'milk')).toEqual({ name: 'pet-feed', food: 'milk' })
  expect(cmd('pet', 'sleep')).toEqual({ name: 'pet-sleep' })
})

test('neo name: show, set with variants, train, train --cancel', () => {
  expect(cmd('name')).toEqual({ name: 'name-show' })
  expect(cmd('name', 'set', 'จอห์น')).toEqual({ name: 'name-set', petName: 'จอห์น', variants: undefined })
  expect(cmd('name', 'set', 'จอห์น', '--variants', 'จอน, ชอน')).toEqual({ name: 'name-set', petName: 'จอห์น', variants: ['จอน', 'ชอน'] })
  expect(cmd('name', 'train', 'จอห์น')).toEqual({ name: 'name-train', petName: 'จอห์น' })
  expect(cmd('name', 'train', '--cancel')).toEqual({ name: 'name-train-cancel' })
})

test('neo face: show and set any of the four colours', () => {
  expect(cmd('face')).toEqual({ name: 'face-show' })
  expect(cmd('face', 'set', '--fg', '#ffffff', '--bg', '#101010')).toEqual({ name: 'face-set', face: { fg: '#ffffff', bg: '#101010' } })
})

test('neo phone wake / neo phone pet act as the phone', () => {
  expect(cmd('phone', 'wake')).toEqual({ name: 'phone-wake' })
  expect(cmd('phone', 'pet', '0.3', '0.8')).toEqual({ name: 'phone-pet', hunger: 0.3, affection: 0.8 })
})

test.each([
  [['pet', 'dance']],
  [['pet', 'feed', 'sushi']],
  [['pet', 'feed', 'fish', 'milk']],
  [['name', 'set']],
  [['name', 'train']],
  [['name', 'train', 'a', '--cancel']],
  [['name', 'wat']],
  [['face', 'set']],
  [['face', 'set', '--fg', 'white']],
  [['face', 'paint']],
  [['phone', 'pet', '0.3']],
  [['phone', 'pet', 'x', '0.3']],
  [['phone', 'pet', '2', '0.3']],
  [['phone', 'wake', 'now']],
])('%j is a usage error', argv => {
  expect(() => parseArgs(argv)).toThrow(UsageError)
})
