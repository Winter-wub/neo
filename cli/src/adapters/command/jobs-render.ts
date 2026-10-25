import type { JobDraft, JobInfo, JobProblem, NeoEvent } from '../../protocol'

type JobsEventType = 'alarm' | 'alarm_off' | 'job' | 'schedule' | 'jobs' | 'jobs_warning'
export type JobsEvent = Extract<NeoEvent, { type: JobsEventType }>
export const isJobsEvent = (event: NeoEvent): event is JobsEvent =>
  ['alarm', 'alarm_off', 'job', 'schedule', 'jobs', 'jobs_warning'].includes(event.type)

/** One line per job event for `neo events`. */
export function jobsEventLine(event: JobsEvent, time: string) {
  const row = (type: string, text: string) => `${time}  ${type.padEnd(9)} ${text}`.trimEnd()
  switch (event.type) {
    case 'alarm': return row('alarm', `${event.card.big ?? ''} ${event.title}`.trim())
    case 'alarm_off': return row('alarm_off', `${event.id} ${event.why}${event.snooze ? ` (อีก ${event.snooze} นาที)` : ''}`)
    case 'job': return row('job', event.title)
    case 'schedule': return row('schedule', `ตั้ง ${event.title} · ${event.when}`)
    case 'jobs': return row('jobs', 'รายการงานตั้งเวลาเปลี่ยน')
    case 'jobs_warning': return row('warning', event.problems.length ? `jobs.md อ่านไม่ออก: บรรทัด ${event.problems[0]!.line} ${event.problems[0]!.error}` : 'jobs.md อ่านได้แล้ว')
  }
}

const kindLabel = (kind: JobInfo['kind']) => (kind === 'task' ? 'งาน' : 'ปลุก')
const nextText = (next: number | null) => (next === null ? '—' : new Date(next).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }))

export function jobsMarkdown(list: { jobs: JobInfo[]; ringing: { id: string; title: string } | null; problems: JobProblem[] }) {
  const lines = ['# งานตั้งเวลา', '']
  if (list.ringing) lines.push(`🔔 กำลังปลุก: **${list.ringing.title}** (neo alarm stop · neo alarm snooze 5)`, '')
  if (list.problems.length) {
    lines.push('⚠️ jobs.md มีบรรทัดที่อ่านไม่ออก ใช้งานชุดเดิมต่อไปก่อน:', ...list.problems.map(p => `- บรรทัด ${p.line}: ${p.error} — \`${p.text}\``), '')
  }
  if (!list.jobs.length) lines.push('ยังไม่มีงานตั้งเวลา (neo jobs add "ปลุกพรุ่งนี้ตีห้าครึ่ง")')
  for (const job of list.jobs) {
    lines.push(`- ${job.enabled ? '' : '(ปิด) '}**${job.title}** · ${kindLabel(job.kind)} · ${job.when} · ครั้งถัดไป ${nextText(job.next)} · id \`${job.id}\``)
    if (job.prompt) lines.push(`  - ${job.prompt.split('\n')[0]}`)
  }
  return lines.join('\n')
}

export function draftMarkdown(draft: JobDraft) {
  return [`# ${draft.kind === 'task' ? 'งาน' : 'ปลุก'}: ${draft.title}`, '', `- **เมื่อ:** ${draft.when}`, ...(draft.prompt ? [`- **ให้ทำ:** ${draft.prompt}`] : [])].join('\n')
}

export const jobMarkdown = (job: JobInfo) => `${job.title} · ${job.when} · id \`${job.id}\``
