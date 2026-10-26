// Prompts live only in Brain. The request Animations sends when a tool has no pixel loop yet; the answer is a normal pixel card.
export const drawToolRequest = (tool: string) => `วาดแอนิเมชัน pixel art ขนาดเล็กวนซ้ำ สำหรับเครื่องมือชื่อ "${tool}" ให้เห็นว่าเครื่องมือนี้กำลังทำอะไร (เช่น ค้นหา = แว่นขยายส่าย, เบราว์เซอร์ = หน้าต่างเลื่อน, โค้ด = เคอร์เซอร์กะพริบ) ไม่มีตัวหนังสือในภาพ
ตอบเป็นการ์ด layout "pixel": w 24-48, h 24-32, palette ไม่เกิน 12 สี, frames 2-8 เฟรมที่วนต่อเนื่องกันได้, fps 3-6 วาดให้เต็มกรอบ จำได้ทันที ห้ามใช้เครื่องมือใด ๆ ตอบ JSON บรรทัดเดียว`
