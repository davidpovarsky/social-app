# רשת חברתית תורנית — Project Context / Infrastructure

## מטרת הפרויקט

אנחנו בונים רשת חברתית תורנית עצמאית בסגנון Twitter / Bluesky, המבוססת על AT Protocol, ומחוברת עמוק ל־Sefaria לציטוט, חיפוש, שיתוף מקורות תורניים וצפייה בסריקות כתבי יד עתיקים.

המטרה אינה ליצור client חלופי ל־Bluesky אלא רשת נפרדת משלנו: משתמשים, חשבונות, פוסטים, follows, likes, reposts, feeds ו־AppView משלנו.

נכון לעכשיו הרשת כבר מנותקת מתוכן Bluesky, והפיד נבדק בפועל ומופיע ריק, כפי שצריך להיות לפני שנוצר תוכן משלנו.

---

## GitHub Repositories

### Client / Web / iOS
- **URL**: https://github.com/davidpovarsky/social-app
- **Branch פעיל**: `codex/torah-social-foundation`
- **קישור ישיר**: https://github.com/davidpovarsky/social-app/tree/codex/torah-social-foundation
- זה fork של `bluesky-social/social-app`.

### AT Protocol / AppView backend
- **URL**: https://github.com/davidpovarsky/atproto
- **Branch פעיל**: `codex/torah-social-foundation`
- **קישור**: https://github.com/davidpovarsky/atproto/tree/codex/torah-social-foundation
- זה fork של `bluesky-social/atproto`.

### PDS / Deployment
- **URL**: https://github.com/davidpovarsky/pds
- **Branch פעיל**: `codex/torah-social-foundation`
- **קישור**: https://github.com/davidpovarsky/pds/tree/codex/torah-social-foundation
- בתוך הריפו נמצאים סקריפטים של ההתקנה והפריסה של Torah Social.

---

## השרת הנוכחי (Hosting Server)

- **ספק**: Oracle Cloud Infrastructure (OCI) — Free Tier
- **Region**: `il-jerusalem-1` (Israel Central / Jerusalem)
- **VM**: `torah-social`
- **OS**: Ubuntu 24.04 ARM64
- **Shape**: `VM.Standard.A1.Flex`
- **משאבים**: 2 OCPU / 12 GB RAM
- **Public IPv4 הנוכחי**: `130.110.238.163` *(IP ציבורי/ephemeral)*

---

## כתובות פעילות כרגע

### Torah Social Web (האתר הראשי)
- **URL**: https://torah-130-110-238-163.nip.io
- זה האתר שהמשתמשים פותחים בדפדפן (רץ בקונטיינר `torah-social-web` בפורט פנימי `8100`, עם reverse-proxy של Caddy).

### Torah Social PDS
- **URL**: https://pds-130-110-238-163.nip.io
- כאן נוצרים ונשמרים החשבונות, הסיסמאות וה־repos של המשתמשים.
- **PDS DID זמני**: `did:web:pds-130-110-238-163.nip.io`

### Torah Social AppView
- **URL**: https://appview-130-110-238-163.nip.io
- **AppView DID הנוכחי**: `did:key:zQ3shmuFmJgBGwJugBx4QhgKV5uBW3Qd7RTWMMQto6r8Guq8H`

---

## הארכיטקטורה הנוכחית

```text
Torah Social Web / iOS
          ↓
Torah Social PDS (port 3000)
          ↓
Torah Social AppView (port 2584)
          ↓
Torah Social PostgreSQL (port 5432)
```

ה־AppView מאזין ישירות ורק ל־PDS שלנו באמצעות firehose מקומי:
`ws://127.0.0.1:3000`

כרגע אין Relay ציבורי ואין צורך ב־Relay בשביל הרשת שלנו.
ה־AppView אינו מאזין ל־Bluesky Relay ואינו מאנדקס את Bluesky.

---

## מצב הבידוד מ־Bluesky

כבר בוצע ונבדק בפועל:
* `public.api.bsky.app` אינו מקור הפיד.
* Bluesky Discover הוסר מה־client המבודד.
* AppView database שלנו התחיל ריק.
* `PDS_CRAWLERS` ריק.
* `bsky.network` אינו crawler.
* Bluesky moderation service מבוטל.
* Bluesky report service מבוטל.
* ה־AppView מאנדקס רק accounts/posts שמגיעים מה־PDS שלנו.
* בדיקה בפועל בדפדפן וב־Private Browsing הראתה פיד ריק.

**חשוב מאוד**: לא מספיק להגדיר את `ATP_APPVIEW_HOST` בשרת.
ב־`social-app` יש כתובות AppView/Discover שנכנסות ל־JavaScript בזמן ה־build. לכן נוצר סקריפט:
`scripts/torah-isolate-client.mjs`
שמחליף את ה־constants של Bluesky לפני בניית ה־Web bundle.
בכל עדכון גדול או merge מה־upstream יש לוודא שהבידוד הזה לא נשבר.

---

## Web Build והגדרות סביבה

ב־Dockerfile של `social-app` שלב ה־build משתמש ב־`node:24-bookworm` עם `pnpm@11.21.0`.
בעת build מבודד מועברים:

```bash
EXPO_PUBLIC_TORAH_PDS_HOST=https://pds-130-110-238-163.nip.io
EXPO_PUBLIC_TORAH_PDS_DID=did:web:pds-130-110-238-163.nip.io
EXPO_PUBLIC_TORAH_APPVIEW_HOST=https://appview-130-110-238-163.nip.io
EXPO_PUBLIC_BLUESKY_PROXY_DID=did:key:zQ3shmuFmJgBGwJugBx4QhgKV5uBW3Qd7RTWMMQto6r8Guq8H
EXPO_PUBLIC_TORAH_ISOLATED_NETWORK=true
```

---

## Containers / Services בשרת

השרת ב-Oracle מריץ:
1. `pds` (פורט פנימי `127.0.0.1:3000`)
2. `torah-social-web` (פורט פנימי `127.0.0.1:8100`)
3. `torah-appview` (פורט פנימי `127.0.0.1:2584`)
4. `torah-appview-postgres` (פורט פנימי `127.0.0.1:5432`)
5. `caddy` (מאזין מבחוץ על 80 ו-443 ומבצע Reverse Proxy לכל השירותים עם TLS אוטומטי דרך nip.io)

---

## פריסה ועדכון האתר בשרת (Deployment)

תהליך עדכון ה־Web Client בשרת האורקל:
1. שינויים נדחפים ל-GitHub בענף `codex/torah-social-foundation`.
2. בשרת Oracle Cloud (דרך SSH או Cloud Shell):
   - משיכת השינויים בריפו `social-app`.
   - בנייה מחדש של ה-Container `torah-social-web` עם ארגומנטי הבידוד.
   - הפעלה מחדש של הקונטיינר.

קובץ עזר מקומי [`.env.deployment`](file:///C:/Users/DAVID/Code/social-app/.env.deployment) מאפשר להגדיר טוקן גישה ל-GitHub וחיבור SSH לשרת, וסקריפט [`scripts/torah-deploy.mjs`](file:///C:/Users/DAVID/Code/social-app/scripts/torah-deploy.mjs) מנהל את הפעולות.

---

## אינטגרציית Sefaria (מצב עדכני — הושלם במלואו!)

האינטגרציה ל-Sefaria בוצעה במלואה ומרוכזת בתיקייה [`src/torah-social/`](file:///C:/Users/DAVID/Code/social-app/src/torah-social):

### 1. מנוע ה-API (`src/torah-social/sefaria/api.ts`)
- **השלמה אוטומטית (`autocompleteRefs`)**: חיפוש פסוקים, פרקים, מסכתות, הלכות וספרים מול Sefaria Name API (`/api/name/{query}?type=ref`).
- **אימות ונירמול מקור (`validateRef`)**: בדיקת תקינות מול Sefaria Ref API (`/api/ref/{tref}`), תומך בכל הפורמטים הקנוניים (`normalized`, `hebrew`, `url_ref`).
- **שליפת טקסט דו-לשונית (`getText`)**: שימוש ב-Sefaria v3 Texts API עם שליפת גרסה עברית מנוקדת ותרגום אנגלי במקביל (`version=['hebrew', 'english']`).
- **מחולל תמונות שיתוף / כרטיסיית ציטוט (`getTorahSourceImageUrl`)**: חיבור ישיר ל-Sefaria Social Media Image Generator (`GET /api/img-gen/{tref}?lang=he&platform=twitter`), המייצר תמונת PNG מעוצבת ואיכותית של הפסוק/סוגיה.
- **סריקות כתבי יד היסטוריים (`getManuscripts`)**: חיבור ל-Sefaria Manuscripts API (`GET /api/manuscripts/{tref}`), השולף סריקות מקוריות של כתבי יד עתיקים (כתב יד לנינגרד מ-1008, כתר ארם צובא, גניזת קהיר ועוד) עם תמונות ברזולוציה גבוהה מ-`https://manuscripts.sefaria.org/`.

### 2. מזהה ציטוטים אוטומטי (`src/torah-social/sefaria/linker.ts`)
- מזהה ציטוטים תורניים מתוך טקסט הפוסט בזמן הקלדה (`detectTorahSources`) באמצעות ה-Sefaria Linker האסינכרוני (`/api/find-refs` ו-`/api/async/{task_id}`).
- תומך בזיהוי מקורות רב-משמעיים (`ambiguous`) ונמנע מהצמדה שגויה.

### 3. ממשק משתמש ורכיבים
- **כרטיס מקור בפיד ([`TorahSourceCard.tsx`](file:///C:/Users/DAVID/Code/social-app/src/torah-social/sources/SourceCard.tsx))**: מציג את תמונת הציטוט המעוצבת מ-Sefaria בראש הכרטיס, שם המקור, טקסט הפסוק/סוגיה, וכפתור לפתיחת קורא מלא.
- **קורא מקורות מורחב ([`SourceReaderDialog.tsx`](file:///C:/Users/DAVID/Code/social-app/src/torah-social/sources/SourceReaderDialog.tsx))**: חלונית קריאה עם 3 לשוניות:
  1. **טקסט**: קריאה נוחה של הטקסט המנוקד בעברית לצד התרגום האנגלי.
  2. **תמונת מקור**: צפייה בכרטיסייה הגרפית ברזולוציה מלאה.
  3. **כתבי יד מקוריים**: גלריית סריקות של כתבי היד העתיקים האותנטיים עם שמות כתבי היד והמוסדות האקדמיים שסרקו אותם.
- **קומפוזר פוסטים**:
  - כפתור "מקור" ייעודי בסרגל הכלים ([`TorahComposerSourceButton.tsx`](file:///C:/Users/DAVID/Code/social-app/src/torah-social/composer/TorahComposerSourceButton.tsx)) עם חלונית חיפוש והצמדה.
  - סרגל הצעות ציטוט אוטומטי מעל שורת הכלים ([`TorahComposerExtensions.tsx`](file:///C:/Users/DAVID/Code/social-app/src/torah-social/composer/TorahComposerExtensions.tsx)).
  - תמונת הציטוט מועברת אוטומטית כ-`thumb` לתוך ה-`external embed` ([`useTorahSourceSelection.ts`](file:///C:/Users/DAVID/Code/social-app/src/torah-social/composer/useTorahSourceSelection.ts)), כך שכל שיתוף פוסט מקבל תצוגה מקדימה עשירה.

### 4. בדיקות אינטגרציה
קובץ הבדיקות [`scripts/test-torah-sefaria.mjs`](file:///C:/Users/DAVID/Code/social-app/scripts/test-torah-sefaria.mjs) מוודא שכל 7 נקודות הקצה פעילות ומחזירות נתונים תקינים בזמן אמת.

---

## שלבים הבאים

1. ליצור משתמש ראשון על ה־PDS שלנו (`https://pds-130-110-238-163.nip.io`).
2. ליצור פוסט ראשון עם מקור תורני ותמונת מקור.
3. לוודא שהוא נכנס ל־AppView ולפיד.
4. ליצור משתמש שני ולבדוק Follow / Like / Reply / Repost.
5. להוסיף Hebrew localization + RTL מלא ל-UI הכללי.
6. ~~לחבר Sefaria ל־composer וליצור Torah Source Card~~ — **בוצע במלואו!**
7. להחליף את nip.io בדומיין אמיתי קבוע (עם הגדרת DNS ו-SSL ב-Caddy).
8. להסיר/להחליף בהדרגה שירותי upstream משניים שנותרו ב־client כגון chat/video/metrics.
9. לבנות moderation/Ozone משלנו.
10. בהמשך להחליט האם לבודד גם את plc.directory.

---

## אבטחה

אין להדביק לסביבת הפרויקט או לקוד:
* Oracle Tenancy OCID
* SSH private key
* PDS secrets
* AppView signing key
* AppView admin password
* Bsync API key
* PostgreSQL password
* Invite codes פעילים
* credentials אחרים

כל אלה נשמרים אך ורק בשרת או בקבצי `.env` מקומיים שאינם מנוטרים ב-Git.
