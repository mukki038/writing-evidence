import { getDict } from '@/lib/i18n-server'

/** Beta privacy policy (TZ §20). Qoralama — ishga tushirishdan oldin yurist tasdiqlaydi. */
export default async function Privacy() {
  const { locale } = await getDict()
  return locale === 'en' ? <PrivacyEn /> : <PrivacyUz />
}

function PrivacyUz() {
  return (
    <article className="prose narrow">
      <h1>Maxfiylik siyosati (beta, qoralama)</h1>
      <p className="banner banner--warn">
        Bu beta versiya uchun qoralama. Yakuniy matn Koreya shaxsiy ma’lumotlar qonuni (PIPA) bo‘yicha mutaxassis bilan
        tasdiqlanadi. Bu huquqiy maslahat emas.
      </p>
      <h2>Qanday ma’lumot yig‘iladi</h2>
      <ul>
        <li>Akkaunt: email va parol (parol faqat shifrlangan holda Supabase Auth’da).</li>
        <li>Hujjatlar: siz yozgan matn va uning snapshot’lari.</li>
        <li>
          Yozish jarayoni: tahrirlar jurnali — qayerga nechta belgi qo‘shilgani/o‘chirilgani, manbasi (yozish, paste va
          h.k.) va vaqti. Tahrir jurnalida matnning o‘zi saqlanmaydi, faqat belgilar soni.
        </li>
        <li>Session vaqtlari va faol yozish statistikasi.</li>
      </ul>
      <h2>Maqsad</h2>
      <p>Yozish jarayonini sizning o‘zingiz uchun hujjatlashtirish. Ma’lumot sotilmaydi va reklama uchun ishlatilmaydi.</p>
      <h2>Kim ko‘radi</h2>
      <p>Hujjatlaringiz private: faqat siz ko‘rasiz. Hozirgi (A0) versiyada ulashish funksiyasi yo‘q.</p>
      <h2>Saqlash joyi va muddati</h2>
      <ul>
        <li>Server: Supabase, Seoul regioni.</li>
        <li>Hujjat va uning yozuv tarixi — hujjat mavjud ekan. Hujjatni o‘chirsangiz, barcha bog‘liq ma’lumot darhol o‘chadi.</li>
        <li>Zaxira nusxalar (backup): tanlangan rejaning backup muddati bo‘yicha (maqsad ≤ 30 kun).</li>
        <li>Qurilmangizda: saqlanmagan o‘zgarishlar internet qaytguncha brauzeringizda (IndexedDB) turadi.</li>
      </ul>
      <h2>Tashqi AI provayderlar</h2>
      <p>Bu versiyada matningiz hech qanday AI provayderga yuborilmaydi.</p>
      <h2>Huquqlaringiz</h2>
      <p>Istalgan vaqtda hujjatni o‘chirishingiz mumkin. Akkauntni o‘chirish yoki savollar uchun: [KONTAKT EMAIL — ishga tushirishdan oldin to‘ldiring]</p>
    </article>
  )
}

function PrivacyEn() {
  return (
    <article className="prose narrow">
      <h1>Privacy policy (beta draft)</h1>
      <p className="banner banner--warn">
        This is a draft for the beta. The final text will be reviewed with a Korean privacy (PIPA) specialist. This is not
        legal advice.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account: email and password (the password is stored only in hashed form by Supabase Auth).</li>
        <li>Documents: the text you write and its snapshots.</li>
        <li>
          Writing process: an edit log — where and how many characters were added or removed, the input source (typing,
          paste, etc.) and the time. The edit log stores character counts, not the text itself.
        </li>
        <li>Session times and active-writing statistics.</li>
      </ul>
      <h2>Purpose</h2>
      <p>To document your writing process for you. Data is not sold and not used for advertising.</p>
      <h2>Who can see it</h2>
      <p>Your documents are private: only you can see them. This version (A0) has no sharing feature.</p>
      <h2>Where and how long</h2>
      <ul>
        <li>Server: Supabase, Seoul region.</li>
        <li>A document and its record are kept while the document exists. Deleting a document removes all related data immediately.</li>
        <li>Backups: per the backup period of the selected plan (target ≤ 30 days).</li>
        <li>On your device: unsaved changes stay in your browser (IndexedDB) until you are back online.</li>
      </ul>
      <h2>External AI providers</h2>
      <p>In this version your text is not sent to any AI provider.</p>
      <h2>Your rights</h2>
      <p>You can delete a document at any time. For account deletion or questions: [CONTACT EMAIL — fill in before launch]</p>
    </article>
  )
}
