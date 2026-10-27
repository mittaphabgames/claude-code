const T = {
  th: { heroTitle: 'ของขวัญที่ส่งต่อความรัก', heroSub: 'เขียนความในใจ ส่งเป็นซองจดหมายดิจิทัล หรือเลือกของขวัญให้คนพิเศษ', letterTag: 'ของขวัญออนไลน์ · ได้รับลิงก์ทันที', shipTag: 'จัดส่งถึงบ้าน', write: 'เขียนข้อความ', add: 'ใส่ตะกร้า', cart: 'ตะกร้าสินค้า', total: 'รวม', pay: 'ชำระเงิน', empty: 'ตะกร้าว่าง', name: 'ชื่อของคุณ', email: 'อีเมล (ใช้รับใบเสร็จ)', phone: 'เบอร์โทร', addr: 'ที่อยู่จัดส่ง', to: 'ถึง (ชื่อผู้รับ)', msg: 'ข้อความของคุณ', from: 'จาก (ชื่อของคุณ)', theme: 'สไตล์ซอง', cancel: 'ยกเลิก', addCart: 'ใส่ตะกร้า', added: 'เพิ่มลงตะกร้าแล้ว', mock: 'โหมดทดลอง: การชำระเงินยังเป็นการจำลอง', letterFor: 'จดหมายถึง', someone: 'คนพิเศษ', fail: 'เกิดข้อผิดพลาด', cur: '฿' },
  en: { heroTitle: 'Gifts that carry your love', heroSub: 'Write your heart out as a digital envelope, or pick a gift for someone special', letterTag: 'Online gift · instant link', shipTag: 'Delivered to your door', write: 'Write message', add: 'Add to cart', cart: 'Your cart', total: 'Total', pay: 'Pay now', empty: 'Your cart is empty', name: 'Your name', email: 'Email (for receipt)', phone: 'Phone', addr: 'Shipping address', to: 'To (recipient name)', msg: 'Your message', from: 'From (your name)', theme: 'Envelope style', cancel: 'Cancel', addCart: 'Add to cart', added: 'Added to cart', mock: 'Test mode: payments are simulated', letterFor: 'Letter to', someone: 'someone special', fail: 'Something went wrong', cur: '฿' },
}
let lang = localStorage.getItem('lang') || 'th'
let products = []
let cart = []
try { cart = JSON.parse(localStorage.getItem('cart') || '[]') } catch {}

const $ = s => document.querySelector(s)
const t = k => T[lang][k]
const fmt = n => t('cur') + n.toLocaleString()
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const save = () => { try { localStorage.setItem('cart', JSON.stringify(cart)) } catch {} }
const toast = m => { const e = $('#toast'); e.textContent = m; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2200) }
const prod = id => products.find(p => p.id === id)
const name = p => (lang === 'th' ? p.name_th : p.name_en)

function render() {
  document.documentElement.lang = lang
  $('#lang').textContent = lang === 'th' ? 'EN' : 'TH'
  document.querySelectorAll('[data-i18n]').forEach(e => (e.textContent = t(e.dataset.i18n)))
  document.querySelectorAll('[data-ph]').forEach(e => (e.placeholder = t(e.dataset.ph)))
  $('#grid').innerHTML = products.map(p => `
    <div class="card"><div class="thumb">${esc(p.emoji)}</div>
      <div class="info"><span class="tag">${p.kind === 'letter' ? t('letterTag') : t('shipTag')}</span>
      <h3>${esc(name(p))}</h3><p>${esc(lang === 'th' ? p.desc_th : p.desc_en)}</p><div class="price">${fmt(p.price)}</div>
      <button class="primary" data-act="${p.kind === 'letter' ? 'write' : 'add'}" data-id="${p.id}">${p.kind === 'letter' ? t('write') : t('add')}</button></div></div>`).join('')
  const lines = cart.filter(l => prod(l.id))
  const sum = lines.reduce((s, l) => s + prod(l.id).price * (l.qty || 1), 0)
  $('#cartBtn').textContent = `🛒 ${lines.reduce((s, l) => s + (l.qty || 1), 0)}`
  $('#total').textContent = fmt(sum)
  $('#shipFields').hidden = !lines.some(l => prod(l.id).kind === 'physical')
  $('#items').innerHTML = lines.length ? lines.map((l, i) => {
    const p = prod(l.id)
    const sub = p.kind === 'letter' ? `${t('letterFor')} ${esc(l.to || t('someone'))}` : fmt(p.price)
    const qty = p.kind === 'letter' ? '' : `<button data-q="-1" data-i="${i}">−</button><b>${l.qty}</b><button data-q="1" data-i="${i}">+</button>`
    return `<div class="row"><span>${esc(p.emoji)}</span><span class="n">${esc(name(p))}<small>${sub}</small></span>${qty}<button data-del="${i}">✕</button></div>`
  }).join('') : `<p style="color:var(--muted)">${t('empty')}</p>`
}

$('#grid').onclick = e => {
  const b = e.target.closest('button'); if (!b) return
  const id = Number(b.dataset.id)
  if (b.dataset.act === 'add') {
    const ex = cart.find(l => l.id === id)
    ex ? ex.qty++ : cart.push({ id, qty: 1 })
    save(); render(); toast(t('added'))
  } else {
    $('#cTitle').textContent = name(prod(id))
    $('#composer').dataset.id = id
    $('#composer').showModal()
  }
}
$('#cCancel').onclick = () => $('#composer').close()
$('#composeForm').onsubmit = () => {
  cart.push({ id: Number($('#composer').dataset.id), qty: 1, to: $('#cTo').value, from: $('#cFrom').value, message: $('#cMsg').value, theme: $('#cTheme').value })
  $('#composeForm').reset(); save(); render(); toast(t('added')); $('#cart').classList.add('open')
}
$('#items').onclick = e => {
  const b = e.target.closest('button'); if (!b) return
  if (b.dataset.del) cart.splice(Number(b.dataset.del), 1)
  if (b.dataset.q) { const l = cart[Number(b.dataset.i)]; l.qty = Math.min(20, Math.max(0, l.qty + Number(b.dataset.q))); if (!l.qty) cart.splice(Number(b.dataset.i), 1) }
  save(); render()
}
$('#lang').onclick = () => { lang = lang === 'th' ? 'en' : 'th'; try { localStorage.setItem('lang', lang) } catch {} render() }
$('#cartBtn').onclick = () => $('#cart').classList.add('open')
$('#closeCart').onclick = () => $('#cart').classList.remove('open')
$('#checkout').onsubmit = async e => {
  e.preventDefault()
  if (!cart.length) return toast(t('empty'))
  const btn = $('#pay'); btn.disabled = true
  try {
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('#name').value, email: $('#email').value, phone: $('#phone').value, address: $('#addr').value, items: cart }) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    cart = []; save()
    location.href = data.payUrl
  } catch (err) { toast(err.message || t('fail')); btn.disabled = false }
}

;(async () => {
  products = await (await fetch('/api/products')).json()
  const cfg = await (await fetch('/api/config')).json()
  if (cfg.mock) { $('#mock').hidden = false; $('#mock').textContent = t('mock') }
  render()
})()
