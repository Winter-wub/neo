// Finds the place and the day in a Thai weather question (ported from app/places.js). No Brain, no quota.

/** The 77 provinces, spelled the way the geocoder knows them. */
export const PROVINCES = ['กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท',
  'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช',
  'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี',
  'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม',
  'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ',
  'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี',
  'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี']
const ALIASES: Record<string, string> = {
  'กรุงเทพ': 'กรุงเทพมหานคร', 'กทม': 'กรุงเทพมหานคร', 'โคราช': 'นครราชสีมา', 'อยุธยา': 'พระนครศรีอยุธยา', 'อุบล': 'อุบลราชธานี',
  'อุดร': 'อุดรธานี', 'สุราษฎร์': 'สุราษฎร์ธานี', 'สุราษ': 'สุราษฎร์ธานี', 'นครศรี': 'นครศรีธรรมราช', 'ประจวบ': 'ประจวบคีรีขันธ์', 'โคราด': 'นครราชสีมา',
}
/** Trip spots the geocoder cannot find or puts in the wrong place (it says "เขาใหญ่" is Uthai Thani). Coordinates checked by hand. */
const SPOTS: Record<string, [lat: number, lon: number, name: string]> = {
  'เขาใหญ่': [14.44, 101.37, 'เขาใหญ่'], 'ปาย': [19.36, 98.44, 'ปาย'], 'หัวหิน': [12.57, 99.96, 'หัวหิน'], 'พัทยา': [12.93, 100.88, 'พัทยา'],
  'เกาะสมุย': [9.51, 100.01, 'เกาะสมุย'], 'สมุย': [9.51, 100.01, 'เกาะสมุย'], 'เกาะช้าง': [12.05, 102.33, 'เกาะช้าง'], 'เกาะเต่า': [10.09, 99.84, 'เกาะเต่า'],
  'พีพี': [7.74, 98.77, 'เกาะพีพี'], 'เกาะล้าน': [12.92, 100.78, 'เกาะล้าน'], 'เชียงคาน': [17.90, 101.67, 'เชียงคาน'], 'ดอยอินทนนท์': [18.59, 98.49, 'ดอยอินทนนท์'],
  'บางแสน': [13.28, 100.91, 'บางแสน'], 'อัมพวา': [13.43, 99.95, 'อัมพวา'], 'หาดใหญ่': [7.01, 100.48, 'หาดใหญ่'], 'เกาะลันตา': [7.62, 99.07, 'เกาะลันตา'],
  'ภูทับเบิก': [16.91, 101.08, 'ภูทับเบิก'], 'เขาค้อ': [16.63, 101.00, 'เขาค้อ'], 'วังน้ำเขียว': [14.42, 101.85, 'วังน้ำเขียว'], 'ชะอำ': [12.80, 99.97, 'ชะอำ'],
}
/** Names that are also common words ("เลย" = very, "ตาก" = to dry): they need a cue that says "a place". */
const AMBIGUOUS = new Set(['เลย', 'ตาก', 'แพร่', 'ตรัง', 'น่าน'])
const AMBIGUOUS_CUE = /(?:ที่|จังหวัด|จ\.|เมือง|ไป)\s?$/
const CUE = /(?:ที่|แถว|จังหวัด|จ\.|เมือง|ประเทศ|อำเภอ|อ\.|เกาะ|ไป|ใน)\s?/g
/** Words that end a place name that follows a cue. */
const STOP = /อากาศ|อากา|สภาพ|ฝน|ร้อน|หนาว|อุณหภูมิ|องศา|วันนี้|พรุ่งนี้|มะรืน|ตอนนี้|คืนนี้|เช้านี้|เย็นนี้|สัปดาห์|อาทิตย์|เป็น|ยังไง|อย่างไร|ไหม|มั้ย|บ้าง|จะ|ตก|มี|กี่|หรือ|ครับ|ค่ะ|คะ|นะ|ดี|ช่วง|ตอน|นีโอ|นี่โอ|ไง|ยัง|ได้|แล้ว|เลย|มาก|หน่อย|weather|\?|\s{2,}/i
const NOT_PLACE = /^(?:บ้าน|นี้|นั้น|ตรงนี้|แถวนี้|ข้างนอก|ทาง|วัน|ตอน|เวลา|ช่วง)$/
const NOT_NAME_CHARS = /[^฀-๿A-Za-z\s.-]/g
const MIN_QUERY_AFTER_CUE = 2
const MIN_QUERY_GUESS = 3

export type Place =
  | { kind: 'fixed'; lat: number; lon: number; name: string }
  /** A province / a name after a cue: the geocoder's answer is used. */
  | { kind: 'province' | 'query'; query: string }
  /** Leftover words: used only when the geocoder's name matches them exactly. */
  | { kind: 'guess'; query: string }

/** 0 today, 1 tomorrow, 2 the day after. */
export function dayOf(text: string): 0 | 1 | 2 {
  return /มะรืน/.test(text) ? 2 : /พรุ่งนี้/.test(text) ? 1 : 0
}

/** The place the question is about; null means the home city. */
export function placeOf(text: string): Place | null {
  for (const [key, [lat, lon, name]] of Object.entries(SPOTS)) if (text.includes(key)) return { kind: 'fixed', lat, lon, name }
  const names = [...Object.keys(ALIASES), ...PROVINCES].sort((a, b) => b.length - a.length) // long names first
  for (const known of names) {
    const at = text.indexOf(known)
    if (at < 0) continue
    if (AMBIGUOUS.has(known) && !AMBIGUOUS_CUE.test(text.slice(0, at))) continue
    return { kind: 'province', query: ALIASES[known] ?? known }
  }
  for (const cue of text.matchAll(CUE)) {
    let rest = text.slice(cue.index + cue[0].length)
    const end = rest.search(STOP)
    if (end >= 0) rest = rest.slice(0, end)
    rest = rest.replace(/[^฀-๿A-Za-z\s.-]/g, '').trim()
    if (rest.length >= MIN_QUERY_AFTER_CUE && !NOT_PLACE.test(rest)) return { kind: 'query', query: rest }
  }
  for (const piece of text.split(new RegExp(STOP.source, 'gi'))) {
    const part = piece.replace(NOT_NAME_CHARS, '').trim()
    if (part.length >= MIN_QUERY_GUESS && !NOT_PLACE.test(part) && !AMBIGUOUS.has(part)) return { kind: 'guess', query: part }
  }
  return null
}
