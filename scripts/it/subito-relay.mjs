// Subito relay: Subito.it refuses datacenter IPs (GitHub runners get
// "Access Denied"), so a machine on a home connection runs this daily and
// commits the snapshot the GitHub pipeline reads (public/it/cache/subito.json,
// trusted for 3 days). Run via tools/subito-relay.sh, or by hand:
//   node scripts/it/subito-relay.mjs

import { writeFileSync, mkdirSync } from 'fs'
import { AREA } from './area.mjs'
import { searchLive } from './sources/subito.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const listings = await searchLive(AREA)
if (listings.length < 10) {
  console.error(`subito-relay: solo ${listings.length} annunci, non sovrascrivo la copia`)
  process.exit(1)
}
mkdirSync(ROOT + 'public/it/cache', { recursive: true })
writeFileSync(ROOT + 'public/it/cache/subito.json', JSON.stringify({ fetched: new Date().toISOString(), listings }))
console.log(`subito-relay: ${listings.length} annunci salvati`)
