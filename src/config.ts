/**
 * Configuration for the voice plugin.
 *
 * Values are resolved in this order (first defined wins):
 *   1. runtime overrides saved from `/voice-config` (durable plugin storage)
 *   2. plugin options from `cli.json` / `opencode.json`
 *   3. environment variables
 *   4. built-in defaults
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type DeliveryMode = "paste" | "send" | "clipboard"
export type VoiceProvider = "groq" | "openai" | "custom"

/** Values persisted through `context.storage.store("config", ...)`. */
export interface StoredConfig {
  apiKey?: string
  model?: string
  language?: string
  device?: string
  delivery?: DeliveryMode
  provider?: VoiceProvider
  baseUrl?: string
  bind?: string
}

/** Fully resolved, ready-to-use configuration. */
export interface ResolvedConfig {
  provider: VoiceProvider
  baseUrl: string
  apiKey?: string
  model: string
  language: string
  /** Optional Whisper prompt to bias spelling (e.g. keep identifiers verbatim). */
  prompt?: string
  /** DirectShow / avfoundation / pulse device. `undefined` means auto-detect. */
  device?: string
  ffmpegPath: string
  delivery: DeliveryMode
  /** Keybinding for toggling recording. */
  bind: string
  /** Hard stop after this many milliseconds. 0 disables the limit. */
  maxDurationMs: number
  /** Show the "recording" toast. */
  showIndicator: boolean
}

export const DEFAULT_BIND = "<leader>v"

const GROQ_BASE_URL = "https://api.groq.com/openai/v1"
const OPENAI_BASE_URL = "https://api.openai.com/v1"

const DEFAULTS: ResolvedConfig = {
  provider: "groq",
  baseUrl: GROQ_BASE_URL,
  model: "whisper-large-v3-turbo",
  language: "pt",
  ffmpegPath: "ffmpeg",
  delivery: "paste",
  bind: DEFAULT_BIND,
  maxDurationMs: 120_000,
  showIndicator: true,
}

/** Suggested models per provider, offered by `/voice-config`. */
export const KNOWN_MODELS: Record<VoiceProvider, readonly string[]> = {
  groq: ["whisper-large-v3-turbo", "whisper-large-v3"],
  openai: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
  custom: ["whisper-large-v3-turbo", "whisper-large-v3", "whisper-1", "Systran/faster-whisper-large-v3"],
}

function pick<T>(...values: (T | undefined | null)[]): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value
  }
  return undefined
}

function envApiKey(provider: VoiceProvider): string | undefined {
  return pick(
    process.env.OPENCODE_VOICE_API_KEY,
    provider === "groq" ? process.env.GROQ_API_KEY : undefined,
    provider === "openai" ? process.env.OPENAI_API_KEY : undefined,
  )
}

/** Cached contents of `<global-config>/opencode/voice.json`, if present. */
let globalVoiceFileCache: Record<string, unknown> | undefined

function globalVoiceFile(): Record<string, unknown> {
  if (globalVoiceFileCache) return globalVoiceFileCache
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  try {
    const parsed = JSON.parse(readFileSync(join(configHome, "opencode", "voice.json"), "utf8"))
    globalVoiceFileCache = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    globalVoiceFileCache = {}
  }
  return globalVoiceFileCache
}

/**
 * API key from the legacy `voice.json` file (`{ "groq_api_key": "..." }`,
 * `{ "api_key": "..." }`, ...), so an existing local config keeps working.
 */
function fileApiKey(provider: VoiceProvider): string | undefined {
  const data = globalVoiceFile()
  const stringAt = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : undefined)
  return pick(
    stringAt("api_key"),
    provider === "groq" ? stringAt("groq_api_key") : undefined,
    provider === "openai" ? stringAt("openai_api_key") : undefined,
  )
}

function asDelivery(value: unknown): DeliveryMode | undefined {
  return value === "paste" || value === "send" || value === "clipboard" ? value : undefined
}

function asProvider(value: unknown): VoiceProvider | undefined {
  return value === "groq" || value === "openai" || value === "custom" ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

/**
 * Merge the built-in defaults with plugin options and stored overrides.
 * `stored` is a Solid store proxy and is read synchronously.
 */
export function resolveConfig(
  options: Readonly<Record<string, unknown>> | undefined,
  stored: StoredConfig,
): ResolvedConfig {
  const provider = pick(asProvider(stored.provider), asProvider(options?.provider), DEFAULTS.provider)!
  const baseUrl = pick(
    stored.baseUrl,
    typeof options?.baseUrl === "string" ? options.baseUrl : undefined,
    provider === "custom" ? undefined : provider === "openai" ? OPENAI_BASE_URL : GROQ_BASE_URL,
    DEFAULTS.baseUrl,
  )!

  return {
    provider,
    baseUrl,
    apiKey: pick(
      stored.apiKey,
      typeof options?.apiKey === "string" ? options.apiKey : undefined,
      envApiKey(provider),
      fileApiKey(provider),
    ),
    model: pick(stored.model, typeof options?.model === "string" ? options.model : undefined, DEFAULTS.model)!,
    language: pick(
      stored.language,
      typeof options?.language === "string" ? options.language : undefined,
      DEFAULTS.language,
    )!,
    prompt: typeof options?.prompt === "string" && options.prompt !== "" ? options.prompt : undefined,
    device: pick(stored.device, typeof options?.device === "string" ? options.device : undefined),
    ffmpegPath: pick(
      typeof options?.ffmpegPath === "string" ? options.ffmpegPath : undefined,
      process.env.OPENCODE_VOICE_FFMPEG,
      DEFAULTS.ffmpegPath,
    )!,
    delivery: pick(asDelivery(stored.delivery), asDelivery(options?.delivery), DEFAULTS.delivery)!,
    bind: pick(stored.bind, typeof options?.bind === "string" ? options.bind : undefined, DEFAULTS.bind)!,
    maxDurationMs: pick(asNumber(options?.maxDurationMs), DEFAULTS.maxDurationMs)!,
    showIndicator: options?.showIndicator === undefined ? DEFAULTS.showIndicator : options.showIndicator !== false,
  }
}
