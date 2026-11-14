<div align="center">

# Omborchi

**O‘zbekistondagi kichik va o‘rta biznes uchun ombor, kassa va hisobot tizimi:** oziq-ovqat do‘konlari, ulgurji savdo, dorixonalar, qurilish mollari do‘konlari.

[English](README.md) · **O‘zbekcha**

[![Jonli demo](https://img.shields.io/badge/jonli%20demo-xoliddev.github.io%2Fomborchi-0e6b73?style=flat-square)](https://xoliddev.github.io/omborchi/)
[![CI](https://github.com/xoliddev/omborchi/actions/workflows/ci.yml/badge.svg)](https://github.com/xoliddev/omborchi/actions/workflows/ci.yml)
[![Pages](https://github.com/xoliddev/omborchi/actions/workflows/pages.yml/badge.svg)](https://github.com/xoliddev/omborchi/actions/workflows/pages.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)
[![Litsenziya: MIT](https://img.shields.io/badge/litsenziya-MIT-lightgrey?style=flat-square)](LICENSE)

![Omborchi bosh sahifasi](docs/screenshots/dashboard.png)

</div>

## 10 soniyada sinab ko‘ring

**[xoliddev.github.io/omborchi](https://xoliddev.github.io/omborchi/)** havolasini oching. U yerda **Demo Market** ishlab turibdi: ikkita do‘kon, markaziy ombor, 300 ga yaqin mahsulot va 90 kunlik savdo tarixi.

Demo uchun server kerak emas. **PostgreSQL to‘g‘ridan-to‘g‘ri brauzeringizda ishlaydi** ([PGlite](https://pglite.dev), WebAssembly’ga kompilyatsiya qilingan Postgres) va alohida Web Worker ichida turadi. Haqiqiy server bilan **migratsiyalar, API handlerlar, zod validatsiya va domen yadrosi bir xil**. Siz qilgan savdolar IndexedDB’da saqlanadi, sahifani yangilasangiz ham yo‘qolmaydi. *Demo ma’lumotlarini tiklash* tugmasi do‘konni qaytadan yaratadi. *Kim sifatida* menyusi orqali egasi, menejer, kassir va omborchi rollari o‘rtasida almashib, har bir rol nimani ko‘rishini tekshirishingiz mumkin.

| Demoda haqiqiy | Demoda simulyatsiya |
|---|---|
| PostgreSQL sxemasi, triggerlar, cheklovlar, SQL hisobotlar | Payme / Click / Uzum tasdiqlari (`PaymentProvider` interfeysi; demodagi provayderlar to‘lovni darhol tasdiqlab, soxta raqam qaytaradi) |
| Ombor harakatlari jurnali, o‘rtacha tannarx, FEFO partiyalar, qarzlar va ularning muddati | Tizimga kirish (demoda foydalanuvchi almashtiriladi; serverda scrypt va httpOnly sessiya) |
| Rollar va omborlar bo‘yicha ruxsatlar (route qatlamida tekshiriladi) | 90 kunlik tarixni odam kiritmagan, uni haqiqiy ledger kodi generatsiya qiladi |
| Kassa, qaytarish, ko‘chirish, inventarizatsiya, buyurtmalar, import/eksport, chek chop etish | Kamera orqali shtrix-kod o‘qish `BarcodeDetector`’ni qo‘llaydigan brauzerda ishlaydi (Android’dagi Chrome/Edge, kompyuterdagi Chrome); boshqa brauzerlarda kodni qo‘lda kiritasiz |

<table>
<tr>
<td width="62%"><img src="docs/screenshots/pos.png" alt="Kassa ekrani, savat termochek ko‘rinishida"></td>
<td><img src="docs/screenshots/mobile.png" alt="375 px telefondagi bosh sahifa"></td>
</tr>
</table>

## Imkoniyatlar

- **Tashkilot va rollar.** Bitta tizimda bir nechta biznes ishlay oladi. Rollar: egasi, menejer, kassir, omborchi. Har bir xodimga faqat kerakli omborlarni ochib berish mumkin, ruxsatlar har bir so‘rovda serverda tekshiriladi.
- **Katalog.** Kategoriyalar istalgan chuqurlikda ichma-ich joylashadi, aylanma bog‘lanishga trigger yo‘l qo‘ymaydi. O‘lchov birliklari (dona, kg, m, l, quti…) o‘zaro aylantiriladi: masalan, 1 quti = 12 dona. Variantlar, SKU, EAN-13 / Code 128 shtrix-kodlar, do‘kon ichki EAN-13 kodini yaratish va yorliq chop etish. Chakana va ulgurji narxlar ro‘yxati.
- **Omborlar va qoldiq.** Do‘kon va omborlar soni cheklanmagan. Qoldiq **o‘zgartirib bo‘lmaydigan harakatlar jurnalida** yuritiladi: kirim, sotuv, qaytarish, ko‘chirish, hisobdan chiqarish, inventarizatsiya tuzatishi. Qoldiqni shu tranzaksiyaning o‘zida baza triggeri hisoblaydi, u hech qachon manfiy bo‘lmaydi.
- **Tannarx.** Sotilgan tovar tannarxi va yalpi foyda o‘rtacha tortilgan tannarx (WAC) bo‘yicha hisoblanadi; nega aynan shu usul ekanini pastda tushuntirganmiz. Partiyalarda yaroqlilik muddati bor, ular muddati eng oldin tugaydiganidan boshlab sotiladi (FEFO).
- **Xaridlar.** Yetkazib beruvchilar, buyurtmalar, tovarni qisman qabul qilish, yetkazib beruvchiga qarz va to‘lovlar.
- **Kassa.** Klaviatura va USB skaner bilan ishlashga moslangan: <kbd>F2</kbd> qidiruv, <kbd>Enter</kbd> qo‘shish, <kbd>F4</kbd> to‘lov, <kbd>F6</kbd> mijoz, <kbd>F7</kbd> chegirma, <kbd>F8</kbd> tozalash. Planshetda ham qulay. Qator va butun chekka chegirma, qadoq birliklari, aralash to‘lov (qaytimi bilan naqd, karta, Payme/Click/Uzum). Nasiya savdoda to‘lov muddati va ixtiyoriy kredit limiti bor. Smena yopilganda kassadagi naqd pul solishtiriladi. Chekni 58 yoki 80 mm qog‘ozga chop etish, ulashish yoki Telegram uchun nusxalash mumkin.
- **Inventarizatsiya (revizion).** Boshlanish paytidagi kutilgan qoldiq qayd qilib qo‘yiladi. Tovarlarni skaner bilan yoki qo‘lda sanaysiz. Kamomad, ortiqcha va aniqlik bo‘yicha hisobot chiqadi. Natija qo‘llanganda faqat topilgan farq yoziladi, shuning uchun sanash paytida bo‘lgan savdolar yo‘qolmaydi.
- **Ogohlantirishlar.** Do‘konlarda kamayib qolgan tovarlar. Muddati o‘tgan va tugayotgan partiyalar, ularni bir bosishda hisobdan chiqarish.
- **Hisobotlar.** Kunlik tushum va yalpi foyda, eng ko‘p sotilgan tovarlar, ABC tahlil, ombor va kategoriya bo‘yicha qoldiq qiymati, sotilmayotgan tovarlar, kassir smenalari, mijoz va yetkazib beruvchi qarzlarining muddati. Har bir hisobotda sana oralig‘ini tanlash va CSV / Excel’ga yuklab olish bor.
- **Import.** Mahsulotlarni Excel yoki CSV fayldan yuklash. Saqlashdan oldin har bir qator tekshiriladi: noma’lum birlik, EAN nazorat raqami xato, takroriy SKU yoki shtrix-kod. Boshlang‘ich qoldiqni ham shu fayl bilan kiritish mumkin.
- **Audit jurnali.** Har bir o‘zgarish kim tomonidan va qanday ma’lumot bilan qilingani yoziladi. Parollar yashiriladi, yozuvlarni tahrirlab bo‘lmaydi.
- **Til va format.** O‘zbek (lotin), rus va ingliz tillari. Summalar so‘mda formatlanadi, ish kuni Toshkent vaqti bilan hisoblanadi. Qorong‘i va yorug‘ mavzu. Ekran kengligi 375 px gacha moslashadi.

## Arxitektura

```mermaid
flowchart LR
  subgraph Brauzer
    UI["React SPA<br/>(Vite, TanStack Query)"]
    W["Web Worker<br/>(faqat demo build)"]
  end
  subgraph "packages/app — umumiy qatlam"
    R["Route jadvali<br/>zod · ruxsatlar · audit"]
    S["Servislar<br/>savdo · ombor · xarid · hisobot"]
  end
  CORE["packages/core<br/>ledger · WAC · narx · to‘lov<br/>qarz · ABC · FEFO · shtrix-kod"]
  DB[("PostgreSQL 16<br/>harakatlar jurnali + trigger")]
  PGL[("PGlite<br/>WASM’dagi Postgres · IndexedDB")]
  API["apps/api<br/>Fastify · scrypt sessiyalar"]

  UI -- "HTTP /api" --> API --> R
  UI -- "postMessage (demo)" --> W --> R
  R --> S --> CORE
  S -- "bir xil SQL" --> DB
  S -- "bir xil SQL" --> PGL
```

Har bir API amali `packages/app` ichida **faqat bir marta** yoziladi: nomi, metod va yo‘l, ruxsat, zod sxema, handler va audit amali. Fastify bu jadvaldan REST endpointlar yasaydi, demo worker esa `dispatch()`ni to‘g‘ridan-to‘g‘ri chaqiradi. Tiplangan klient (`api.call('sales.create', input)`) kirish va chiqish tiplarini shu jadvaldan oladi. Natijada interfeys, server va demo bir-biridan farq qilib qolmaydi.

```
packages/core   framework’siz domen mantiqi, I/O yo‘q (property-based testlangan)
packages/db     TS modul ko‘rinishidagi SQL migratsiyalar, kichik Db interfeysi, pg + PGlite adapterlari
packages/app    route jadvali, servislar, demo ma’lumot generatori
apps/api        Fastify server, autentifikatsiya, CLI (migrate / seed)
apps/web        React SPA; `--mode demo` GitHub Pages versiyasini yig‘adi
e2e             demo build ustida Playwright testlari
```

## Ma’lumotlar modeli

Har bir jadvalda `org_id` bor. Pul `numeric(18,2)`, miqdor `numeric(14,3)` (gramm va millimetrgacha aniq), birlik tannarxi `numeric(18,4)` turida saqlanadi. `stock_movements`, `debt_entries` va `audit_log` jadvallaridagi yozuvni o‘zgartirish yoki o‘chirishga trigger yo‘l qo‘ymaydi. `stock_drift` view jurnal bilan mos kelmaydigan qoldiqlarni ko‘rsatadi; testlar u har doim bo‘sh qolishini tekshiradi. To‘liq ER diagramma [inglizcha README](README.md#data-model)da.

## Muhim qarorlar

| Tanlov | Sababi |
|---|---|
| **Hamma joyda TypeScript, npm workspaces** | SQL natijasidan interfeysgacha bitta til. Domen yadrosi hech nimaga bog‘liq emas, shuning uchun Node’da, Web Worker’da va testlarda o‘zgarishsiz ishlaydi. |
| **React + Vite SPA** (Next.js emas) | Demo GitHub Pages’da serversiz ishlashi kerak. Statik SPA va worker bunga to‘liq yetadi. |
| **Fastify + zod** | Tez, tiplangan, ixcham. zod sxemalari umumiy route jadvalida turadi, shuning uchun server ham, demo ham bir xil tekshiradi. |
| **Oddiy SQL, migratsiyalar TS modul sifatida** (Drizzle/Kysely o‘rniga) | Bir xil migratsiya va so‘rovlar node-postgres’da ham, PGlite’da ham bajariladi. Yagona abstraksiya 20 qatorlik `Db` interfeysi (`query`, `exec`, `tx`). Hisobotlarda rekursiv CTE, window funksiyalar va `generate_series` ishlatilgan, ular SQL ko‘rinishida tushunarliroq. |
| **O‘rtacha tannarx (WAC)**, FIFO emas | O‘zbekistondagi buxgalteriya (1C’dagi "o‘rtacha tannarx") ham shunday hisoblaydi, raqamlar mos tushadi. Ko‘chirish, qaytarish va inventarizatsiya uchun tannarx qatlamlarini yuritish shart emas, natijada ledger’ning to‘g‘riligini isbotlash oson. Yaroqlilik muddati baribir partiya bo‘yicha (FEFO) alohida yuritiladi. |
| **Qoldiqni trigger hisoblaydi + `CHECK (qty >= 0)`** | Qoldiqning to‘g‘riligini ilova kodi emas, ma’lumotlar bazasining o‘zi kafolatlaydi. Bir vaqtda ikki kassir oxirgi tovarni sotmoqchi bo‘lsa, ikkinchisi qator qulfi bo‘shashini kutadi, kamaygan qoldiqni ko‘radi va rad etiladi. Servisda xato bo‘lsa ham ortiqcha sotib bo‘lmaydi. |
| **Sessiyalar Postgres’da, scrypt, httpOnly SameSite=Lax cookie** | Sessiyani bekor qilish mumkin. Native bog‘liqlik kerak emas (argon2 node-gyp talab qiladi). JSON bo‘lmagan so‘rovlar CSRF himoyasi sifatida rad etiladi. Kirish urinishlari soni cheklangan. |

## Ishga tushirish

### Docker (server + PostgreSQL 16)

```bash
cp .env.example .env            # POSTGRES_PASSWORD va DEMO_PASSWORD ni kiriting
docker compose up -d --build    # http://localhost:8080, biznesingizni ro‘yxatdan o‘tkazing
docker compose exec api node cli.mjs seed   # ixtiyoriy: Demo Market (owner@demo.uz / DEMO_PASSWORD)
```

### Ishlab chiqish uchun

```bash
npm ci
npm run dev:demo                # demo rejim: hammasi brauzerda, baza kerak emas
# yoki haqiqiy PostgreSQL bilan:
export DATABASE_URL=postgres://omborchi:change-me@localhost:5432/omborchi
npm run seed
npm run dev:api & npm run dev
```

### Muhit o‘zgaruvchilari

| O‘zgaruvchi | Standart qiymat | Vazifasi |
|---|---|---|
| `DATABASE_URL` | majburiy | PostgreSQL ulanish satri |
| `PORT` / `APP_PORT` | `3000` / `8080` | API porti / compose’da tashqariga ochiladigan port |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `omborchi` / — / `omborchi` | compose uchun baza ma’lumotlari |
| `COOKIE_SECURE` | `false` | HTTPS orqasida `true` qiling |
| `SESSION_TTL_DAYS` | `30` | Sessiya muddati (kun) |
| `ALLOW_REGISTRATION` | `true` | Yangi bizneslarning o‘zi ro‘yxatdan o‘tishiga ruxsat |
| `MIGRATE_ON_START` | `true` | Ishga tushganda migratsiyalarni qo‘llash |
| `DEMO_PASSWORD` | `demo12345` | `seed` yaratgan foydalanuvchilar paroli |

## Testlar

```bash
npm test            # domen yadrosi + servislar PGlite’da (property-based)
npm run test:api    # HTTP API + parallel savdolar PostgreSQL 16 da
npm run test:e2e    # demo build ustida Playwright (kompyuter + 375 px telefon)
npm run lint && npm run typecheck
```

| To‘plam | Testlar | Nimani tekshiradi |
|---|---|---|
| `packages/core` | 30 | fast-check bilan: **qoldiq hech qachon jurnaldan farq qilmaydi**, manfiyga tushmaydi, ko‘chirishda miqdor va qiymat saqlanadi, WAC kirim narxlari oralig‘ida qoladi, chek jami qatorlar yig‘indisiga teng, aralash to‘lov aniq taqsimlanadi, qarz muddatlari bo‘yicha guruhlar yig‘indisi qarzga teng, ABC to‘g‘ri, FEFO ortiqcha olmaydi. |
| `packages/app` | 20 | Haqiqiy SQL’da (PGlite): tasodifiy kirim, sotuv, ko‘chirish, hisobdan chiqarish va inventarizatsiyalardan keyin `stock_drift` bo‘sh qoladi va saqlangan WAC yadro hisobi bilan mos tushadi. Ortiqcha sotishda tranzaksiya to‘liq bekor bo‘ladi. Kredit limiti, asl tannarx bo‘yicha qaytarish, buyurtmani qisman qabul qilish, rollar, bizneslar o‘rtasidagi ajratish, audit, import ham tekshiriladi. |
| `apps/api` | 8 | HTTP orqali PostgreSQL 16’da: ro‘yxatdan o‘tish va kirish, CSRF himoyasi, to‘liq savdo jarayoni, cheklangan huquqli kassir. **Parallel savdo:** ikki kassir oxirgi tovarni bir vaqtda sotsa, faqat bittasi o‘tadi. 10 dona tovarga 20 ta parallel savdo kelsa, aynan 10 tasi o‘tadi. Ilova tekshiruvi chetlab o‘tilganda ham baza ortiqcha sotishga yo‘l qo‘ymaydi. |
| `e2e` | 5 | Kassadagi savdo qoldiq, savdolar ro‘yxati va bosh sahifani yangilaydi; rol almashtirish; ko‘chirish; hisobot va CSV eksport; 375 px ekranda gorizontal toshib chiqish yo‘q. Konsolda bitta xato chiqsa ham test yiqiladi. |

## Litsenziya

[MIT](LICENSE) © 2026 xoliddev
