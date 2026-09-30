# Writing Evidence — MVP-A0

> *Write your academic work. Keep evidence of how it was created.*

TZ v4.0 bo‘yicha **MVP-A0 — texnik isbot**: editor, autosave, mutation ledger, snapshot, session, manba + origin mark, offline, concurrency, basic timeline, RLS + GRANT.

Stack: Next.js 16 (App Router) · TypeScript · Supabase (Auth, Postgres) · TipTap 3 · zod.

---

## 1. Ko‘rsatish uchun: demo sahifa (Supabase kerak emas)

`/demo` — ro‘yxatdan o‘tmasdan ishlaydi, hech narsa serverga yuborilmaydi:

- odam yozadi, paste qiladi, o‘chiradi — o‘ngda **jonli timeline** va **matn tarkibi**;
- “Manbalarni matnda ko‘rsatish” — paste (sariq) va AI (binafsha) matn editor ichida ko‘rinadi;
- pastda professor ko‘radigan Evidence Page bayonotlari (EN/KO).

Supabase ulanmagan bo‘lsa ham sayt ishlaydi: landing va demo ochiladi, kirish sahifasi “server hali ulanmagan” deydi.

## 2. To‘liq versiyani ishga tushirish (≈ 15 daqiqa)

1. **Supabase** → New project → Region: **Northeast Asia (Seoul)**.
2. **SQL Editor** → `supabase/setup_all.sql` faylini to‘liq joylab, **Run**.
   (CLI bilan: `supabase db push` — `supabase/migrations/` dagi 3 ta fayl.)
3. **Authentication → URL Configuration**:
   - Site URL: `https://SIZNING-DOMEN` (lokalda `http://localhost:3000`)
   - Redirect URLs: `https://SIZNING-DOMEN/auth/confirm`
4. **Project Settings → API** dan URL va publishable (yoki anon) kalitni oling.
5. **Vercel** → New Project → shu kod → Environment Variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   NEXT_PUBLIC_SITE_URL=https://SIZNING-DOMEN
   ```
   Service role kaliti **kerak emas** va hech qayerga qo‘yilmaydi (A0 da ishlatilmaydi).
6. `src/app/privacy/page.tsx` dagi `[KONTAKT EMAIL]` ni to‘ldiring.

Lokalda:

```bash
npm install
cp .env.example .env.local   # qiymatlarni to‘ldiring
npm run dev                  # http://localhost:3000
```

## 2a. AI yozuv maslahati (demo’da, TZ MVP-B dan oldinroq)

- `/demo` → **Yozuvni tekshirish**: grammatika, aniqlik, takror, akademik uslub, manba bo‘yicha joylar belgilanadi (AI/inson bahosi YO‘Q).
- Belgini bosing → sababi → **3 ta variant** → **Qo‘llash**. Faqat o‘sha parcha almashadi va timeline’da **AI taklifi** (`origin: ai`) deb qayd qilinadi.
- **O‘zim tuzataman** → parcha tanlanadi, talaba o‘zi yozadi (typed).
- Birinchi marta rozilik so‘raladi (matn Anthropic’ga yuboriladi, bizda saqlanmaydi).

Yoqish uchun Vercel → Settings → Environment Variables:

```
ANTHROPIC_API_KEY=sk-ant-...        # Sensitive
ANTHROPIC_MODEL=claude-haiku-4-5-20251001   # ixtiyoriy
```

Himoya: bir IP ga 10 daqiqada 8 tahlil / 40 variant, instance’ga kuniga 300 tahlil, faqat o‘z saytimizdan so‘rov, kesh, Vercel Firewall rate limit. Asosiy xarajat chegarasi — Anthropic Console’dagi oylik limit.

## 3. Testlar

```bash
npm test          # 52 ta test: editor mantiqi + haqiqiy Postgres (PGlite) ichida SQL
npm run typecheck
npm run build
```

| TZ mezoni | Nima tekshiriladi | Qayerda |
|---|---|---|
| A5 Retry | Bitta paket 3 marta → mutation’lar bir marta | `tests/sql/evidence.test.ts` |
| A7 Paste | 500 belgili tashqi paste → `paste` | `tests/recorder.test.ts` |
| A8 Ichki ko‘chirish | cut/paste → `moved`, asl origin’lar saqlanadi | recorder |
| A9 Drop / replace / bulk | `replacement`, 100 belgi → `bulk_input` | recorder |
| A10 Consistency — ushlash | Mutation’siz 1000 belgi → `unrecorded_change`; client `doc_size`ni soxtalashtira olmaydi | sql |
| **A11** Soxta natija yo‘q | 10 000 tasodifiy tahrirda hajm aniq; **to‘liq zanjir** (recorder → sync → zod → SQL) 2 000 tahrir + offline uzilishlar → **0** `unrecorded_change` | ikkalasi |
| A12 Concurrency | 409 → Recovered draft, rad etilgan paket yozilmaydi | sql |
| A16 RLS | B user A ning hech narsasini ko‘rmaydi; egasi ham ledger’ni o‘zgartira olmaydi | sql |
| A21 GRANT | anon hech bir jadval/funksiyaga kira olmaydi | sql |
| A23 Origin | AI 100 → 40 o‘chirish, 20 ustidan, 30 ichiga → ai = 40, typed = 50 | recorder |
| Vaqt (§11) | offline, soat oldinda, offline’da 30+ daq tanaffus | sql |

Demo sahifasi haqiqiy brauzerda (Chromium) ham sinaldi: klaviatura → typed, clipboard paste → paste, paste’dan keyin yozilgan matn → typed.

## 4. TZ v4 dagi kamchiliklar va kodda qanday tuzatildi (v4.1 uchun)

1. **`save_document`ni brauzer to‘g‘ridan-to‘g‘ri chaqira oladi** (authenticated EXECUTE). → Hajm, `content_text`, so‘z soni va hash **Postgres ichida** `content_json`dan hisoblanadi; tugun/mark turlari ham serverda tekshiriladi.
2. **UTF-16 va Postgres farqi.** ProseMirror hajmi UTF-16 birliklarda → SQL ham shunday sanaydi (`private.utf16_length`). Busiz emoji soxta `unrecorded_change` berardi.
3. **Session offline’da ochilmaydi.** → Session ID client’da yaratiladi, server idempotent qabul qiladi; `last_activity_at` `effective_ts`dan olinadi. Alohida `POST /sessions` kerak emas.
4. **Manbani faqat `beforeinput` bilan aniqlash ishonchsiz.** → ProseMirror meta’lari (paste/drop/cut/history) + klaviatura/IME signallari; signalsiz o‘zgarish → `unknown`. Paste signali bitta tranzaksiyaga tegishli (paste’dan keyin tez yozilgan matn endi `paste` bo‘lib qolmaydi — testda topilgan xato).
5. **Mutation hajmi step map’lardan** olinadi → Σ(inserted − deleted) har doim hajm farqiga aniq teng (ro‘yxat, sarlavha, formatlashda ham). Faqat mark o‘zgarishi (bold) mutation yozmaydi.
6. **Yolg‘iz UTF-16 surrogate** (emoji yarmi o‘chirilsa) Postgres jsonb’ni buzadi va saqlash abadiy qayta urinardi → U+FFFD bilan almashtiriladi (uzunlik o‘zgarmaydi, consistency aniq qoladi). Testda topilgan.
7. **Clipboard origin’iga ishonilmaydi.** Ichki ko‘chirishda asl origin’lar nusxa olingan paytdagi yozuvdan qayta qo‘llanadi (clipboard mark’larini olib tashlab “typed” qilish ishlamaydi).
8. **IME (Android/koreys klaviatura):** composition paytida origin olib tashlash kechiktiriladi — mark o‘zgarishi composition’ni buzmasligi uchun.

Kichik qarorlar:
- `inserted_chars` / `deleted_chars` — **son**, matnning o‘zi ledger’da saqlanmaydi (privacy). `deleted_chars` ustuni qo‘shildi (`revision` qoidasi uchun).
- Consistency check har autosave’da (A1 dan A0 ga o‘tkazildi — A0 ning asosiy isboti shu).
- Bitta aktiv tab: BroadcastChannel o‘rniga **Web Locks API** (poyga holatisiz).
- Hujjat faqat `create_document` orqali yaratiladi (boshlang‘ich snapshot bilan), `documents`ga to‘g‘ridan-to‘g‘ri INSERT yo‘q.
- Snapshot sabablari: `initial`, `interval`, `external`, `session_end`, `unrecorded`.

## 5. A1 ga qoldirilganlar

Evidence Page (unlisted, EN/KO, revoke, tombstone), Verify + benchmark, compaction, akkaunt o‘chirish, Turnstile, Evidence Summary sahifasi, service role route’lari.

## 6. Tuzilma

```
supabase/migrations/   schema · funksiyalar (save_document, ingest_events, document_timeline) · RLS/GRANT
supabase/setup_all.sql hammasi bitta faylda
src/lib/evidence/      recorder (ProseMirror plugin), signallar, manba, tarkib, wire (zod), timeline
src/lib/sync/          autosave + IndexedDB navbati + 409 + session + typing_activity
src/components/        EditorCore, DocumentEditor, DemoClient, TimelineView
src/app/               sahifalar va API route’lar
tests/                 recorder testlari · PGlite’da SQL va to‘liq zanjir testlari
```
