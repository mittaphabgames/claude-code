import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'

process.env.DB_PATH = ':memory:'
process.env.ADMIN_PASSWORD = 'pw'
const { handle, verifyStripeSignature, esc } = await import('../server.ts')

const post = (path: string, body: unknown) =>
  handle(new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body) }))

describe('order flow', () => {
  test('letter is hidden until paid, then viewable and escaped', async () => {
    const res = await post('/api/orders', {
      name: 'A', email: 'a@b.co',
      items: [{ id: 1, to: 'B', from: 'A', message: '<script>x</script>รักนะ', theme: 'rose' }],
    })
    const { id, payUrl } = (await res.json()) as { id: string; payUrl: string }
    expect(payUrl).toContain('/pay/mock')

    const before = (await (await handle(new Request(`http://x/api/orders/${id}`))).json()) as { items: { letter_token: string | null }[] }
    expect(before.items[0]!.letter_token).toBeNull()

    await handle(new Request(`http://x/pay/mock?order=${id}`, { method: 'POST' }))
    const after = (await (await handle(new Request(`http://x/api/orders/${id}`))).json()) as { status: string; total: number; items: { letter_token: string }[] }
    expect(after.status).toBe('paid')
    expect(after.total).toBe(59)

    const page = await (await handle(new Request(`http://x/l/${after.items[0]!.letter_token}`))).text()
    expect(page).toContain('รักนะ')
    expect(page).not.toContain('<script>x')
  })

  test('server ignores client prices and validates input', async () => {
    const r = await post('/api/orders', { name: 'A', email: 'bad', items: [{ id: 1, message: 'hi' }] })
    expect(r.status).toBe(400)
    const noAddr = await post('/api/orders', { name: 'A', email: 'a@b.co', items: [{ id: 3, qty: 2, price: 1 }] })
    expect(noAddr.status).toBe(400)
    const ok = await post('/api/orders', { name: 'A', email: 'a@b.co', phone: '0', address: 'x', items: [{ id: 3, qty: 2, price: 1 }] })
    const { id } = (await ok.json()) as { id: string }
    const o = (await (await handle(new Request(`http://x/api/orders/${id}`))).json()) as { total: number }
    expect(o.total).toBe(1180)
  })

  test('unknown letter token 404s and admin needs auth', async () => {
    expect((await handle(new Request('http://x/l/nope'))).status).toBe(404)
    expect((await handle(new Request('http://x/admin/api/orders'))).status).toBe(401)
    const auth = { authorization: `Basic ${btoa('admin:pw')}` }
    expect((await handle(new Request('http://x/admin/api/orders', { headers: auth }))).status).toBe(200)
  })
})

describe('stripe signature', () => {
  const sig = (t: number, body: string, secret: string) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
  test('accepts valid, rejects tampered or stale', () => {
    const now = 1_000_000
    expect(verifyStripeSignature('{}', sig(now, '{}', 's'), 's', now)).toBe(true)
    expect(verifyStripeSignature('{"a":1}', sig(now, '{}', 's'), 's', now)).toBe(false)
    expect(verifyStripeSignature('{}', sig(now - 1000, '{}', 's'), 's', now)).toBe(false)
  })
  test('esc escapes html', () => expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;'))
})
