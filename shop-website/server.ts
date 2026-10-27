import { Database } from 'bun:sqlite'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const PORT = Number(process.env.PORT ?? 3000)
const BASE_URL = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '')
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? ''
const STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET ?? ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''
const MOCK_PAY = !STRIPE_KEY && process.env.NODE_ENV !== 'production'

export const db = new Database(process.env.DB_PATH ?? './shop.db', { create: true })
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('letter','physical')),
  name_th TEXT NOT NULL, name_en TEXT NOT NULL,
  desc_th TEXT NOT NULL DEFAULT '', desc_en TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price > 0),
  emoji TEXT NOT NULL DEFAULT '🎁',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL,
  stripe_session TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  letter_token TEXT UNIQUE,
  to_name TEXT, from_name TEXT, message TEXT, theme TEXT,
  opened_at TEXT
);
`)

if (!db.query('SELECT 1 FROM products LIMIT 1').get()) {
  const ins = db.prepare(
    'INSERT INTO products (kind,name_th,name_en,desc_th,desc_en,price,emoji) VALUES (?,?,?,?,?,?,?)',
  )
  ins.run('letter', 'ซองจดหมายความในใจ', 'Heartfelt Letter Envelope', 'เขียนความในใจ ส่งเป็นลิงก์ซองจดหมายดิจิทัลให้คนพิเศษเปิดอ่าน', 'Write your feelings and send a digital envelope link for someone special to open.', 59, '💌')
  ins.run('letter', 'การ์ดอวยพรดิจิทัล', 'Digital Greeting Card', 'การ์ดสวยๆ พร้อมข้อความของคุณ ส่งได้ทันทีหลังชำระเงิน', 'A pretty card with your message, ready to share right after payment.', 39, '🎴')
  ins.run('physical', 'ช่อกุหลาบสีแดง', 'Red Rose Bouquet', 'ช่อกุหลาบสดจัดส่งถึงบ้าน', 'Fresh rose bouquet delivered to the door.', 590, '🌹')
}

const THEMES = ['rose', 'night', 'sky'] as const
const json = (data: unknown, status = 200) => Response.json(data, { status })
const err = (message: string, status = 400) => json({ error: message }, status)
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const esc = (v: string) =>
  v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

type Product = { id: number; kind: 'letter' | 'physical'; name_th: string; name_en: string; desc_th: string; desc_en: string; price: number; emoji: string; active: number }

function markPaid(orderId: string): void {
  db.query("UPDATE orders SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(orderId)
}

export async function createOrder(body: Record<string, unknown>): Promise<Response> {
  const name = s(body.name, 100), email = s(body.email, 200), phone = s(body.phone, 30), address = s(body.address, 500)
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('กรุณากรอกชื่อและอีเมลให้ถูกต้อง')
  const raw = Array.isArray(body.items) ? body.items.slice(0, 20) : []
  if (!raw.length) return err('ตะกร้าว่าง')

  const lines: { p: Product; qty: number; letter?: { to: string; from: string; message: string; theme: string } }[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const p = db.query('SELECT * FROM products WHERE id=? AND active=1').get(Number(r.id)) as Product | null
    if (!p) return err('ไม่พบสินค้า')
    if (p.kind === 'letter') {
      const message = s(r.message, 3000)
      if (!message) return err('กรุณาเขียนข้อความในจดหมาย')
      const theme = (THEMES as readonly string[]).includes(String(r.theme)) ? String(r.theme) : 'rose'
      lines.push({ p, qty: 1, letter: { to: s(r.to, 100), from: s(r.from, 100), message, theme } })
    } else {
      const qty = Math.min(Math.max(Math.floor(Number(r.qty)) || 1, 1), 20)
      lines.push({ p, qty })
    }
  }
  if (lines.some(l => l.p.kind === 'physical') && (!address || !phone)) return err('สินค้าจัดส่งต้องกรอกเบอร์โทรและที่อยู่')

  const total = lines.reduce((t, l) => t + l.p.price * l.qty, 0)
  const id = randomBytes(8).toString('hex')
  db.transaction(() => {
    db.query('INSERT INTO orders (id,name,email,phone,address,total) VALUES (?,?,?,?,?,?)').run(id, name, email, phone, address, total)
    const ins = db.prepare('INSERT INTO order_items (order_id,product_id,qty,unit_price,letter_token,to_name,from_name,message,theme) VALUES (?,?,?,?,?,?,?,?,?)')
    for (const l of lines)
      ins.run(id, l.p.id, l.qty, l.p.price, l.letter ? randomBytes(16).toString('hex') : null, l.letter?.to ?? null, l.letter?.from ?? null, l.letter?.message ?? null, l.letter?.theme ?? null)
  })()

  if (MOCK_PAY) return json({ id, payUrl: `${BASE_URL}/pay/mock?order=${id}` })
  if (!STRIPE_KEY) return err('ยังไม่ได้ตั้งค่าระบบชำระเงิน', 503)

  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${BASE_URL}/order.html?id=${id}`,
    cancel_url: `${BASE_URL}/?cancelled=1`,
    customer_email: email,
    'metadata[order_id]': id,
    'payment_method_types[0]': 'promptpay',
    'payment_method_types[1]': 'card',
  })
  lines.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty))
    form.set(`line_items[${i}][price_data][currency]`, 'thb')
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.p.price * 100))
    form.set(`line_items[${i}][price_data][product_data][name]`, l.p.name_th)
  })
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const sess = (await res.json()) as { id?: string; url?: string }
  if (!res.ok || !sess.url) return err('สร้างหน้าชำระเงินไม่สำเร็จ', 502)
  db.query('UPDATE orders SET stripe_session=? WHERE id=?').run(sess.id ?? null, id)
  return json({ id, payUrl: sess.url })
}

export function verifyStripeSignature(payload: string, header: string, secret: string, now = Date.now() / 1000): boolean {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!t || Math.abs(now - t) > 300 || !parts.v1) return false
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest()
  const given = Buffer.from(parts.v1, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function stripeWebhook(req: Request): Promise<Response> {
  const payload = await req.text()
  if (!STRIPE_WHSEC || !verifyStripeSignature(payload, req.headers.get('stripe-signature') ?? '', STRIPE_WHSEC)) return err('bad signature', 400)
  const ev = JSON.parse(payload) as { type: string; data: { object: { payment_status?: string; metadata?: { order_id?: string } } } }
  const obj = ev.data.object
  if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && obj.payment_status === 'paid' && obj.metadata?.order_id)
    markPaid(obj.metadata.order_id)
  return json({ received: true })
}

function orderView(id: string) {
  const o = db.query('SELECT id,status,name,email,total,created_at FROM orders WHERE id=?').get(id) as Record<string, unknown> | null
  if (!o) return null
  const items = db.query('SELECT i.qty,i.unit_price,i.letter_token,i.to_name,p.name_th,p.name_en,p.emoji,p.kind FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=?').all(id) as Record<string, unknown>[]
  const paid = o.status === 'paid'
  return { ...o, items: items.map(i => ({ ...i, letter_token: paid ? i.letter_token : null })) }
}

const THEME_CSS: Record<string, string> = {
  rose: 'background:#fdeceb;--c:#b93f55;--p:#fff7f5',
  night: 'background:#1f2347;--c:#f3c969;--p:#2b3060;color:#fff',
  sky: 'background:#e6f2ff;--c:#3a6fb0;--p:#fff',
}
function letterPage(token: string): Response {
  const r = db.query("SELECT i.id,i.to_name,i.from_name,i.message,i.theme FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.letter_token=? AND o.status='paid'").get(token) as { id: number; to_name: string; from_name: string; message: string; theme: string } | null
  if (!r) return new Response('ไม่พบจดหมายนี้', { status: 404 })
  db.query('UPDATE order_items SET opened_at=COALESCE(opened_at,CURRENT_TIMESTAMP) WHERE id=?').run(r.id)
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>จดหมายถึงคุณ 💌</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;${THEME_CSS[r.theme] ?? THEME_CSS.rose}}
.env{cursor:pointer;font-size:6rem;text-align:center;animation:b 1.5s infinite}.env small{display:block;font-size:1rem;color:var(--c)}
@keyframes b{50%{transform:translateY(-8px)}}
.paper{display:none;max-width:560px;width:100%;background:var(--p);border-radius:16px;padding:32px;box-shadow:0 10px 40px #0002;line-height:1.9;white-space:pre-wrap}
.paper h2{margin:0 0 12px;color:var(--c)}.sig{margin-top:24px;text-align:right;color:var(--c);font-weight:700}
body.open .env{display:none}body.open .paper{display:block}</style></head>
<body onclick="document.body.classList.add('open')"><div class="env">💌<small>แตะเพื่อเปิดอ่าน</small></div>
<div class="paper"><h2>${r.to_name ? `ถึง ${esc(r.to_name)}` : 'ถึงคุณ'}</h2>${esc(r.message)}<div class="sig">${r.from_name ? `จาก ${esc(r.from_name)}` : ''}</div></div></body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer' } })
}

function adminAuthorized(req: Request): boolean {
  if (!ADMIN_PASSWORD) return false
  const h = req.headers.get('authorization') ?? ''
  if (!h.startsWith('Basic ')) return false
  const [, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':')
  const given = Buffer.from(rest.join(':')), want = Buffer.from(ADMIN_PASSWORD)
  return given.length === want.length && timingSafeEqual(given, want)
}

async function admin(req: Request, path: string): Promise<Response> {
  if (!ADMIN_PASSWORD) return new Response('ปิดหลังบ้าน: ตั้ง ADMIN_PASSWORD ก่อน', { status: 503 })
  if (!adminAuthorized(req)) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="admin"' } })
  if (path === '/admin') return new Response(Bun.file(new URL('./admin.html', import.meta.url).pathname))
  if (path === '/admin/api/orders') return json(db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all())
  if (path === '/admin/api/products' && req.method === 'GET') return json(db.query('SELECT * FROM products ORDER BY id').all())
  if (path === '/admin/api/products' && req.method === 'POST') {
    const b = (await req.json()) as Record<string, unknown>
    const kind = b.kind === 'physical' ? 'physical' : 'letter'
    const price = Math.floor(Number(b.price))
    if (!s(b.name_th, 100) || !(price > 0)) return err('ชื่อและราคาไม่ถูกต้อง')
    if (b.id) {
      db.query('UPDATE products SET kind=?,name_th=?,name_en=?,desc_th=?,desc_en=?,price=?,emoji=?,active=? WHERE id=?').run(kind, s(b.name_th, 100), s(b.name_en, 100) || s(b.name_th, 100), s(b.desc_th, 500), s(b.desc_en, 500), price, s(b.emoji, 8) || '🎁', b.active ? 1 : 0, Number(b.id))
    } else {
      db.query('INSERT INTO products (kind,name_th,name_en,desc_th,desc_en,price,emoji) VALUES (?,?,?,?,?,?,?)').run(kind, s(b.name_th, 100), s(b.name_en, 100) || s(b.name_th, 100), s(b.desc_th, 500), s(b.desc_en, 500), price, s(b.emoji, 8) || '🎁')
    }
    return json({ ok: true })
  }
  return err('not found', 404)
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  try {
    if (path === '/api/products') return json(db.query('SELECT id,kind,name_th,name_en,desc_th,desc_en,price,emoji FROM products WHERE active=1 ORDER BY id').all())
    if (path === '/api/config') return json({ mock: MOCK_PAY })
    if (path === '/api/orders' && req.method === 'POST') return createOrder((await req.json()) as Record<string, unknown>)
    if (path.startsWith('/api/orders/')) {
      const v = orderView(path.slice('/api/orders/'.length))
      return v ? json(v) : err('not found', 404)
    }
    if (path === '/api/stripe/webhook' && req.method === 'POST') return stripeWebhook(req)
    if (path === '/pay/mock' && MOCK_PAY) {
      const id = url.searchParams.get('order') ?? ''
      if (req.method === 'POST') {
        markPaid(id)
        return Response.redirect(`${BASE_URL}/order.html?id=${esc(id)}`, 303)
      }
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:16px;text-align:center"><h2>โหมดทดลอง</h2><p>ยังไม่ได้เชื่อม Stripe — ปุ่มนี้จำลองการจ่ายเงินสำเร็จ</p><form method="post"><button style="font-size:1.1rem;padding:12px 24px">จำลองจ่ายเงินสำเร็จ</button></form>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (path.startsWith('/l/')) return letterPage(path.slice(3))
    if (path.startsWith('/admin')) return await admin(req, path)

    const file = Bun.file(new URL(`./public${path === '/' ? '/index.html' : path}`, import.meta.url).pathname)
    if (!path.includes('..') && (await file.exists())) return new Response(file)
    return new Response('Not found', { status: 404 })
  } catch (e) {
    console.error(e)
    return err('เกิดข้อผิดพลาดในระบบ', 500)
  }
}

if (import.meta.main) {
  Bun.serve({ port: PORT, fetch: handle })
  console.log(`Love Shop → ${BASE_URL} ${MOCK_PAY ? '(โหมดชำระเงินทดลอง)' : ''}`)
}
