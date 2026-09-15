import fs from 'node:fs'
import {execSync} from 'node:child_process'

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const env = {}
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    env[key] = val
  }
  return env
}

const envFile = '.env.deployment'
const env = parseEnv(envFile)

console.log('=== Torah Social Deployment Runner (Oracle Cloud / GitHub) ===')

const githubToken = env.GITHUB_TOKEN || process.env.GITHUB_TOKEN
const githubUsername = env.GITHUB_USERNAME || process.env.GITHUB_USERNAME || 'davidpovarsky'
const oracleHost = env.ORACLE_HOST || process.env.ORACLE_HOST || '130.110.238.163'
const oracleUser = env.ORACLE_USER || process.env.ORACLE_USER || 'ubuntu'
const sshKeyPath = env.SSH_KEY_PATH || process.env.SSH_KEY_PATH

if (!githubToken && !sshKeyPath) {
  console.log('סטטוס: לא הוגדרו פרטי התחברות בקובץ .env.deployment')
  console.log('כדי לפרסם את השינויים:')
  console.log('1. פתח את הקובץ: .env.deployment')
  console.log('2. הזן GITHUB_TOKEN כדי לדחוף את השינויים לענף codex/torah-social-foundation')
  console.log('3. (אופציונלי) הזן SSH_KEY_PATH כדי להריץ פריסה ובנייה ישירות על שרת האורקל (130.110.238.163)')
  console.log('4. הרץ שוב: node scripts/torah-deploy.mjs')
  process.exit(0)
}

// 1. דחיפה ל-GitHub
if (githubToken) {
  console.log(`\n1. דוחף שינויים ל-GitHub (${githubUsername}/social-app:codex/torah-social-foundation)...`)
  try {
    const remoteUrl = `https://${githubToken}@github.com/${githubUsername}/social-app.git`
    execSync(`git push ${remoteUrl} codex/torah-social-foundation`, {stdio: 'inherit'})
    console.log('✓ הדחיפה ל-GitHub הושלמה בהצלחה!')
  } catch (err) {
    console.error('❌ שגיאה בדחיפה ל-GitHub:', err.message)
    process.exit(1)
  }
}

// 2. הפעלת עדכון על שרת האורקל במידה ויש מפתח SSH
if (sshKeyPath && fs.existsSync(sshKeyPath)) {
  console.log(`\n2. מתחבר ב-SSH לשרת האורקל (${oracleUser}@${oracleHost})...`)
  const remoteCommand = [
    'cd /home/ubuntu/social-app || cd ~/social-app || cd ~/torah-social',
    'git pull origin codex/torah-social-foundation',
    'docker restart torah-social-web || sudo docker restart torah-social-web',
  ].join(' && ')

  try {
    const sshCmd = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no ${oracleUser}@${oracleHost} "${remoteCommand}"`
    execSync(sshCmd, {stdio: 'inherit'})
    console.log('✓ הפריסה בשרת האורקל הסתיימה בהצלחה!')
    console.log(`האתר זמין בכתובת: https://torah-${oracleHost.replaceAll('.', '-')}.nip.io`)
  } catch (err) {
    console.error('❌ שגיאה בהרצת פקודה על שרת האורקל:', err.message)
  }
} else if (!sshKeyPath) {
  console.log('\nשים לב: לא סופק מפתח SSH לשרת האורקל.')
  console.log('הקוד נדחף ל-GitHub. ניתן למשוך אותו בשרת האורקל (דרך Cloud Shell או SSH) ולהפעיל מחדש את torah-social-web.')
}
