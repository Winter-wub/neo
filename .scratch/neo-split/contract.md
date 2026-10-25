# Current backend contract inventory (`app/*.js`, Node)

Checklist the NeoCli rewrite (Bun + TypeScript) must satisfy. Source = working tree on 2026-10-25.
Abbreviations: `S` = `app/server.js`, `P` = `app/pairing.js`, `V` = `app/voice.js`, `Sch` = `app/schedule.js`, `D` = `app/dream.js`, `Pr` = `app/providers.js`, `Di` = `app/discover.js`, `C` = `app/cards.js`, `M` = `app/neo-agents-mcp.js`.
Clients: NeoApp Kotlin under `android/app/src/main/java/com/mochi/companion/`; Neo Console Swift under `app/mac/Sources/`.

---

## 1. HTTP endpoints

### 1.1 Access rules (`P:8-62`, `S:605-607`, `S:636`)

| Rule | Definition |
|---|---|
| **local** | `isLocal(req)` (`P:13-18`): socket remote address is `127.0.0.1`/`::1`/`::ffff:127.0.0.1` **and** no proxy header (`x-forwarded-for`, `x-forwarded-host`, `x-real-ip`, `forwarded`, `cf-connecting-ip`, `true-client-ip`, `ngrok-trace-id`) **and** `Host` matches `localhost|127.0.0.1|[::1]` (optional port). Includes NeoApp over `adb reverse`. A tunnel (cloudflared/ngrok) into 127.0.0.1 counts as remote. |
| **app token** | If `NEO_APP_TOKEN` is set, local requests to paths **outside** `DEVICE_API ∪ OPEN_API` must send header `x-neo-token: <token>` (timing-safe compare, `P:53-54`); else `401 {error}`. If env is empty (dev), all local requests pass. Neo Console sends the header on every `API.call` (`Core.swift:172`). |
| **device token** | Remote requests (not local) to `DEVICE_API` need `Authorization: Bearer <48 hex>`; lookup by `sha256(token)` in devices.json (`P:39-44`). Missing/unknown → `401 "ยังไม่ได้จับคู่…"` (NeoApp treats 401 on `/api/events` as "unpaired", `Link.kt:115`). Paired device hitting a non-DEVICE_API path → `403`. |
| **open** | `OPEN_API = {/api/hello, /api/pair, /neo.apk}` (`P:9`): no auth from anywhere. |
| `DEVICE_API` | `/api/audio, /api/events, /api/arm, /api/cancel, /api/face, /api/hello, /api/alarm/stop, /api/dream/seen, /api/pet, /api/wakeup` (`P:8`). Local requests to these need no app token (so Neo Console's event stream, which sends no token, works — `Core.swift:188`). |
| server-side second gate | `S:636`: if not local, only `/api/audio, /api/events, /api/arm, /api/cancel, /api/alarm/stop, /api/dream/seen, /api/pet, /api/wakeup` pass beyond this line (`/api/hello`, `/api/pair`, `/neo.apk`, `GET /api/face` are handled above it). `localOnly()` (`S:607`) = `403 "ใช้ได้เฉพาะบน Mac"` when not local. |

Request bodies: JSON. Helper `body()` (`S:608`) caps at 20 000 bytes by **destroying the socket** (no response); empty body = `{}`; bad JSON = `400 {error}`. `/api/say` and `/api/ask` cap at 4 000. All JSON responses use `Content-Type: application/json; charset=utf-8`. Errors are `{error: "<Thai text>"}`.

### 1.2 Endpoint table

Caller column: **App** = NeoApp, **Con** = Neo Console, **—** = no client code calls it.

| # | Method + path | Caller | Access | Request | Response | Notes / side effects (events) | Ref |
|---|---|---|---|---|---|---|---|
| 1 | ANY `/neo.apk` | phone browser (link shown in Con pairing pane, `SettingsView.swift:242`) | open | — | APK bytes, `application/vnd.android.package-archive`, `Content-Disposition: attachment; filename="neo.apk"`; `404` text `no apk` | File = `NEO_APK` or `<repo>/mochi-debug.apk` | S:611-614 |
| 2 | ANY `/api/hello` | App (SetupActivity) | open | — | `{app:"neo", name, paired, face:{fg,accent,cheek,bg}}` | App only checks `200` and body contains `"neo"` (`SetupActivity.kt:78-79`). `paired` is effectively always `false` for remote callers (open path skips device lookup) | S:615 |
| 3 | POST `/api/pair` | App (SetupActivity) | open | `{code:"123456", name:"<MANUFACTURER MODEL>"}` | `200 {token, id, name:<pet name>}` / `400 {error}` | Emits `paired{name}`. App stores `token` and reads `name` (`SetupActivity.kt:86-88`) | S:616, P:27-37 |
| 4 | POST `/api/pair/start` | Con | local + app token | `{}` | `{code, expiresAt(ms), addresses:[{method,url,note}]}` | New code replaces any previous one | S:617, P:25, S:816-823 |
| 5 | GET `/api/devices` | Con | local + app token | — | `[{id,name,paired(ISO),lastSeen(ISO\|null)}]` | | S:618 |
| 5b | non-GET `/api/devices` | Con (revoke) | local + app token | `{id}` | `{ok:true}` | Emits `devices{}` | S:618 |
| 6 | GET `/api/face` | Con | local, or paired device | — | `{fg,accent,cheek,bg}` | Defaults `#7fffd4 #ff7aa8 #ff9a9a #000000` | S:619-620, S:319 |
| 6b | non-GET `/api/face` | Con | local only (no app token needed: path is in DEVICE_API) | partial `{fg?,accent?,cheek?,bg?}` (each must be `#rrggbb`) | merged face | Saves `state.face`; emits `face{fg,accent,cheek,bg}` | S:621-622, S:316 |
| 7 | GET `/api/wake` | Con | local + app token | — | `{name, variants[], training:{name,got[]}\|null}` | | S:626 |
| 7b | non-GET `/api/wake` | Con | local + app token | `{cancel:true}` → `{ok}`; `{name, variants[]}` → set directly → wake obj; `{name}` → start training → `{ok}` | | Set: emits `wake{name,variants}`. Train start emits `train{name,n:0}`; next 3 transcripts become variants (see §2). `cancel` unused by Con | S:627-632, S:429-434 |
| 8 | ANY `/api/doctor` | Con (onboarding) | local + app token | — | `[{id,ok,label,detail,fix?,optional?}]`, ids `node, claude, ffmpeg, stt, network, agents, phone` | Spawns `claude --version`; probes `127.0.0.1:8001/` | S:439-453, S:634 |
| 9 | GET / non-GET `/api/onboard` | Con | local + app token | POST `{done:bool}` | `{done}` | `state.onboarded` | S:635 |
| 10 | POST `/api/audio` | App | device token / local | endless raw PCM body (see §3) | `200 {ok:true}` only when the request ends | Exact `req.url` match (no query string allowed) | S:637-661 |
| 11 | GET `/api/events` | App + Con | device token / local | — | NDJSON stream (see §2) | Exact `req.url` match | S:662-670 |
| 12 | GET `/api/history` | Con | local + app token | — | `[event]` (≤400, in memory) | Con loads it once when its log is empty (`Store.swift:74`) | S:671, S:288 |
| 13 | GET `/api/status` | Con (every 3 s, `Store.swift:66`) | local + app token | — | `{phone(bool: any audio stream open), consoles(number of /api/events listeners — includes phones), provider(label), model, thinking, requireName, bypass, pet\|null, uptime(s), pid}` | | S:672-675 |
| 14 | GET `/api/settings` | Con | local + app token | — | `{requireName, followUp, bypass, tailscale, lan, addresses[], idle:{sleepAfter,clock}, dream}` | | S:677 |
| 14b | non-GET `/api/settings` | Con | local + app token | any subset `{requireName?, followUp?, bypass?, tailscale?, lan?, idle?:{sleepAfter?,clock?}, dream?}` | `{ok:true}` / `400` | `tailscale/lan` → `bindNetworks()` after 10 ms. `idle` → clamp `sleepAfter` 15..3600, emits `idle{sleepAfter,clock}`. `bypass` change resets every provider session + Claude convo. Always emits `settings{requireName,followUp,bypass}` | S:678-691 |
| 15 | GET `/api/models?name=<p>` | Con | local + app token | `name` defaults to current provider | `{name, mapped:[{alias,id}], list:[{id,name}], current, error?}`; `400 {error:"unknown"}` | May start an ACP agent + open a session to learn models (no prompt). Matched with `startsWith` | S:693-699 |
| 16 | POST `/api/model` | Con | local + app token | `{name?, model}` | `{ok:true}` / `400` | Saves `state.model[name]`; emits `model{name,model,id}` then `card{card}` | S:700-703, S:541-548 |
| 17 | GET `/api/providers/config` | Con | local + app token | — | `{_help?, default, providers:<merged discovered+config, each found?:true>, overrides:<raw providers.json providers>, discovered:[{name,label,type,available,via,registry,why}], keys:{<name>:bool}}` | Never returns key values | S:705 |
| 17b | non-GET `/api/providers/config` | Con | local + app token | `{name, cfg:{type,label,baseUrl,url,command,args,model,models,aliases,config,headers,…}, apiKey?}` or `{name, remove:true}` | `{ok:true}` / `400 {error}` | Validates name `^[a-z0-9][a-z0-9_-]{0,31}$`, type ∈ `claude-code\|acp\|openai\|http`. Writes providers.json; `apiKey` → `NEO_HOME/<name>.key` (0600) and `apiKeyFile:"~/…"`. For discovered agents only override keys kept. Cannot remove current provider. Emits `provider{name,label}` | S:560-580, S:706 |
| 18 | GET `/api/provider` | Con | local + app token | — | `{current, list:[{name,label,type,found,model}]}` | | S:710 |
| 18b | non-GET `/api/provider` | Con | local + app token | `{name}` | `{current}` / `400` | Saves `state.provider`; emits `provider{name,label}` then `card{card}` | S:711, S:531-539 |
| 19 | POST `/api/alarm/stop` | App (tap, body `{}`) | device / local | `{snooze?: minutes ≤60}` | `{stopped:bool}` | Emits `alarm_off{id,why:"แตะปิด"\|"เลื่อน",snooze?}`; snooze adds a one-off alarm | S:714, S:348-353 |
| 20 | POST `/api/pet` | App (≤1/min + after eating, `Brain.kt:83`) | device / local | `{hunger:0..1, affection:0..1}` | `{ok:true}` | Clamps, saves `state.pet{hunger,affection,at}`, emits `pet{…}` | S:715-718 |
| 21 | POST `/api/feed` | Con | local + app token | `{food:"fish"\|"cookie"\|"milk"}` | `{ok:true}` | Emits `feed{food}` (unknown → fish) | S:719 |
| 22 | POST `/api/wakeup` | App (tap out of deep sleep) | device / local | `{}` | `{ok:true}` | Cancels the 15-min deep-sleep dream timer; emits `wakeup{dreamCancelled}` | S:720 |
| 23 | POST `/api/sleep` | Con (menu) | local + app token | `{}` | `{ok:true}` | `deepSleep()`: emits `sleep`, dream after 15 min unless woken | S:721, S:370-374 |
| 24 | POST `/api/dream/seen` | App | device / local | `{}` | `{ok:true}` | Clears pending dream card; removes `undelivered` from last dream; trims dreams.jsonl to 200 | S:722, D:135-138 |
| 25 | GET `/api/schedule` | Con | local + app token | — | `{jobs:[job + next(ms\|null) + when(text)], ringing: job\|null}` | | S:724, Sch:176 |
| 25b | non-GET `/api/schedule` | Con | local + app token | one of: `{add:job}` → job (emits `schedule{action:"add",title,when}`); `{speech:"…"}` → `{preview:{…job,when}}` or `400`; `{update:id, enabled?,title?,prompt?,cron?,at?}` → job; `{remove:id}` → `{removed}`; `{test:id}` → fires now → `{ok}` / `404`; `{stop:true}` → `{stopped}` | `400 {error}` on invalid | `update`/`remove` emit nothing | S:725-735 |
| 26 | GET `/api/dream` | Con | local + app token | — | `{enabled, running, lastDream, last, profile[24 floats], quiet[hours], memory, facts:[{section,text,from:{at,dream}\|null}], dreams:[≤50 newest, without card], journal:<count>, entries:[≤300 newest first, +dreamed:bool], why:<reason\|null>}` | | S:738 |
| 26b | non-GET `/api/dream` | Con | local + app token | any of `{memory:str, facts:[{section,text}], forgetDream:at, clearDreams:true, forgetJournal:at, clearJournal:true, now:true}` | `{ok:true, running}` / `409` if `now` while dreaming | `now` starts a dream (async) | S:739-748 |
| 27 | POST `/api/say` | Con (typed command) | local + app token | `{text}` (≤300 chars used) | `{ok: text non-empty}` | Same path as a transcript (`onText`), so ringing/pet/wake-word rules apply; result arrives as events | S:750-754 |
| 28 | POST `/api/discover` | Con | local + app token | `{}` | `[{name, available}]` / `500` | Re-probes agents; emits `provider` | S:755, S:521-529 |
| 29 | POST `/api/arm` | App (tap face) | device / local | `{}` | `{ok:true}` | `dialog.arm()` (15 s window + listen mode) + activity | S:756 |
| 30 | POST `/api/cancel` | — (in DEVICE_API, but neither client calls it; cancel is by voice) | device / local | `{}` | `{cancelled:bool}` | `dialog.cancel()` → `cancelled` event | S:757-761 |
| 31 | POST `/api/ask` | App debug intent only (`MainActivity.kt:53-65`, `--es ask`) | local + app token (App sends no token → `401` whenever Neo Console runs the backend) | `{text}` | card JSON / `400 {error:"empty"}` / `409 {error:"interrupted"}` / `500 {error}` | Synchronous; bypasses Dialog: **no** `thinking`/`card` events, no journal entry, card **not** `humanize`d. Still emits `session`/`tool` | S:762-773 |
| — | anything else | | | | `404 {error:"not found"}` | | S:774 |

Count: 31 paths (39 method/path rows incl. 8 `b` rows) + 404 fallback.

---

## 2. NDJSON event stream (`GET /api/events`)

**Connection** (`S:662-670`): `200`, `Content-Type: application/x-ndjson; charset=utf-8`, `Cache-Control: no-cache`, one JSON object per `\n`. On connect the server writes:
1. `hello` (not via `emit`, no `at`, not in history);
2. if a dream card is pending (undelivered): `{type:"dream_done", card, at}` — repeated on **every** connect until `POST /api/dream/seen`;
3. then all live events; `{"type":"ping"}` every 15 s (no `at`).

**Every event from `emit()`** (`S:279-292`) gets `at` (ms) added, any `card` field is passed through `cards.humanize` (`C:85-112`). Events with types `rec|short|loud|ping|pet` are **not** stored in history; history is in-memory, last 400 (`S:288`). Broadcast to all listeners (phones and Console alike — no per-client filtering).

**emit() side effects** (`S:282-287`): `thinking` with text → remembers it as `lastAsk` + `dreamer.activity()`; `armed` → activity; `card` (non-dream) with `lastAsk` → journal record ok; `askerr`/`cancelled` with `lastAsk` → journal record ok=false.

**Clients**: NeoApp `Link.kt:108-126` (readTimeout 40 s, reconnect after 2 s, **skips any line containing the JSON string `"ping"`**, `Link.kt:119`), dispatch in `Brain.onServer` (`Brain.kt:382-421`) + `MainActivity.theme` (`MainActivity.kt:103-106`). While NeoApp is in deep sleep only `alarm, dreaming, dream_done, dream_fail, idle, hello, face` are processed (`Brain.kt:479`). Neo Console `Core.swift:182-203` (no token, timeout 40 s, reconnect 2 s) → `Store.handle` (`Store.swift:134-150`) + log rows (`ConsoleView.swift:86-118`); log hides `rec, short, loud, ping, hello, stt, listen_end, devices` (`Store.swift:131`).

| type | Fields (besides `type`, `at`) | Emitted by | NeoApp reacts | Neo Console reacts |
|---|---|---|---|---|
| `hello` | `thinking, provider(label), name, face{fg,accent,cheek,bg}, idle{sleepAfter,clock}, ringing(title\|null)` | S:664 on connect | sets `thinking`, clears offline sub, applies `idle`, applies/saves `face` | ignored (refreshes all on connect) |
| `ping` | — | S:667 every 15 s | skipped | skipped |
| `rec` | — | Segmenter start of speech V:34 | wake, "ได้ยินเสียง…", LISTEN mood | hidden |
| `short` | — | Segmenter, too little voice V:41 | clears "ได้ยินเสียง…" | hidden |
| `loud` | — | Segmenter spike (≥3 s apart) V:31 | startle | hidden |
| `stt` | — | transcribeSeg start S:586 | "กำลังฟัง…", curious | hidden |
| `nothing` | — | empty / non-Thai transcript S:597 | "(ไม่ได้ยินเป็นคำพูด)" | log chip |
| `stterr` | `error` | STT failure S:598 | "ถอดเสียงไม่สำเร็จ" | log chip |
| `heard` | `text` | Dialog V:117,124,125,128; ringing S:358-359; pet S:382-384 | subtitle, wake, mood from words | log bubble |
| `ignored` | `text` | Dialog while thinking V:119 | — | log bubble (struck) |
| `armed` | — | wake word alone V:131 | wake, listening sub, greet sound | log chip |
| `listen_end` | — | 15 s listen window expired S:298 | clears listening sub | hidden |
| `thinking` | `text` (question / plan / permission title) | Dialog.track V:142; permission approve V:117 / expire V:164 | thinking face, hides card | log chip |
| `session` | `fresh, turn, provider(label)` | askClaude S:175, Pr:107,141,167 | — | log chip |
| `tool` | `name, input` (Claude: JSON of tool input ≤300 chars; ACP: tool `kind`) | runClaude S:133 (also during dreams), ACP Pr:91 | sets "doing" label if thinking | log chip |
| `card` | `card` (§2.1) | Dialog V:148,150,161; `/api/model` S:701; `/api/provider` S:711 | shows card, plays `sounds` | log card; refreshes /api/dream |
| `askerr` | `error` | Dialog V:153 | confused | log chip; refresh dream |
| `cancelled` | — | Dialog V:124,167 | "ยกเลิกแล้ว", sad | log chip |
| `alarm` | `id, title, card` (big clock card, 90 s) | fireJob S:336 | exits deep sleep (+`/api/wakeup`), rings, shows card 125 s | plays `Glass` sound, refresh jobs |
| `alarm_off` | `id, why, snooze?` | stopAlarm S:351 | stops ringing, snooze sub | refresh jobs |
| `job` | `id, title` | scheduled task fire S:343 | wake, excited, "ถึงเวลา: title" | refresh jobs |
| `schedule` | `action:"add", title, when` | S:404, S:727 | — | refresh jobs |
| `sleep` | — | deepSleep S:372 | deep sleep, mic off | log chip |
| `wakeup` | `dreamCancelled` | `/api/wakeup` S:720 | — | log chip |
| `feed` | `food` | voice S:383, `/api/feed` S:719 | eat animation | log chip |
| `pet_ask` | — | voice "หิวไหม" S:384 | answers hunger | log chip |
| `pet` | `hunger, affection, at` | `/api/pet` S:717 | — | updates `status.pet` (and logs a raw `pet` chip each minute) |
| `dreaming` | `reason, entries` | D:87 | `dreaming=true` | log chip; refresh dream |
| `dream_done` | live: `dream, insights(count), card`; on connect: `card` only | D:99; S:665 | stores dream card, tells it when awake → `/api/dream/seen` | log chip; refresh dream |
| `dream_fail` | `error` | D:102 | `dreaming=false` | log chip; refresh dream |
| `train` | `name, n, text?` | wake training S:593, S:631 | — | appends to training dots |
| `wake` | `name, variants` | setWakeName S:433 | — | refresh wake |
| `provider` | `name, label` | S:526, S:536, S:579 | — | refresh providers |
| `model` | `name, model, id` | useModel S:546 | — | refresh models |
| `settings` | `requireName, followUp, bypass` | S:689 | — | refresh settings |
| `idle` | `sleepAfter, clock` | S:684 | applies sleep-after / clock face | log chip |
| `face` | `fg, accent, cheek, bg` | S:622 | applies + persists theme | sets face |
| `paired` | `name` | S:616 | — | closes pair sheet, refresh devices |
| `devices` | — | revoke S:618 | — | hidden, no refresh |

Count: 38 event types.

### 2.1 Card object (as delivered after `humanize`)
`{kind:"text"|"weather"|…, layout:"text"|"list"|"big"|"pixel", icon, title(≤30), big?(≤14), lines[≤14 × ≤40], items[≤14 {t≤40, v≤20}], emotion, sounds[], seconds, dream?:true}`; pixel: `+ w(4..64), h(4..48), palette{char:"#rrggbb"}(≤16), frames[[rows]](≤12), fps(1..12)`. NeoApp reads `kind, icon, title, lines, emotion, sounds(≤3 played), seconds (capped 90), layout, big, items[t,v], w,h,palette,frames,fps` (`Speech.kt:26-64`); Neo Console reads the same for display (`ConsoleView.swift:130-145`, `TimeViews.swift:256`). `kind:"confirm"` objects from providers are never sent raw — Dialog converts them via `confirmCard` (V:182).

---

## 3. Audio upload protocol (`POST /api/audio`)

| Aspect | Contract | Ref |
|---|---|---|
| Transport | One long HTTP POST, `Content-Type: application/octet-stream`, chunked (`setChunkedStreamingMode(3200)`), `connectTimeout 3 s`; auth header as §1.1. Body never ends while mic is on. Server sets `requestTimeout = 0` on every listener | Link.kt:77-92; S:777, S:790 |
| Samples | Raw PCM signed 16-bit little-endian, 16 000 Hz, mono, no header. App writes 100 ms (1600 samples, 3200 B) per `write`+`flush` | Link.kt:66-92 |
| Server framing | Re-buffers into exact 1600-sample frames regardless of chunk boundaries (`rest` buffer) | S:642-647 |
| Mute rule | While NeoApp plays its own sound and for 300 ms after, it sends **all-zero frames** (keeps stream alive). Server: an all-zero frame aborts any segment in progress and clears pre-roll | Link.kt:31,90-91; V:26-28 |
| Mic off (deep sleep) | App disconnects the upload; reconnects when mic back on. `phone` status = at least one open audio stream (`liveSegs.size>0`) | Link.kt:51,59; S:639,658 |
| Reconnect | On error: report `offline`, read-and-discard mic for 2 s, reconnect | Link.kt:95-96 |
| Multiple streams | Allowed; each gets its own `Segmenter`; listen mode applies to all | S:638-639, S:294-299 |
| Segmenting (VAD) | Adaptive noise floor (init 0.002, min 0.0003). Start when RMS > 3·floor+0.002 (emit `rec`), pre-roll 6 frames. Voiced if RMS > 2·floor+0.001. End after 9 quiet frames (0.9 s) or 120 frames (12 s). <3 voiced frames → `short`. `loud` when RMS−floor > 0.35, 3 s cooldown | V:5-46 |
| Listen mode | After wake word alone / tap (`/api/arm`): end after 30 quiet frames (3 s), max 1200 frames (2 min); trailing silence trimmed to 0.9 s; window 15 s then `listen_end` | V:9,38-40; S:294-299 |
| Long command split | Listened segments are split at pauses ≥8 frames (0.8 s) and each part transcribed separately, then joined with spaces | V:49-60; S:588-590 |
| Transcription queue | One at a time; while busy only the **latest** pending segment is kept (older ones dropped) | S:584-601 |
| STT pipeline | WAV (44-byte header) → `$TMPDIR/mochi-audio/seg{0..9}-raw.wav` → ffmpeg normalize to `-norm.wav` (fallback raw) → Apple STT (`MOCHI_STT=apple`, default) else / on failure `whisper-cli` | S:232-252 |
| Post-filter | `thaiOnly`: <2 Thai chars or more Latin/CJK/Cyrillic than Thai → `""` → `nothing`. Length ≤1 → `nothing` | S:255-258, S:597 |
| Then | Training mode consumes it (`train`), else `onText` → ringing words → pet words → `Dialog.onText` (wake word / armed window / follow-up 45 s / question heuristics when `requireName=false`) | S:387, S:592-597, V:114-137 |
| Response | `200 {ok:true}` on request end (App ignores, reads `responseCode` only) | S:659 |

---

## 4. NEO_HOME files (`NEO_HOME` = `~/Library/Application Support/Neo` under Neo Console; default `~/.config/neo`)

| File | Owner | Format / mode | Shape (redacted) | Ref |
|---|---|---|---|---|
| `state.json` | server.js | JSON (indent 1), 0600, rewritten whole | `{model:{<provider>:<alias\|id\|null>}, provider, face:{fg,accent,cheek,bg}, wake:{name, variants[≤20]}, requireName, followUp, bypass, tailscale, lan, idle:{sleepAfter,clock}, dream, onboarded, pet:{hunger,affection,at}}` — all keys optional | S:307-314, S:430, S:622, S:635, S:680-687, S:717 |
| `devices.json` | pairing.js | JSON (indent 1), 0600 | `{"<sha256(token) 64 hex>": {id:<first 12 hex of sha>, name, paired:ISO, lastSeen:ISO\|null}}` — raw tokens never stored | P:22-46 |
| `schedule.json` | schedule.js | JSON array (indent 1), 0600 | `[{id:<8 base36>, kind:"alarm"\|"task", title(≤80), enabled, prompt?(≤1000, task), at?(ms) \| cron?("m h dom mon dow"), last?(ms)}]` | Sch:165-210 |
| `journal.jsonl` | dream.js | JSONL append, 0600 | `{at, q(≤400), a(≤600), ok}`; trimmed to 2000 lines with 2 % probability per append | D:53-58 |
| `memory.md` | dream.js | Markdown, 0600 | `## Section` + `- fact` lines; ≤3000 chars from dreams, ≤6000 when written by user | D:62-63, D:119-123 |
| `dreams.jsonl` | dream.js | JSONL, 0600 | `{at, reason, took(ms), entries, dream(≤120), insights:[{q,finding}](≤5), patterns[](≤5), added[], removed[], card, undelivered?:true}` | D:95-96 |
| `activity.json` | dream.js | JSON, 0600 | `{hours:[168 ints, dow*24+hour], since, last, lastDream, enabled, lastCount}` | D:20-34 |
| `providers.json` | server.js (path = `NEO_PROVIDERS`; Console points it into NEO_HOME) | JSON (indent 2), default mode (0644 observed) | `{_help?, default:"claude", providers:{<name>:{type?, label?, command?, args?, baseUrl?, url?, model?, models?:{alias:id}, aliases?[], config?:{mode,…}, apiKeyEnv?, apiKeyFile?:"~/…", headers?, _note?}}}` | S:304-305, S:560-575; app/providers.json |
| `<name>.key` (e.g. `openrouter.key`) | server.js | text + `\n`, 0600 | API key string (never returned by API; `keys:{name:bool}` only) | S:571, Pr:120-124 |
| `tasks/` | server.js (`NEO_TASKS`) | dir | cwd for claude / ACP / skill runs; files the agent creates | S:188-190, S:492 |

Outside NEO_HOME but owned by the backend: `$TMPDIR/neo-mcp.json` (0600, contains MCP server configs **with tokens** copied from Claude Code's `.claude.json`, rewritten at every start, S:67-78); `$TMPDIR/mochi-audio/seg{0-9}-{raw,norm}.wav` (last 10 segments, S:231-235). Neo Console owns `~/Library/Logs/Neo/server.log` (stdout/stderr of the backend) and the one-time migration from `~/.config/neo` (`Core.swift:19-34`).

Observed on this Mac: the live `providers.json` still has `apiKeyFile: "~/.config/neo/openrouter.key"` (legacy path) although a copy exists in NEO_HOME.

Count: 10 entries (9 files/patterns + `tasks/`).

---

## 5. Environment variables and launch arguments

### 5.1 What Neo Console passes (`Core.swift:62-85`)
`node <Resources>/server/server.js`, cwd `<Resources>/server`, stdout+stderr appended to `~/Library/Logs/Neo/server.log`. Before start: `lsof -tiTCP:8000 -sTCP:LISTEN` and SIGTERM every owner. Auto-restart 3 s after exit unless stopping. Token: 32 random bytes hex, new per Console launch.

### 5.2 Variables read

| Var | Default | Set by Console | Used for | Ref |
|---|---|---|---|---|
| `PORT` | 8000 | no | HTTP port (all listeners) | S:6 |
| `NEO_HOME` | `~/.config/neo` | `~/Library/Application Support/Neo` | data dir (0700) | S:307-308 |
| `NEO_PROVIDERS` | `app/providers.json` | `NEO_HOME/providers.json` | provider config | S:304 |
| `NEO_TASKS` | `<repo>/../neo-tasks` | `NEO_HOME/tasks` | agent cwd | S:188 |
| `NEO_APK` | `<repo>/mochi-debug.apk` | `Resources/neo.apk` | `/neo.apk` | S:612 |
| `NEO_APP_TOKEN` | `""` (no app-token check) | random hex | `x-neo-token` | S:315 |
| `NEO_PROVIDER` | — | no | startup provider override (before `state.provider`, `default`) | S:518 |
| `NEO_MCP` | `MCP_DOCKER,ccs-websearch` | no | which Claude Code MCP servers to copy | S:60 |
| `CLAUDE_CONFIG_DIR` | `~/.ccs/instances/personal` (user-specific!) | inherited | `.claude.json` source + env for `claude`/ACP | S:70, S:116 |
| `PATH` | — | login-shell PATH + `~/.local/bin:/opt/homebrew/bin:/usr/local/bin` | finding claude, ffmpeg, whisper-cli, agents, tailscale | Core.swift:43-51 |
| `MOCHI_STT` | `apple` | no | `apple` \| `whisper` | S:9 |
| `MOCHI_WHISPER_MODEL` | `<repo>/../models/ggml-large-v3-turbo-q5_0.bin` if exists else `ggml-small.bin` | no | whisper model | S:7-8 |
| `MOCHI_CITY`, `MOCHI_LAT`, `MOCHI_LON` | `กรุงเทพฯ`, 13.75, 100.52 | no | home weather location | S:10-11 |
| `<cfg.apiKeyEnv>` (e.g. `OPENROUTER_API_KEY`) | — | inherited | provider key (wins over `apiKeyFile`) | Pr:121 |
| `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` | — | **removed** by Console | also stripped for ACP agents | Core.swift:76, S:487 |
| `ORCA_BIN`, `EGO_BIN` | `/Applications/Orca.app/.../orca` or `orca`; `~/.local/bin/ego-browser` or `ego-browser` | no | used inside the MCP server | M:9, M:18 |
| `TMPDIR` (via `os.tmpdir()`) | system | inherited | neo-mcp.json, mochi-audio, default claude cwd | S:67, S:231 |

Count: 17 rows (19 names).

---

## 6. External processes spawned

| Process | When | Command / flags | I/O handling | Cancel / timeout | Ref |
|---|---|---|---|---|---|
| `claude` (ask, bypass on — default) | each question via Claude Code provider | `claude -p --output-format stream-json --verbose [--model M] --permission-mode bypassPermissions --add-dir $HOME --mcp-config $TMPDIR/neo-mcp.json [--resume <session>]`, cwd `NEO_TASKS`, env + `CLAUDE_CONFIG_DIR` | Prompt on **stdin** (flags with multi-values would swallow argv prompt). Parse stdout NDJSON: any `session_id` → session; `type:"assistant"` → each `tool_use` content → `tool` event; `type:"result"` → `result` text. Close without result → error `no result`. Result text → first `{…}` JSON → card / intent | timeout 15 min → `kill()` (SIGTERM) + `timeout`. Cancel: new question, cancel word, `/api/cancel` → kill + `interrupted`. Session resumed unless idle >15 min or 20 turns or "เริ่มใหม่" | S:119-144, S:172-185 |
| `claude` (ask, bypass off) | same | `… [--model M] --strict-mcp-config --mcp-config <file> --tools WebSearch,WebFetch,Skill --allowedTools WebSearch,WebFetch,mcp__ccs-websearch,mcp__neo-agents,mcp__MCP_DOCKER__<24 read tools>,Skill [--resume]` | same | 120 s | S:61-66, S:180 |
| `claude` (skill run after "ตกลง") | confirm card accepted | `… --model sonnet --permission-mode bypassPermissions` (no MCP, no resume) | same; non-JSON result → text card | 15 min; tracked as `current` (cancellable) | S:189-203 |
| `claude` (dream) | Dreamer | `… [--model M]` + bypass flags (`--permission-mode bypassPermissions --mcp-config`) or read-only (`--strict-mcp-config --mcp-config --tools WebSearch,WebFetch --allowedTools …`) | same (its `tool` events are broadcast too) | 20 min; `track=false` → **not** killed by new questions | S:418-423 |
| ACP agent (`cfg.command cfg.args`) | provider type `acp` (discovered via acpx registry or configured) | long-lived child, cwd `NEO_TASKS`, env minus `CLAUDECODE*`. JSON-RPC 2.0 NDJSON on stdio: `initialize{protocolVersion:1, clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}}` → `session/new{cwd, mcpServers:[{name,command,args,env:[{name,value}]}]}` (from neo-mcp.json) → `session/set_config_option` for `cfg.config` + model (or `session/set_model` when agent returns `models`) → bypass: pick most-permissive mode (`/bypass/,/yolo/,/dont ask/,/full\|danger/,/build\|code\|act/,/accept/,/auto/`, excluding plan/read) via `set_config_option mode` or `session/set_mode` → `session/prompt{sessionId,prompt:[{type:"text",text}]}` | `session/update`: `agent_message_chunk` text accumulated; `tool_call` → `tool` event. `session/request_permission`: auto-allow if bypass, kind ∈ read/search/fetch/think, or title matches read tool names; else voice confirm card (30 s) → reply `{outcome:{outcome:"selected",optionId}}` or `cancelled`. Other agent→client requests → error -32601 | Cancel = `session/cancel` notification; `stopReason:"cancelled"` → `interrupted`. No prompt timeout. Process exit rejects pending, resets session; restarted lazily. Killed when its config is saved/removed | Pr:24-117 |
| ACP probe | startup + `/api/discover` | spawn each available registry agent, send `initialize` (id 1), stderr ignored | reads `result.agentInfo` (title/name → label) | 10 s then kill | Di:53-73 |
| `npm root -g` | startup (sync, blocks event loop) + each discover | `execFileSync` | finds acpx `dist/*.js`, regex-parses `AGENT_REGISTRY` / `ACP_ADAPTER_PACKAGE_RANGES`; `npx` commands resolved to installed bins | 8 s | Di:17-50, Di:75-85 |
| `ffmpeg` | each transcription | `-y -loglevel error -i raw.wav -af highpass=f=80,dynaudnorm=f=150:g=15:p=0.9 -ar 16000 -ac 1 norm.wav` | failure → use raw | 10 s | S:239 |
| Apple STT (HTTP, not spawned) | each transcription when `MOCHI_STT=apple` | `POST http://127.0.0.1:8001/stt?engine=sf&hints=<comma wake variants>` body WAV, `Content-Length` | `200 {text}` / non-200 `{error}` → fallback whisper. Server is **Neo Console's `SpeechService`** (`Core.swift:101-163`: SFSpeechRecognizer th-TH, on-device only, contextual hints + Jira/Confluence/ยกเลิก/สภาพอากาศ; errors 1110/203 → empty text). There is no `app/apple-stt/` (comment in S:260 is stale) | 15 s + bytes/64 ms | S:262-271 |
| `whisper-cli` | fallback / `MOCHI_STT=whisper` | `-m <model> -l th -nt -np -bs 5 -f <wav>` | strips `[...]`, collapses repeated sentence | 25 s + bytes/32 ms | S:241-246 |
| `claude --version` | `/api/doctor` | | | 8 s | S:440-446 |
| `tailscale status --json` | startup + every 60 s | binary from PATH or `/Applications/Tailscale.app/Contents/MacOS/Tailscale` | `Self.TailscaleIPs[ipv4]`, `Self.DNSName` (when `BackendState=Running`) for pairing addresses | 8 s | S:786, S:808-813 |
| `neo-agents` MCP server | spawned **by claude / ACP agents**, not by server.js | `{command: process.execPath (node), args:[app/neo-agents-mcp.js]}` written into neo-mcp.json | MCP stdio JSON-RPC: `initialize` (echo protocolVersion, default `2025-06-18`), `ping`, `tools/list`, `tools/call`. Tools (all read-only): `orca_agents{}`, `orca_agent_output{handle:/^term_/, lines 5..200}`, `orca_runs{}`, `orca_run_tasks{run_id:/^run_/}`, `browser_search{query}`, `browser_read{url}` (blocks localhost/private/.local hosts) | — | M:1-152, S:73 |
| ↳ `orca` CLI | from MCP tools | `terminal list --json`, `terminal read --terminal H --json`, `orchestration run-list/worker-list/task-list --run R --json` | | 20 s each | M:11-17, M:61-111 |
| ↳ `ego-browser nodejs` | from MCP tools | script on stdin (`taskSpace("neo-reader")`, goto, extract title/links/text ≤8000), marker `@@NEO@@<json>` | serialized queue (one tab) | 40 s kill | M:29-55 |
| Claude Code MCP servers (`MCP_DOCKER`, `ccs-websearch`) | spawned by claude / ACP | configs copied from `$CLAUDE_CONFIG_DIR/.claude.json` `mcpServers` | | | S:68-77 |

Count: 15 process rows (12 distinct executables + Apple STT HTTP + 2 Claude-spawned groups).

### 6.1 LLM output contract (prompt-defined, parsed by the backend)
One-line JSON. Cards: `{layout:"text|list|big|pixel", icon, title, big, lines[], items[{t,v}], emotion, sounds[], seconds 15–90}` (+ pixel fields). Intents: `{"intent":"schedule", kind, title, prompt, at:"YYYY-MM-DDTHH:mm" | cron}`, `{"intent":"weather", place, day:0|1|2}`, `{"intent":"skill", skill, plan, task}` (→ confirm card, then skill run). Parser takes the first `{…}` span (S:147-158); providers fall back to a text card (S:477). Dream prompt returns `{memory, insights[{q,finding}], patterns[], dream, card{title,lines}}` (D:161-177).

---

## 7. Other network calls, LAN exposure, pairing

| Item | Detail | Ref |
|---|---|---|
| Geocoding | `GET https://geocoding-api.open-meteo.com/v1/search?count=1&language=th&name=<q>`, 6 s, cached in memory forever (incl. misses) | S:20-26 |
| Forecast | `GET https://api.open-meteo.com/v1/forecast?latitude&longitude&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code&daily=weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`, 8 s. Weather questions skip the LLM entirely (regex `voice.isWeather`), place from `places.js` (77 provinces, aliases, 20 fixed spots) | S:29-55, app/places.js |
| OpenAI-compatible provider | `GET {baseUrl}/models` (10 s); `POST {baseUrl}/chat/completions {model, messages, temperature:0.3}` (120 s, abortable); `Authorization: Bearer <key>` + `cfg.headers`. History kept in memory | Pr:126-158 |
| HTTP provider | `POST {url} {text, prompt, sessionId, fresh, model}` → `{card}` or `{text\|reply}` (+ `sessionId`), 120 s | Pr:160-181 |
| Listeners | Always `127.0.0.1:PORT`. Plus one server per non-internal IPv4 interface address: CGNAT `100.64/10` = "tailscale" (on unless `state.tailscale===false`), others = "lan" (only if `state.lan===true`). Re-evaluated every 60 s and on settings change. No IPv6, no mDNS/Bonjour discovery | S:776-824 |
| Pairing addresses | `[{method:"Tailscale", url:"http://<MagicDNS>:PORT"}?, {method:"tailscale/VPN"\|"Wi-Fi/LAN", url:"http://<ip>:PORT"}…, {method:"USB", url:"http://localhost:PORT"}, {method:"URL ของคุณเอง", url:"https://…"}]` each with Thai `note` | S:816-823 |
| Pairing | Console `POST /api/pair/start` → 6-digit code (crypto random), valid 5 min, single use, max 5 attempts, one active code. Phone `GET /api/hello` then `POST /api/pair` → 24-byte hex token (48 chars); stored as sha256. Revoke by `id` | P:6, P:25-46 |
| NeoApp base URL | Entered host → `http://<host>:8000` unless it has scheme or port; USB = `http://localhost:8000` with empty token (needs `adb reverse tcp:8000 tcp:8000`, which Neo Console runs every 10 s when the `adbReverse` setting is on; default off) | SetupActivity.kt:63-75; NeoApp.swift:14, 78-92 |

---

## 8. Oddities and implicit behaviour a rewrite could miss

### 8.1 Protocol quirks to preserve (or consciously fix in both ends)
1. **NeoApp drops any event line containing the JSON string token `"ping"`** (`Link.kt:119`: `line.contains("\"ping\"")`), not only ping events — e.g. a card line, heard text or tool name that is exactly `ping`. Keep ping as `{"type":"ping"}` and be aware of the collision.
2. **Long-lived streams**: `/api/events` relies on a 15 s ping and clients' 40 s read timeout; `/api/audio` is an endless chunked request. Node has `requestTimeout=0`; Bun's `Bun.serve` default `idleTimeout` is 10 s (max 255) — must be raised/disabled or the event stream (15 s ping gap) will be cut.
3. Several routes match `req.url` **exactly** (query string breaks them): `/api/audio, /api/events, /api/history, /api/status, /api/settings, /api/model, /api/providers/config, /api/provider, /api/say, /api/discover, /api/arm, /api/cancel, /api/ask`. `/api/models` uses `startsWith`. Others strip the query.
4. Method laxness: `/api/hello`, `/neo.apk`, `/api/doctor` accept any method; for `/api/devices, /api/face, /api/wake, /api/onboard, /api/settings, /api/providers/config, /api/provider, /api/schedule, /api/dream` **any non-GET** is treated as the write.
5. `hello` and connect-time `dream_done` are written straight to the socket (no `at`, not in history). Pending dream card is re-sent on every connect until `/api/dream/seen`.
6. Events are broadcast identically to phones and Consoles; `/api/status.consoles` counts phone listeners too.
7. Body over the size cap destroys the socket without a response.
8. Neo Console's event stream sends no `x-neo-token`; it only works because `/api/events` is in `DEVICE_API`. Same for `POST /api/face` (local, no token needed — CSRF-reachable from a browser).
9. `/api/hello.paired` is always `false` for remote callers.

### 8.2 Dead or unread surface
- `POST /api/cancel`: no client calls it. `POST /api/ask`: only the NeoApp debug intent, which sends no token → `401` under Neo Console; response card is not humanized and no events/journal.
- `GET /api/face` from a paired device: allowed, unused (phone gets face via `hello`/`face` events).
- `/api/wake {cancel:true}`: unused by Console.
- Response fields nobody reads: `/api/pair.id`; `/api/hello.name/paired/face`; `hello.provider/name/ringing`; `devices` event (Console hides it and does not refresh); `session`, `schedule`, `provider`, `model`, `settings`, `train`, `wake`, `paired`, `pet`, `wakeup`, `ignored` are Console-only; `rec/short/loud/stt/listen_end/armed/sleep/pet_ask` are NeoApp-only (Console shows a few as chips).
- `job.notify` is set by speech/AI parsing but dropped by `Scheduler.add` (never persisted) (Sch:177-184 vs S:410, Sch:133).
- `devices.json.lastSeen` is updated in memory per request but only persisted when another pair/revoke saves the file (P:42 vs P:23).
- Weather card has `kind:"weather"` and no `layout` (clients default to text).
- Comment in S:260 and doctor fix text refer to `app/apple-stt` / NeoSTT.app, which no longer exist; STT lives in Neo Console.

### 8.3 Implicit timers / state machines

| Behaviour | Value | Ref |
|---|---|---|
| Scheduler tick | every 15 s; one-off jobs fire and are deleted; late by >30 min → deleted silently; cron fires once per matching minute (`last`) | Sch:173, 196-209 |
| Alarm ringing | auto-off after 2 min (`why:"หมดเวลา"`); voice "หยุด/ปิด/…" stops, "ขออีก N นาที" snoozes (default 5) — checked before everything else in `onText` | S:330-361 |
| Task job while busy | retried every 60 s, max 10 times, then dropped; runs via `dialog.ask("[งานตั้งเวลา …] prompt")` | S:341-346 |
| Dream check | every 5 min: enabled, not running/busy, ≥6 h since last dream, idle ≥45 min, new journal entries, and (quiet hour per 168-slot histogram, default 01–05 for first 3 days/<10 counts) or idle ≥3 h | D:6-9, D:25, D:44-79 |
| Deep sleep → dream | 15 min after `sleep` unless `/api/wakeup` | S:368-374 |
| Activity counting | slot +1 at most once per 10 min; on `thinking`, `armed`, `/api/arm` | D:31-35 |
| Conversation memory | new session after 15 min idle / 20 turns / "เริ่มใหม่…" phrases; non-LLM answers (weather, schedule, skill results) kept as up to 6 notes injected next turn | S:160-169, S:209-212, Pr:10 |
| Confirm windows | skill/schedule confirm 30 s; ACP permission 30 s; follow-up without wake word 45 s; armed window 15 s | V:8,10,93; S:478-481 |
| In-band voice commands (before the LLM) | reset convo, `ใช้โมเดล X` model switch, Thai schedule phrases, dream ask/now, `สลับไปใช้ X` provider switch, weather, feed/sleep/hungry (only after wake word or in armed window), wake training | S:205-227, S:363-386, S:592-596 |
| Network rebind | every 60 s | S:824 |
| History / logs | 400 events in memory; audio debug files rotate 10 in `$TMPDIR/mochi-audio`; journal trim 2 % chance; dreams trimmed to 200 on delivery | S:288, S:235, D:57, D:137 |
| Startup | writes neo-mcp.json, sync `npm root -g` + registry parse, async ACP probes (emits `provider`), scheduler `check()` immediately, binds networks | S:78, S:463, S:530, S:426 |
| Pending dream on boot | if newest dream has `undelivered`, it becomes `pending` | D:23 |

### 8.4 Rewrite gotchas specific to Bun/compiled binary
- MCP config uses `process.execPath` + path to `neo-agents-mcp.js`; in a `bun build --compile` binary that must become `neo <mcp-subcommand>`.
- `CLAUDE_CONFIG_DIR` default is a personal path (`~/.ccs/instances/personal`); a shipped NeoCli needs a real default (`~/.claude`?) — decision needed.
- Apple STT must be provided by NeoCli (per map) but today it is Neo Console's in-process `SpeechService` on port 8001 with Speech-framework permission tied to Neo Console's bundle id.
- Neo Console currently kills whatever listens on :8000 and restarts the backend 3 s after exit; with a LaunchAgent this supervision moves to launchd.

---

## Row counts
- §1 endpoints: 31 paths (39 method/path rows) + 404
- §2 event types: 38
- §4 NEO_HOME entries: 10 (+2 temp files, +1 log owned by Console)
- §5 env vars: 17 rows
- §6 processes: 15 rows
