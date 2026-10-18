/**
 * End-to-end smoke test: record ~3 seconds with the real recorder, then
 * transcribe through the configured provider (Groq by default, key from
 * GROQ_API_KEY / voice.json).
 *
 * Run with: bun run scripts/e2e.ts
 */

import { cleanupRecording, listDevices, startCapture, stopCapture } from "../src/recorder"
import { resolveConfig } from "../src/config"
import { transcribeFile } from "../src/transcribe"

const ffmpeg = process.env.OPENCODE_VOICE_FFMPEG ?? "ffmpeg"
const config = resolveConfig({}, {})
console.log("provider:", config.provider, "| model:", config.model, "| language:", config.language)
console.log("baseUrl:", config.baseUrl)
console.log("apiKey:", config.apiKey ? `presente (${config.apiKey.slice(0, 6)}…)` : "AUSENTE")

const devices = await listDevices(ffmpeg, process.platform)
const device = process.env.OPENCODE_VOICE_DEVICE ?? devices[0]
console.log("device:", device ?? "(auto)")

const recording = await startCapture({ ffmpegPath: ffmpeg, device, platform: process.platform })
console.log("gravando 3s…")
await new Promise((resolve) => setTimeout(resolve, 3000))
await stopCapture(recording)

try {
  const { text } = await transcribeFile(recording.file, config)
  console.log("transcrição:", JSON.stringify(text))
} catch (error) {
  console.error("erro na transcrição:", error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await cleanupRecording(recording)
}
