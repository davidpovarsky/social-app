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

const DEFAULT_KEY_PATH = 'C:\\Users\\DAVID\\Downloads\\Torah-Social-Oracle\\torah-social-oci.key'
const targetBranch = 'codex/torah-social-runtime-repair'
const githubToken = env.GITHUB_TOKEN || process.env.GITHUB_TOKEN
const githubUsername = env.GITHUB_USERNAME || process.env.GITHUB_USERNAME || 'davidpovarsky'
const oracleHost = env.ORACLE_HOST || process.env.ORACLE_HOST || '130.110.238.163'
const oracleUser = env.ORACLE_USER || process.env.ORACLE_USER || 'ubuntu'
const sshKeyPath =
  env.SSH_KEY_PATH ||
  process.env.SSH_KEY_PATH ||
  (fs.existsSync(DEFAULT_KEY_PATH) ? DEFAULT_KEY_PATH : undefined)

console.log(`Target Branch: ${targetBranch}`)
console.log(`Oracle Host:   ${oracleHost}`)
console.log(`SSH Key:       ${sshKeyPath || 'None'}`)

// 1. דחיפה ל-GitHub
if (githubToken) {
  console.log(`\n1. דוחף שינויים ל-GitHub (${githubUsername}/social-app:${targetBranch})...`)
  try {
    const remoteUrl = `https://${githubToken}@github.com/${githubUsername}/social-app.git`
    execSync(`git push ${remoteUrl} ${targetBranch}`, {stdio: 'inherit'})
    console.log('✓ הדחיפה ל-GitHub הושלמה בהצלחה!')
  } catch (err) {
    console.error('❌ שגיאה בדחיפה ל-GitHub:', err.message)
    process.exit(1)
  }
} else {
  console.log(`\n1. דוחף שינויים ל-GitHub בענף הנוכחי (${targetBranch})...`)
  try {
    execSync(`git push origin ${targetBranch}`, {stdio: 'inherit'})
    console.log('✓ הדחיפה ל-GitHub הושלמה בהצלחה!')
  } catch (err) {
    console.log('הערה בדחיפה ל-GitHub:', err.message)
  }
}

// 2. הפעלת עדכון על שרת האורקל במידה ויש מפתח SSH
if (sshKeyPath && fs.existsSync(sshKeyPath)) {
  console.log(`\n2. מתחבר ב-SSH לשרת האורקל (${oracleUser}@${oracleHost})...`)
  const remoteCommand = [
    'sudo git -C /opt/torah-social/social-app fetch origin ' + targetBranch,
    'sudo git -C /opt/torah-social/social-app reset --hard FETCH_HEAD',
    'sudo git -C /opt/torah-social/social-app checkout -B ' + targetBranch + ' FETCH_HEAD',
    'sudo docker build ' +
      '--build-arg EXPO_PUBLIC_TORAH_PDS_HOST=https://pds-' + oracleHost.replaceAll('.', '-') + '.nip.io ' +
      '--build-arg EXPO_PUBLIC_TORAH_PDS_DID=did:web:pds-' + oracleHost.replaceAll('.', '-') + '.nip.io ' +
      '--build-arg EXPO_PUBLIC_TORAH_APPVIEW_HOST=https://appview-' + oracleHost.replaceAll('.', '-') + '.nip.io ' +
      '--build-arg EXPO_PUBLIC_BLUESKY_PROXY_DID=did:key:zQ3shmuFmJgBGwJugBx4QhgKV5uBW3Qd7RTWMMQto6r8Guq8H ' +
      '--build-arg EXPO_PUBLIC_TORAH_ISOLATED_NETWORK=true ' +
      '--build-arg EXPO_PUBLIC_ENV=production ' +
      '-t torah-social-web:latest /opt/torah-social/social-app',
    'sudo docker rm -f torah-social-web || true',
    'sudo docker run -d ' +
      '--name torah-social-web ' +
      '--restart unless-stopped ' +
      '-p 127.0.0.1:8100:8100 ' +
      '-e ATP_APPVIEW_HOST=https://appview-' + oracleHost.replaceAll('.', '-') + '.nip.io ' +
      '-e HTTP_ADDRESS=:8100 ' +
      '-e ROBOTS_DISALLOW_ALL=true ' +
      'torah-social-web:latest',
  ].join(' && ')

  try {
    const sshCmd = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no ${oracleUser}@${oracleHost} "${remoteCommand}"`
    console.log('מריץ בנייה ופריסה בשרת האורקל...')
    execSync(sshCmd, {stdio: 'inherit'})
    console.log('\n✓ הפריסה בשרת האורקל הסתיימה בהצלחה!')
    console.log(`האתר זמין ומעודכן בכתובת: https://torah-${oracleHost.replaceAll('.', '-')}.nip.io`)
  } catch (err) {
    console.error('❌ שגיאה בהרצת פקודה על שרת האורקל:', err.message)
    process.exit(1)
  }
} else {
  console.log('\nשים לב: לא נמצא מפתח SSH תקין לשרת האורקל.')
}
