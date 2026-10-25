#!/usr/bin/env python3
"""สร้าง app/src/main/assets/envelopes.json: ความดังสูงสุด (0..100 %) ทุก 20 ms ของเสียงร้องแต่ละไฟล์
ใช้ขยับปากตอนเล่นเสียง (แทน AnalyserNode ของเว็บ) — แนวเดียวกับ voice-samples/mouth_envelope.py
รัน: python3 tools/make_envelopes.py   (ต้องมี ffmpeg)"""
import array, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOUNDS = os.path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'sounds')
OUT = os.path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'envelopes.json')
RATE, STEP_MS = 16000, 20


def peaks(path):
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 's16le', '-'],
                         check=True, capture_output=True).stdout
    pcm = array.array('h'); pcm.frombytes(raw)
    hop = RATE * STEP_MS // 1000
    return [round(100 * max(abs(v) for v in pcm[i:i + hop]) / 32768) for i in range(0, len(pcm), hop)]


def main():
    out = {'stepMs': STEP_MS, 'sounds': {}}
    for f in sorted(os.listdir(SOUNDS)):
        if f.endswith('.mp3'):
            out['sounds'][f[:-4]] = peaks(os.path.join(SOUNDS, f))
    with open(OUT, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    for k, v in out['sounds'].items():
        print(f'{k:28s} {len(v) * STEP_MS / 1000:5.2f}s peak {max(v)}%', file=sys.stderr)


if __name__ == '__main__':
    main()
