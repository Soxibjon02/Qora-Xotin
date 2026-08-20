# Nima tuzatildi?

## 1. "Server xatoligi" (500) — asosiy bug

**Sabab:** `api/game.ts` fayli Upstash Redis'ga (`Redis.fromEnv()`) bog'langan edi, lekin
Vercel loyihasida `UPSTASH_REDIS_REST_URL` va `UPSTASH_REDIS_REST_TOKEN` muhit
o'zgaruvchilari sozlanmagan edi. Natijada Redis so'rovi xato qaytarar, u esa
`catch` blokida ushlanib, foydalanuvchiga har doim `"Server xatoligi."` (HTTP 500)
qaytarilardi — xona yaratishda ham, qo'shilishda ham.

**Tuzatish:** Yangi `api/store.ts` qo'shildi — bu qatlam:
- Agar Upstash muhit o'zgaruvchilari **sozlangan bo'lsa** → haqiqiy Redis'dan foydalanadi
  (production uchun tavsiya etiladi — barqaror, ko'p-instansli ishlaydi).
- Agar **sozlanmagan bo'lsa** → avtomatik ravishda xotira (in-memory) zaxira tizimiga
  o'tadi, shunda loyiha hech qanday qo'shimcha sozlashsiz ham to'liq ishlaydi
  (masalan tez sinov yoki Upstash hali ulanmagan holatlar uchun).

`api/game.ts` ichidagi barcha `redis.get/set` chaqiruvlari shu yangi `store` orqali
ishlaydigan qilib almashtirildi. Shuningdek `join-room` amalidagi kichik xatolik
(agar `roomId` yuborilmasa server crash bo'lardi) ham tuzatildi.

### Production uchun tavsiya
Agar ko'plab foydalanuvchilar bilan barqaror ishlashi kerak bo'lsa (bir nechta server
instansiyasi/region bo'lsa), Vercel loyihangizda quyidagi muhit o'zgaruvchilarini
sozlang (Settings → Environment Variables):

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Bu qiymatlarni [upstash.com](https://upstash.com) da bepul Redis bazasi yaratib olishingiz mumkin.
Sozlamasangiz ham o'yin ishlayveradi (xotira rejimida), faqat serverless funksiya
"sovib" qayta ishga tushganda xonalar tarixi yo'qolishi mumkin.

## 2. To'liq tekshiruv

Avtomatik test skripti orqali quyidagi to'liq oqim tekshirildi (xotira rejimida,
Upstash sozlanmagan holatda ham):

1. Xona yaratish (host)
2. 2 ta o'yinchi qo'shilishi
3. Holatni so'rash (polling)
4. O'yinchilarning "tayyor" holatini almashtirish
5. O'yinni boshlash (kartalar taqsimlanishi, boshlang'ich juftliklar chiqarilishi)
6. Karta tortish siklini oxirigacha simulyatsiya qilish — o'yin to'g'ri tugaydi va
   mag'lub aniqlanadi
7. O'yinni qayta boshlash (restart)
8. O'yinchini chetlashtirish (kick) va uning kartalarini qayta taqsimlash
9. Xato holatlar (masalan roomId yuborilmasa to'g'ri 400 xatolik qaytishi)

Barcha bosqichlar muvaffaqiyatli o'tdi. TypeScript kompilyatsiyasi (`tsc --noEmit`)
va production build (`vite build`) ham xatosiz bajarildi.

## 3. Dizayn yangilanishi

`client/src/index.css`, `App.tsx` va `GameTable.tsx` fayllariga quyidagi zamonaviy
animatsiya va vizual effektlar qo'shildi (mavjud funksionallikka ta'sir qilmagan
holda):

- **Ambient orqa fon** — bosh menyu ekranida sekin suzib yuruvchi karta belgilari
  (♠♥♦♣) va yumshoq nurli "glow" effektlari
- **Sarlavha animatsiyasi** — "QORA XOTIN 👑" logotipida engil suzish va toj bobbing
  effekti
- **Tugmalar** — hover paytida yorqinlik "shine sweep" effekti, yuklanish paytida
  spinner animatsiyasi
- **Avatar tanlash** — har bir avatar ketma-ket (stagger) paydo bo'lishi, tanlanganda
  bounce effekti
- **Lobby** — o'yinchilar ro'yxati satrma-satr sirg'alib kirishi
  (slide-in)
- **O'yin stoli** — o'yinchi joylari aylana bo'ylab animatsiya bilan paydo bo'lishi,
  navbatdagi o'yinchi atrofida aylanuvchi oltin halqa (spinning ring)
- **Qo'ldagi kartalar** — tarqatilganda ketma-ket "dealt-in" animatsiyasi, Qora Xotin
  kartasi uchun doimiy nafas oluvchi (pulsing) porlash
- **Tortiladigan kartalar** — engil "shimmer sweep" yaltirash effekti va tortish
  vaqtida bosilmaydigan holat
- **Tortilgan karta ko'rsatilishi** — 3D flip (aylanish) animatsiyasi bilan ochiladi
- **Stol** — felt matoning yumshoq "nafas olish" (breathing glow) effekti

Barcha animatsiyalar `prefers-reduced-motion` sozlamasiga hurmat qiladi — agar
foydalanuvchi tizimida animatsiyalarni kamaytirish yoqilgan bo'lsa, ular avtomatik
o'chadi (mavjud kod bazasida bu qoida allaqachon bor edi, saqlab qolindi).

## Loyihani ishga tushirish

```bash
npm run install:all   # barcha (root, client, server) bog'liqliklarni o'rnatadi
npm run dev           # local: client (3000-port) + server (3001-port)
```

## Vercel'ga joylashtirish

1. Repozitoriyani Vercel'ga ulang (root papka bilan — `vercel.json` allaqachon bor)
2. **(Ixtiyoriy, lekin tavsiya etiladi)** Upstash Redis muhit o'zgaruvchilarini
   sozlang (yuqoriga qarang)
3. Deploy qiling — `npm run build` avtomatik ishlaydi, `dist/` papkasi serve qilinadi,
   `api/game.ts` esa serverless funksiya sifatida ishlaydi
