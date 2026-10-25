/** The STT seam: a WAV file in, the words out. Tests use a fake; the daemon uses the neo-stt helper. */
export interface Stt {
  /** `hints` are words the recogniser should favour (the pet's name, its spellings). Empty text = nothing recognised. */
  transcribe(wav: string, hints: string[]): Promise<string>
}

/** Speech permission as reported by the helper (`authorized`, `denied`, `restricted`, `notDetermined`). */
export interface SttPermission {
  status: string
  /** Whether the th-TH on-device model is available. */
  onDevice: boolean
}

/** What `neo doctor` needs from the helper. */
export interface SttDoctor {
  check(): Promise<SttPermission>
  /** Shows the system's Speech permission prompt if it has not been answered yet. */
  authorize(): Promise<SttPermission>
}
