# רשת חברתית תורנית — Project Context / Infrastructure

## מטרת הפרויקט

אנחנו בונים רשת חברתית תורנית עצמאית בסגנון Twitter / Bluesky, המבוססת על AT Protocol, ומחוברת עמוק ל־Sefaria לציטוט, חיפוש, שיתוף מקורות תורניים וצפייה בסריקות כתבי יד עתיקים.

המטרה אינה ליצור client חלופי ל־Bluesky אלא רשת נפרדת משלנו: משתמשים, חשבונות, פוסטים, follows, likes, reposts, feeds ו־AppView משלנו.

בבדיקת 22.11.2026 אומתו חשבונות ופוסטים קיימים ברשת העצמאית. קריאת `getTimeline` מאומתת דרך ה־PDS וה־AppView החזירה תוכן בהצלחה. תקינות ה־API ותקינות התצוגה נבדקות בנפרד; בדיקות הדפדפן והמכשירים הן שער הקבלה לגרסת הלקוח.

סטטוס העבודה והפריסה בפועל מנוהל ב־[Asana](https://app.asana.com/1/1219597879016953/project/1220231286382128). אין להסיק מתיאור רכיב במסמך שהוא עבר בדיקות קבלה בגרסה הנוכחית.

---

## GitHub Repositories

### Client / Web / iOS
- **URL**: https://github.com/davidpovarsky/social-app
- **ענף האינטגרציה המתוחזק**: `codex/torah-social-runtime-repair`
- **קישור ישיר**: https://github.com/davidpovarsky/social-app/tree/codex/torah-social-runtime-repair
- תיקונים נבדקים בענף עבודה לפני מיזוג לענף האינטגרציה; פריסה מזוהה לפי commit ותוצר בנייה שנבדק.
- זה fork של `bluesky-social/social-app`.

### AT Protocol / AppView backend
- **URL**: https://github.com/davidpovarsky/atproto
- **Branch פעיל**: `codex/torah-social-foundation`
- **קישור**: https://github.com/davidpovarsky/atproto/tree/codex/torah-social-foundation
- זה fork של `bluesky-social/atproto`.

### PDS / Deployment
- **URL**: https://github.com/davidpovarsky/pds
- **Branch פעיל**: `codex/torah-social-runtime-repair`
- **קישור**: https://github.com/davidpovarsky/pds/tree/codex/torah-social-runtime-repair
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
- **AppView DID הנוכחי**: `did:key:zQ3shmuFmJgBGwJugBx4QhgKV5uBW3Qd7RTWMMQto6r8Gug8H`

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

ב־Dockerfile של `social-app` שלב ה־build משתמש ב־`node:24-bookworm` עם `pnpm@12.16.1`.
בעת build מבודד מועברים:

```bash
EXPO_PUBLIC_TORAH_WEB_HOST=https://torah-130-110-238-163.nip.io
EXPO_PUBLIC_TORAH_PDS_HOST=https://pds-130-110-238-163.nip.io
EXPO_PUBLIC_TORAH_PDS_DID=did:web:pds-130-110-238-163.nip.io
EXPO_PUBLIC_TORAH_APPVIEW_HOST=https://appview-130-110-238-163.nip.io
EXPO_PUBLIC_BLUESKY_PROXY_DID=did:key:zQ3shmuFmJgBGwJugBx4QhgKV5uBW3Qd7RTWMMQto6r8Gug8H
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

המסלול לשרת ARM64 בעל שטח דיסק מוגבל הוא בנייה ב־GitHub Actions ופריסת התוצר המוכן:

1. הפעילו את workflow `torah-social-repair-web.yml` עבור commit ידוע. בדקו את תוצאות Jest, TypeScript, lint, Go ובדיקות הדפדפן בפועל. צעדי אבחון עשויים להמשיך אחרי כישלון; תוצאת צעד מעטפת לבדה אינה אישור קבלה.
2. השתמשו בתוצר `torah-social-web-arm64-<SHA>` רק לאחר הצלחת כל שערי ה־Web. תוצר `torah-social-web-candidate-<SHA>` מוקדם מיועד לאבחון בפורט loopback נפרד בלבד.
3. אמתו את `COMMIT`, את `SHA256SUMS` ואת ארכיטקטורת ELF ‏AArch64. בנו את image הריצה הקטן מתוך `Dockerfile.torah-runtime`, ללא התקנת Node, pnpm או תלויות האפליקציה בשרת.
4. בדקו מועמד ב־`127.0.0.1:8101`: מסמך HTML, קובצי JavaScript, כתובות canonical/OpenGraph, כניסה וטעינת תוכן. שמרו את הקונטיינר וה־image הפעילים לצורך חזרה לאחור.
5. החליפו את שירות ה־Web ב־`127.0.0.1:8100`, אמתו את כתובת ה־HTTPS הציבורית וחזרו לקונטיינר הקודם אם בדיקות הפריסה נכשלות. הגבילו לוגים ל־`max-size=10m` ו־`max-file=3`.

הגדרות שרת ה־Web בריצה:

```bash
ATP_APPVIEW_HOST=https://appview-130-110-238-163.nip.io
BSKY_WEB_ORIGIN=https://torah-130-110-238-163.nip.io
FEATURE_GATE_BOOTSTRAP=false
HTTP_ADDRESS=:8100
ROBOTS_DISALLOW_ALL=true
```

`BSKY_WEB_ORIGIN` שולט בכתובות המטא־דאטה של שרת ה־Go; הגדרות `EXPO_PUBLIC_*` נצרבות בנפרד בלקוח. שני Dockerfiles כוללים ברירת מחדל של Torah Social, ויש להעביר את הכתובת המתאימה כשמשנים דומיין.

Caddy משתף את השרת עם Tailscale. בתצורה הנוכחית הוא נקשר ל־`10.42.1.135` באמצעות `default_bind`; מאזין wildcard על443 מתנגש בשירות הקיים. helper ההתקנה בענף PDS המתוחזק מאמת ושומר את התצורה הקיימת לפני החלפה.

קובץ `.env.deployment` מקומי וסקריפט [`scripts/torah-deploy.mjs`](../scripts/torah-deploy.mjs) מתארים גם מסלול בנייה ישירה ישן. מסלול זה אינו מספק את בדיקות התוצר, המועמד והחזרה לאחור של תהליך הקבלה לעיל.

---

## אינטגרציית Sefaria

מימוש האינטגרציה ל־Sefaria מרוכז בתיקייה [`src/torah-social/`](../src/torah-social):

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
- **כרטיס מקור בפיד ([`TorahSourceCard.tsx`](../src/torah-social/sources/SourceCard.tsx))**: מציג את תמונת הציטוט המעוצבת מ-Sefaria בראש הכרטיס, שם המקור, טקסט הפסוק/סוגיה, וכפתור לפתיחת קורא מלא.
- **קורא מקורות מורחב ([`SourceReaderDialog.tsx`](../src/torah-social/sources/SourceReaderDialog.tsx))**: חלונית קריאה עם 3 לשוניות:
  1. **טקסט**: קריאה נוחה של הטקסט המנוקד בעברית לצד התרגום האנגלי.
  2. **תמונת מקור**: צפייה בכרטיסייה הגרפית ברזולוציה מלאה.
  3. **כתבי יד מקוריים**: גלריית סריקות של כתבי היד העתיקים האותנטיים עם שמות כתבי היד והמוסדות האקדמיים שסרקו אותם.
- **קומפוזר פוסטים**:
  - כפתור "מקור" ייעודי בסרגל הכלים ([`TorahComposerSourceButton.tsx`](../src/torah-social/composer/TorahComposerSourceButton.tsx)) עם חלונית חיפוש והצמדה.
  - סרגל הצעות ציטוט אוטומטי מעל שורת הכלים ([`TorahComposerExtensions.tsx`](../src/torah-social/composer/TorahComposerExtensions.tsx)).
  - תמונת הציטוט מועברת אוטומטית כ-`thumb` לתוך ה-`external embed` ([`useTorahSourceSelection.ts`](../src/torah-social/composer/useTorahSourceSelection.ts)), כך שכל שיתוף פוסט מקבל תצוגה מקדימה עשירה.

### 4. בדיקות אינטגרציה
קובץ הבדיקות [`scripts/test-torah-sefaria.mjs`](../scripts/test-torah-sefaria.mjs) מוודא שכל 7 נקודות הקצה פעילות ומחזירות נתונים תקינים בזמן אמת.

---

## בדיקות קבלה ופעולות המשך

- השתמשו בחשבונות ובפוסטים הקיימים לבדיקות קריאה וכניסה. יצירת חשבונות או פרסום תוכן אינם נחוצים לבדיקת פריסה.
- אמתו Hebrew/English, מסכים צרים ורחבים, טעינת הפיד האישי והפרופיל, טיוטה שלא פורסמה, בחירת מקור, טקסט מקור אמיתי ופוסט מעוגן מצומצם ומורחב.
- בדקו שגיאת פיד ארוכה וחזרה ממנה באמצעות ניסיון נוסף מול השרת. טקסט פוסט שמור במטמון אינו הוכחה להתאוששות.
- השלימו בנפרד בדיקות iPhone/iPad עבור אותו קוד אפליקציה.
- שירותי chat/video/metrics/moderation הציבוריים אינם תחליף לשירותים עצמאיים. יש להתאים יכולות לקיים בשרת ולתעד במפורש יכולות שאינן זמינות.
- החלפת nip.io בדומיין קבוע, שירות moderation/Ozone עצמאי והחלטה על plc.directory הם פרויקטים נפרדים.

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
