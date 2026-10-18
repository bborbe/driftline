// Records the medal pace lap off the main thread: ~5000 physics ticks (~2 s) would stall the page at load.
import type { Track } from '../track/schema'
import { recordPaceLap } from './pace'

self.onmessage = (e: MessageEvent<Track>) => self.postMessage(recordPaceLap(e.data))
