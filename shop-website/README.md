# Love Shop

ร้านขายของขวัญออนไลน์ (ซองจดหมายความในใจ, การ์ดดิจิทัล, สินค้าจัดส่ง) — Bun + SQLite ไม่มี dependency เพิ่ม

## รัน
```bash
cp .env.example .env   # แก้ค่าต่างๆ
bun run start          # http://localhost:3000
bun test
```

- ไม่ตั้ง `STRIPE_SECRET_KEY` = โหมดทดลอง (ปุ่มจำลองจ่ายเงิน, ปิดอัตโนมัติเมื่อ NODE_ENV=production)
- ชำระเงินจริง: สร้างบัญชี Stripe เปิด PromptPay, ใส่ `STRIPE_SECRET_KEY`, และตั้ง webhook ไปที่ `BASE_URL/api/stripe/webhook` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`) แล้วใส่ `STRIPE_WEBHOOK_SECRET`
- หลังบ้าน: `/admin` (user `admin`, รหัส `ADMIN_PASSWORD`) — จัดการสินค้า ดูออเดอร์
- ผู้ซื้อได้ลิงก์จดหมาย `/l/<token>` ที่หน้าสถานะออเดอร์หลังจ่ายเงิน (ยังไม่ส่งอีเมลอัตโนมัติ)
