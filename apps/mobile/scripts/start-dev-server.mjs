/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const args = process.argv.slice(2)
const METRO_PORT = getMetroPort(args)

function getMetroPort(args) {
  const portIndex = args.findIndex((arg) => arg === '--port' || arg === '-p')
  if (portIndex >= 0) return Number(args[portIndex + 1] || process.env.RCT_METRO_PORT || 8081)

  const portArg = args.find((arg) => arg.startsWith('--port='))
  if (portArg) return Number(portArg.slice('--port='.length))

  return Number(process.env.RCT_METRO_PORT || 8081)
}

function getLanAddress() {
  const interfaces = networkInterfaces()
  const preferredNames = ['en0', 'en1']

  for (const name of preferredNames) {
    const address = findAddress(interfaces[name])
    if (address) return address
  }

  for (const addresses of Object.values(interfaces)) {
    const address = findAddress(addresses)
    if (address) return address
  }

  return null
}

function findAddress(addresses) {
  return addresses?.find((address) => address.family === 'IPv4' && !address.internal)?.address
}

function printDevBuildUrl() {
  const address = getLanAddress()
  if (!address) return

  process.stdout.write(`\nDevelopment Build 可手动连接 Metro： http://${address}:${METRO_PORT}\n\n`)
}

printDevBuildUrl()

const expo = spawn('expo', ['start', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

expo.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

expo.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

process.on('SIGINT', () => expo.kill('SIGINT'))
process.on('SIGTERM', () => expo.kill('SIGTERM'))
