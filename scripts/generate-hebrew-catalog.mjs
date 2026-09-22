import fs from 'node:fs'
import path from 'node:path'

const translations = {
  // Navigation & Shell
  "Home": "בית",
  "Explore": "גלה",
  "Search": "חיפוש",
  "Notifications": "התראות",
  "Chats": "צ'אטים",
  "Profile": "פרופיל",
  "Settings": "הגדרות",
  "Feeds": "פידים",
  "Lists": "רשימות",
  "Menu": "תפריט",
  "Go back": "חזור",
  "Back": "חזרה",
  "Open drawer menu": "פתח תפריט",
  "Close": "סגור",
  "Done": "סיום",
  "Cancel": "ביטול",
  "Save": "שמור",
  "Save changes": "שמור שינויים",
  "Edit": "ערוך",
  "Delete": "מחק",
  "Retry": "נסה שוב",
  "Reload": "רענן",
  "Share": "שתף",
  "Copy": "העתק",
  "Copied link to clipboard": "הקישור הועתק ללוח",
  "Failed to copy link": "העתקת הקישור נכשלה",
  "Loading...": "טוען...",
  "Load more": "טען עוד",
  "Whoops!": "אופס!",
  "Something went wrong": "משהו השתבש",
  "Try again": "נסה שוב",
  "Unavailable": "לא זמין",
  "Yes": "כן",
  "No": "לא",
  "OK": "אישור",
  "Confirm": "אישור",

  // Feed & Timeline
  "Following": "עוקב",
  "Follow": "עקוב",
  "Follow back": "עקוב בחזרה",
  "Unfollow": "בטל מעקב",
  "Followers": "עוקבים",
  "Posts": "פוסטים",
  "Replies": "תשובות",
  "Media": "מדיה",
  "Likes": "לייקים",
  "Repost": "פרסם מחדש",
  "Reposts": "פרסומים מחדש",
  "Reposted by": "פורסם מחדש על ידי",
  "Quote": "ציטוט",
  "Quote post": "צטט פוסט",
  "Reply": "הגב",
  "Like": "לייק",
  "Unlike": "בטל לייק",
  "Discover": "גלה",
  "Pinned": "נעוץ",
  "Pin feed": "נעץ פיד",
  "Unpin feed": "בטל נעיצת פיד",

  // Composer
  "New post": "פוסט חדש",
  "Post": "פרסם",
  "Publish": "פרסם",
  "Drafts": "טיוטות",
  "Discard": "בטל",
  "What's up?": "מה חדש?",
  "What's on your mind?": "על מה אתה חושב?",
  "Write your reply": "כתוב תשובה...",
  "Add a comment...": "הוסף תגובה...",
  "Attach image": "צרף תמונה",
  "Take photo": "צלם תמונה",

  // Explore & Search
  "Suggested accounts": "חשבונות מוצעים",
  "Suggested follows": "הצעות מעקב",
  "Suggested feeds": "פידים מוצעים",
  "Suggested starter packs": "ערכות התחלה מוצעות",
  "Trending topics": "נושאים חמים",
  "Trending": "חם עכשיו",
  "Top": "מוביל",
  "Latest": "אחרונים",
  "People": "אנשים",
  "No results found": "לא נמצאו תוצאות",
  "Clear search": "נקה חיפוש",
  "Cancel search": "בטל חיפוש",
  "Search for people and topics": "חפש אנשים ונושאים",
  "Share this search": "שתף חיפוש זה",

  // Notifications
  "All": "הכל",
  "Mentions": "אזכורים",
  "Mark all as read": "סמן הכל כנקרא",
  "No notifications yet": "אין עדיין התראות",
  "followed you": "עקב אחריך",
  "liked your post": "סימן לייק לפוסט שלך",
  "reposted your post": "פרסם מחדש את הפוסט שלך",
  "replied to your post": "הגיב לפוסט שלך",
  "mentioned you": "הזכיר אותך",

  // Chats / Messages
  "Chat requests": "בקשות צ'אט",
  "New chat": "צ'אט חדש",
  "Chat settings": "הגדרות צ'אט",
  "Chat options": "אפשרויות צ'אט",
  "Send a message": "שלח הודעה",
  "Write a message": "כתוב הודעה...",
  "Mark all as read": "סמן הכל כנקרא",
  "Marked all chats as read": "כל הצ'אטים סומנו כנקראו",
  "Failed to mark all chats as read": "סימון הצ'אטים כנקראו נכשל",
  "Failed to load conversations": "טעינת השיחות נכשלה",
  "Say hi to someone": "שלח שלום למישהו",
  "Inbox empty": "תיבת ההודעות ריקה",
  "Leave chat": "עזוב צ'אט",
  "Mute chat": "השתק צ'אט",
  "Unmute chat": "בטל השתקת צ'אט",
  "Delete chat": "מחק צ'אט",
  "Start a conversation": "התחל שיחה",

  // Account, Profile & Auth
  "Sign in": "התחבר",
  "Log in": "התחבר",
  "Sign up": "הרשמה",
  "Create account": "צור חשבון",
  "Sign out": "התנתק",
  "Log out": "התנתק",
  "Account": "חשבון",
  "Edit profile": "ערוך פרופיל",
  "Display name": "שם תצוגה",
  "Description": "תיאור",
  "Bio": "אודות",
  "Handle": "כינוי",
  "Email": "אימייל",
  "Password": "סיסמה",
  "Forgot password?": "שכחת סיסמה?",
  "Hosting provider": "שרת אחסון",
  "Invite code": "קוד הזמנה",
  "Language": "שפה",
  "App language": "שפת האפליקציה",
  "Content languages": "שפות תוכן",
  "Primary language": "שפה ראשית",
  "Dark mode": "מצב כהה",
  "Appearance": "מראה",
  "System": "מערכת",
  "Light": "בהיר",
  "Dark": "כהה",
  "Feedback": "משוב",
  "Help": "עזרה",
  "About": "אודות",
  "Terms of service": "תנאי שימוש",
  "Privacy policy": "מדיניות פרטיות",
  "Community guidelines": "הנחיות קהילה",
  "Version": "גרסה",

  // Additional UI strings
  "Trending Videos": "סרטונים חמים",
  "Popular with Friends": "פופולרי בקרב חברים",
  "Suggested Accounts": "חשבונות מוצעים",
  "Suggested Feeds": "פידים מוצעים",
  "Show more": "הצג עוד",
  "Show less": "הצג פחות",
  "Show": "הצג",
  "Hide": "הסתר",
  "Block": "חסום",
  "Unblock": "בטל חסימה",
  "Mute": "השתק",
  "Unmute": "בטל השתקה",
  "Report": "דווח",
  "Copy link": "העתק קישור",
  "Share post": "שתף פוסט",
  "Share profile": "שתף פרופיל",
  "Open in browser": "פתח בדפדפן",
  "Search...": "חיפוש...",
  "Reply to {name}": "השב ל-{name}",
  "Post your reply": "פרסם את תגובתך",
  "Anyone can reply": "כולם יכולים להגיב",
  "No posts yet": "אין פוסטים עדיין",
  "No replies yet": "אין תגובות עדיין",
  "No likes yet": "אין לייקים עדיין",
  "No media yet": "אין מדיה עדיין",
  "User not found": "משתמש לא נמצא",
  "Account suspended": "החשבון הושעה",
  "Account deactivated": "החשבון מושבת",
  "Offline": "לא מחובר",
  "Online": "מחובר",
  "Connecting...": "מתחבר...",
  "Connected": "מחובר",
  "Error loading feed": "שגיאה בטעינת הפיד",
  "Failed to load feeds": "טעינת הפידים נכשלה",
  "Failed to load suggested follows": "טעינת הצעות המעקב נכשלה",
  "Failed to load profile": "טעינת הפרופיל נכשלה",
  "Failed to load notifications": "טעינת ההתראות נכשלה",
  "Failed to send message": "שליחת ההודעה נכשלה",
  "Message sent": "ההודעה נשלחה",
  "Unread messages": "הודעות שלא נקראו",
  "New messages": "הודעות חדשות",
  "Direct messages": "הודעות ישירות",
  "Group chats": "צ'אטים קבוצתיים",
  "Start chat": "התחל צ'אט",
  "Leave conversation": "עזוב שיחה",
  "Delete conversation": "מחק שיחה",
  "Clear history": "נקה היסטוריה",
  "Select language": "בחר שפה",
  "Default": "ברירת מחדל",
  "Automatic": "אוטומטי",
  "Continue": "המשך",
  "Next": "הבא",
  "Previous": "הקודם",
  "Finish": "סיום",
  "Skip": "דלג",
  "Select all": "בחר הכל",
  "Deselect all": "בטל בחירת הכל",
  "Remove": "הסר",
  "Add": "הוסף",
  "Update": "עדכן",
  "Updated": "עודכן",
  "Saved": "נשמר",
  "Created": "נוצר",
  "Deleted": "נמחק",
  "Success": "הצלחה",
  "Warning": "אזהרה",
  "Error": "שגיאה",
  "Info": "מידע",
}

const enPoPath = path.resolve('src/locale/locales/en/messages.po')
const hePoDir = path.resolve('src/locale/locales/he')
const hePoPath = path.join(hePoDir, 'messages.po')

if (!fs.existsSync(hePoDir)) {
  fs.mkdirSync(hePoDir, {recursive: true})
}

const enContent = fs.readFileSync(enPoPath, 'utf8').replace(/\r\n/g, '\n')

// Parse PO file entries
const headerEnd = enContent.indexOf('\n\n')
const header = `msgid ""
msgstr ""
"POT-Creation-Date: 2023-11-05 16:01-0800\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=utf-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"X-Generator: @lingui/cli\\n"
"Language: he\\n"
"Project-Id-Version: \\n"
"Report-Msgid-Bugs-To: \\n"
"PO-Revision-Date: \\n"
"Last-Translator: \\n"
"Language-Team: Hebrew\\n"
"Plural-Forms: nplurals=4; plural=(n==1 ? 0 : n==2 ? 1 : (n>10 && n%10==0) ? 2 : 3);\\n"`

const entries = enContent.slice(headerEnd + 2).split('\n\n')
let translatedCount = 0
let totalCount = 0

const heEntries = entries.map(entry => {
  if (!entry.trim()) return ''
  totalCount++

  // Match msgid
  const msgidMatch = entry.match(/^msgid "(.*?)"$/m)
  if (msgidMatch) {
    const id = msgidMatch[1]
    if (translations[id]) {
      translatedCount++
      return entry.replace(/^msgstr ".*?"$/m, `msgstr "${translations[id]}"`)
    }
  }

  // Multi-line msgid match
  const multiMsgidMatch = entry.match(/^msgid ""\n((?:".*?"\n)+)msgstr/m)
  if (multiMsgidMatch) {
    const fullId = multiMsgidMatch[1]
      .split('\n')
      .filter(Boolean)
      .map(line => line.slice(1, -1))
      .join('')
    if (translations[fullId]) {
      translatedCount++
      return entry.replace(/msgstr ""\n(?:".*?"\n)+/m, `msgstr "${translations[fullId]}"\n`)
        .replace(/^msgstr ".*?"$/m, `msgstr "${translations[fullId]}"`)
    }
  }

  // Fallback: clear msgstr so Lingui uses msgid (English)
  return entry.replace(/^msgstr ".*?"$/m, 'msgstr ""')
})

const heContent = header + '\n\n' + heEntries.filter(Boolean).join('\n\n') + '\n'
fs.writeFileSync(hePoPath, heContent, 'utf8')

console.log(`Hebrew catalog generated successfully at ${hePoPath}`)
console.log(`Translated core messages: ${translatedCount}`)
console.log(`Total messages: ${totalCount}`)
console.log(`Untranslated (falling back to English): ${totalCount - translatedCount}`)
