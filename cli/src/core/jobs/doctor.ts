import type { DoctorRow, JobProblem } from '../../protocol'

const LABEL = 'งานตั้งเวลา (jobs.md)'

/** The `jobs` row of `neo doctor`: ok, or the lines of jobs.md Neo cannot read. */
export function jobsRow(problems: readonly JobProblem[], jobCount: number): DoctorRow {
  if (!problems.length) return { id: 'jobs', ok: true, label: LABEL, detail: jobCount ? `อ่านได้ ${jobCount} งาน` : 'อ่านได้ (ยังไม่มีงาน)' }
  const lines = problems.slice(0, 5).map(p => `บรรทัด ${p.line}: ${p.error} — ${p.text}`)
  const more = problems.length > 5 ? [`… และอีก ${problems.length - 5} บรรทัด`] : []
  return {
    id: 'jobs', ok: false, label: LABEL,
    detail: ['อ่าน jobs.md ไม่ได้ ใช้งานชุดเดิมต่อไปก่อน', ...lines, ...more].join('\n'),
    fix: 'แก้บรรทัดดังกล่าวใน jobs.md (neo jobs edit) Neo จะโหลดใหม่เอง',
  }
}
