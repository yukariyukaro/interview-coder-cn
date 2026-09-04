import { createSyncServer } from './server'

const port = Number(process.env.SYNC_SERVER_PORT ?? 8787)
const host = process.env.SYNC_SERVER_HOST
const server = createSyncServer({ port, host })

await server.ready
console.log(`Sync server listening at ${server.url}`)

async function shutdown(): Promise<void> {
  await server.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
