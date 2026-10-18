/**
 * Speech-to-text through an OpenAI-compatible transcription endpoint.
 *
 * Works with Groq (free tier, recommended), OpenAI, and any local server that
 * exposes `POST {baseUrl}/audio/transcriptions` (faster-whisper-server,
 * whisper.cpp server, Speaches, ...).
 */

import { readFile } from "node:fs/promises"
import type { ResolvedConfig } from "./config.js"

export interface TranscribeResult {
  readonly text: string
  readonly model: string
}

/** Transcription error carrying a user-facing message. */
export class TranscriptionError extends Error {}

export async function transcribeFile(
  filePath: string,
  config: ResolvedConfig,
  options: { signal?: AbortSignal } = {},
): Promise<TranscribeResult> {
  if (!config.apiKey) {
    throw new TranscriptionError(
      "Nenhuma API key configurada. Rode /voice-config e informe a chave do Groq (console.groq.com).",
    )
  }
  if (!config.baseUrl) {
    throw new TranscriptionError("baseUrl não configurada (provider \"custom\" exige baseUrl).")
  }

  const audio = await readFile(filePath)
  const form = new FormData()
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav")
  form.append("model", config.model)
  if (config.language) form.append("language", config.language)
  form.append("response_format", "json")
  form.append("temperature", "0")
  if (config.prompt) form.append("prompt", config.prompt)

  const url = `${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new TranscriptionError(`Falha de rede ao chamar ${url}: ${errorMessage(error)}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new TranscriptionError(
      `Transcrição falhou (HTTP ${response.status}): ${body.slice(0, 300).trim() || response.statusText}`,
    )
  }

  const payload = (await response.json().catch(() => undefined)) as { text?: string } | undefined
  const text = (payload?.text ?? "").trim()
  return { text, model: config.model }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
