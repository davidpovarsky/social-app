import { fork } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lexBin = path.resolve(__dirname, '../node_modules/@atproto/lex/bin/lex')

const child = fork(lexBin, ['build', '--clear', '--index-file', '--import-ext', ''], {
  stdio: 'inherit',
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
