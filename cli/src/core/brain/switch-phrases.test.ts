import { expect, test } from 'bun:test'
import { MODEL_SWITCH, SWITCH, findModel, findProvider } from './switch-phrases'

const providers = {
  claude: { label: 'Claude Code', aliases: ['คล็อด'] },
  'claude-acp': { label: 'Claude Code (ACP)' },
  opencode: { label: 'OpenCode', aliases: ['โอเพนโค้ด'] },
}

test('SWITCH catches the ways to say "use X"', () => {
  for (const [said, x] of [['สลับไปใช้ opencode', 'opencode'], ['เปลี่ยนไปใช้ คล็อด', 'คล็อด'], ['ใช้ opencode ตอบ', 'opencode'], ['สลับใช้ claude acp นะ', 'claude acp']] as const) {
    expect(said.match(SWITCH)?.[1]).toBe(x)
  }
  expect('วันนี้อากาศดีไหม'.match(SWITCH)).toBeNull()
})

test('MODEL_SWITCH catches "use model X"', () => {
  expect('ใช้โมเดล sonnet'.match(MODEL_SWITCH)?.[1]).toBe('sonnet')
  expect('เปลี่ยนโมเดลเป็น gemini flash'.match(MODEL_SWITCH)?.[1]).toBe('gemini flash')
  expect('สลับไปใช้ opencode'.match(MODEL_SWITCH)).toBeNull()
})

test('the provider named by name, label or alias; the longest match wins; unknown → null', () => {
  expect(findProvider('opencode', providers)).toBe('opencode')
  expect(findProvider('โอเพนโค้ด', providers)).toBe('opencode')
  expect(findProvider('คล็อด', providers)).toBe('claude')
  expect(findProvider('claude acp', providers)).toBe('claude-acp')
  expect(findProvider('claude code', providers)).toBe('claude')
  expect(findProvider('ไฟล์ที่สอง', providers)).toBeNull()
})

test('the model: a nickname first, then every said word must be in a listed id or name, shortest id wins', () => {
  const cfg = { models: { เร็ว: 'google/gemini-2.5-flash', 'nvdia-vl': 'nvidia/nemotron-3.5-super-vl:free' } }
  const known = [{ id: 'anthropic/claude-sonnet-4', name: 'Sonnet 4' }, { id: 'anthropic/claude-sonnet-4-long', name: 'Sonnet 4 long' }, { id: 'openai/gpt-5', name: 'GPT 5' }]
  expect(findModel('เร็ว', cfg, known)).toBe('เร็ว')
  expect(findModel('nvdia vl', cfg, known)).toBe('nvdia-vl')
  expect(findModel('sonnet 4', cfg, known)).toBe('anthropic/claude-sonnet-4')
  expect(findModel('gpt 6', cfg, known)).toBeNull()
  expect(findModel('โมเดลอะไรสักอย่าง', cfg, known)).toBeNull()
})
