import type { AudioUpload, Phone } from './phone.ts'
import { phrase } from './pcm.ts'
import type { Backend } from './types.ts'

/** A phone with its mic on: one long /api/audio upload. say() makes the fake STT hear `text` for the next phrase. */
export class Mic {
  readonly upload: AudioUpload

  constructor(
    private backend: Backend,
    phone: Phone,
  ) {
    this.upload = phone.audio()
  }

  /** `quietFrames` > 30 ends a phrase in listen mode (after a tap or a bare wake word). */
  say(text: string, quietFrames = 11) {
    this.backend.stt.reply(text)
    this.upload.write(phrase(6, quietFrames))
  }

  close() {
    this.upload.destroy()
  }
}
