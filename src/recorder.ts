/**
 * Microphone capture through ffmpeg.
 *
 * We record a mono 16 kHz 16-bit PCM WAV, which is exactly what Whisper-based
 * transcription endpoints expect. The recording is written to a temp file and
 * finalised cleanly by writing `q` to ffmpeg's stdin (SIGKILL as a fallback).
 */

import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** How long we wait after spawn before assuming the recorder is healthy. */
const STARTUP_GRACE_MS = 400
/** How long we wait for the graceful `q` quit before force-killing. */
const STOP_TIMEOUT_MS = 5_000
/** How long we wait after SIGKILL before giving up on the process. */
const KILL_GRACE_MS = 800

export interface Recording {
  readonly file: string
  readonly child: ChildProcess
}

export interface StartOptions {
  ffmpegPath: string
  device?: string
  platform?: NodeJS.Platform
}

export function tempAudioPath(): string {
  return join(tmpdir(), `opencode-voice-${Date.now()}-${randomUUID().slice(0, 8)}.wav`)
}

/** Build the ffmpeg argument list for the current platform. */
export function captureArgs(
  platform: NodeJS.Platform,
  device: string | undefined,
  outFile: string,
): string[] {
  const base = ["-hide_banner", "-loglevel", "error", "-y"]
  if (platform === "win32") {
    return [
      ...base,
      "-f",
      "dshow",
      "-i",
      `audio=${device ?? "default"}`,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outFile,
    ]
  }
  if (platform === "darwin") {
    return [
      ...base,
      "-f",
      "avfoundation",
      "-i",
      device ?? ":0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outFile,
    ]
  }
  return [
    ...base,
    "-f",
    "pulse",
    "-i",
    device ?? "default",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outFile,
  ]
}

/**
 * Parse `ffmpeg -list_devices true -f dshow -i dummy` output and return the
 * names of the DirectShow audio capture devices.
 *
 * Handles both output shapes: newer ffmpeg tags each device line with
 * `(audio)` / `(video)`, older builds group devices under
 * "DirectShow audio devices" / "DirectShow video devices" headers.
 */
export function parseDshowAudioDevices(text: string): string[] {
  const devices: string[] = []
  let inAudio = false
  for (const line of text.split(/\r?\n/)) {
    if (/DirectShow audio devices/i.test(line)) {
      inAudio = true
      continue
    }
    if (/DirectShow video devices/i.test(line)) {
      inAudio = false
      continue
    }
    if (/Alternative name/i.test(line)) continue

    const tagged = line.match(/"([^"]+)"\s*\((audio|video)\)/i)
    if (tagged) {
      if (tagged[2].toLowerCase() === "audio") devices.push(tagged[1])
      continue
    }

    if (inAudio) {
      const match = line.match(/"([^"]+)"/)
      if (match) devices.push(match[1])
    }
  }
  return devices
}

/** Enumerate DirectShow audio devices (Windows only). */
export function listDevices(ffmpegPath: string, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (platform !== "win32") return Promise.resolve([])
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      windowsHide: true,
    })
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once("error", () => resolve([]))
    child.once("close", () => resolve(parseDshowAudioDevices(stderr)))
  })
}

/**
 * Start recording. Resolves once the recorder is running, or rejects with a
 * useful message when ffmpeg is missing or the device cannot be opened.
 */
export async function startCapture(options: StartOptions): Promise<Recording> {
  const platform = options.platform ?? process.platform
  const file = tempAudioPath()
  const args = captureArgs(platform, options.device, file)
  const child = spawn(options.ffmpegPath, args, {
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  })

  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
    if (stderr.length > 8_000) stderr = stderr.slice(-8_000)
  })

  const failure = await new Promise<Error | undefined>((resolve) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(error)
    }
    const timer = setTimeout(() => finish(undefined), STARTUP_GRACE_MS)
    child.once("error", (error: Error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        finish(new Error(`ffmpeg não encontrado em "${options.ffmpegPath}". Instale (winget install ffmpeg) ou defina ffmpegPath.`))
      } else {
        finish(error)
      }
    })
    child.once("exit", (code) => {
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).slice(-2).join(" ").trim()
        finish(new Error(`ffmpeg saiu com código ${code}${detail ? `: ${detail}` : ""}`))
      } else {
        finish(undefined)
      }
    })
  })

  if (failure) {
    try {
      await unlink(file)
    } catch {}
    throw failure
  }

  return { file, child }
}

/** Stop recording, finalising the WAV file. Never throws. */
export async function stopCapture(recording: Recording): Promise<void> {
  const { child } = recording
  if (child.exitCode !== null || child.signalCode !== null) return

  await new Promise<void>((resolve) => {
    let done = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (done) return
      done = true
      if (killTimer) clearTimeout(killTimer)
      resolve()
    }

    child.once("close", finish)

    // Ask ffmpeg to finalise the container and exit.
    try {
      child.stdin?.write("q\n")
      child.stdin?.end()
    } catch {}

    killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {}
      setTimeout(finish, KILL_GRACE_MS)
    }, STOP_TIMEOUT_MS)
  })
}

/** Remove the temporary audio file. Never throws. */
export async function cleanupRecording(recording: Recording): Promise<void> {
  try {
    await unlink(recording.file)
  } catch {}
}
