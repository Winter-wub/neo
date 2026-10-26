import type { AnimationInfo, ToolAnimation } from '../../protocol'

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { hour12: false })

export const animationLine = (a: AnimationInfo) => `- ${a.tool} — ${a.w}×${a.h} · ${a.frames} เฟรม · ${a.fps} fps · ${a.createdBy || '?'} · ${when(a.at)}`

export function animationListMarkdown(list: AnimationInfo[]) {
  return list.length ? list.map(animationLine).join('\n') : '(ยังไม่มี — Neo วาดให้เองเมื่อใช้เครื่องมือใหม่ครั้งแรก)'
}

/** The first frame as blocks, so a terminal shows roughly what the phone will play. */
export function animationMarkdown(a: ToolAnimation) {
  const picture = (a.frames[0] ?? []).map(row => [...row].map(ch => (ch === '.' ? '  ' : '██')).join('').trimEnd())
  return [animationLine({ ...a, frames: a.frames.length }), '', ...picture].join('\n')
}
