/**
 * Manual smoke test for the recorder: enumerates audio devices, records ~3
 * seconds through the real startCapture()/stopCapture() code path, and prints
 * the resulting WAV size.
 *
 * Run with: bun run scripts/smoke.ts
 */

import { stat } from "node:fs/promises"
import { cleanupRecording, listDevices, startCapture, stopCapture } from "../src/recorder"

const ffmpeg = process.env.OPENCODE_VOICE_FFMPEG ?? "ffmpeg"

const devices = await listDevices(ffmpeg, process.platform)
console.log("devices:", JSON.stringify(devices))

const device = process.env.OPENCODE_VOICE_DEVICE ?? devices[0]
console.log("using device:", device ?? "(auto)")

const recording = await startCapture({ ffmpegPath: ffmpeg, device, platform: process.platform })
console.log("recording…", recording.file)
await new Promise((resolve) => setTimeout(resolve, 3000))
await stopCapture(recording)

const info = await stat(recording.file)
console.log("wav bytes:", info.size)
await cleanupRecording(recording)
console.log("done")
