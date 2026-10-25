import type { DoctorRow } from '../../protocol'
import type { SttDoctor, SttPermission } from './stt'

const LABEL = 'ถอดเสียง (neo-stt · Speech)'
const SETTINGS_SPEECH = 'เปิดที่ System Settings › Privacy & Security › Speech Recognition แล้วติ๊ก Neo Console'
const INSTALL_THAI = 'System Settings › Keyboard › Dictation เพิ่มภาษาไทย (th-TH) ให้ดาวน์โหลดโมเดลบนเครื่อง'

function rowFor({ status, onDevice }: SttPermission): DoctorRow {
  const base = { id: 'stt', label: LABEL }
  if (status === 'notDetermined') return { ...base, ok: false, detail: 'ยังไม่ได้ขออนุญาต Speech Recognition', fix: 'neo doctor --fix stt' }
  if (status !== 'authorized') return { ...base, ok: false, detail: `Speech Recognition ถูกปิดไว้ (${status})`, fix: SETTINGS_SPEECH }
  if (!onDevice) return { ...base, ok: false, detail: 'ไม่มีโมเดลถอดเสียง th-TH บนเครื่อง', fix: INSTALL_THAI }
  return { ...base, ok: true, detail: 'อนุญาตแล้ว · th-TH on-device' }
}

/** The `stt` row of `neo doctor`; with `fix` it first shows the system's Speech permission prompt. */
export async function sttRow(stt: Partial<SttDoctor>, { fix = false } = {}): Promise<DoctorRow> {
  const action = fix ? stt.authorize : stt.check
  if (!action) return { id: 'stt', ok: false, label: LABEL, detail: 'ไม่มีตัวถอดเสียง neo-stt', fix: 'สร้างด้วย cli/stt/build.sh' }
  try {
    return rowFor(await action.call(stt))
  } catch (e) {
    return { id: 'stt', ok: false, label: LABEL, detail: (e as Error).message, fix: 'สร้าง/ติดตั้ง neo-stt ด้วย cli/stt/build.sh แล้ว neo daemon restart' }
  }
}
