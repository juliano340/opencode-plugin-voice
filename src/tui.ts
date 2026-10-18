/**
 * opencode-plugin-voice — TUI entrypoint (OpenCode 2.0).
 *
 * Flow:
 *   1. keybind -> ffmpeg starts writing a 16 kHz mono WAV immediately.
 *   2. a modal notice ("🎙 Gravando") appears. Speak while it is open.
 *   3. close the notice -> recording stops, audio goes to the transcription
 *      endpoint (Groq by default) and the text is pasted into the prompt.
 *
 * Delivery: "paste" is the default. It copies the transcript to the clipboard
 * and dispatches OpenCode's own `prompt.paste` command, because V2 does not
 * expose a direct "append to prompt" API to plugins. "send" submits straight
 * to the active session; "clipboard" only copies.
 */

import { Plugin } from "@opencode/plugin/tui"
import { copyToClipboard } from "./clipboard.js"
import {
  KNOWN_MODELS,
  resolveConfig,
  type DeliveryMode,
  type ResolvedConfig,
  type StoredConfig,
} from "./config.js"
import { cleanupRecording, listDevices, startCapture, stopCapture, type Recording } from "./recorder.js"
import { transcribeFile } from "./transcribe.js"

type Phase = "idle" | "recording" | "working"

const DELIVERY_LABEL: Record<DeliveryMode, string> = {
  paste: "Colar no prompt (revisar antes de enviar)",
  send: "Enviar direto na sessão ativa",
  clipboard: "Só copiar para o clipboard",
}

export default Plugin.define({
  id: "opencode.voice.tui",
  setup(context) {
    const [stored, updateStored] = context.storage.store<StoredConfig>("config", { initial: {} })

    let phase: Phase = "idle"
    let active: Recording | undefined
    let autoStop: ReturnType<typeof setTimeout> | undefined
    let cachedDevice: string | undefined
    let stopWaiter: (() => void) | undefined
    let dialogOpen = false

    const config = (): ResolvedConfig => resolveConfig(context.options, stored)

    const toast = (input: {
      variant?: "info" | "success" | "warning" | "error"
      title?: string
      message: string
      duration?: number
    }) => context.ui.toast.show(input)

    // ---------------------------------------------------------------- toggle

    /** Ends the current recording and unblocks begin(). */
    function requestStop(): void {
      if (dialogOpen) {
        dialogOpen = false
        context.ui.dialog.clear()
      }
      stopWaiter?.()
    }

    async function toggle(): Promise<void> {
      if (phase === "recording") {
        requestStop()
        return
      }
      if (phase === "working") {
        toast({ variant: "info", message: "Aguarde a transcrição terminar…" })
        return
      }
      await begin()
    }

    async function begin(): Promise<void> {
      const cfg = config()

      if (!cfg.apiKey) {
        toast({
          variant: "warning",
          title: "Voice",
          message: "Nenhuma API key configurada. Abrindo /voice-config…",
        })
        await openConfig()
        return
      }

      const device = cfg.device ?? (await resolveDevice(cfg))

      let recording: Recording
      try {
        recording = await startCapture({ ffmpegPath: cfg.ffmpegPath, device, platform: process.platform })
      } catch (error) {
        toast({ variant: "error", title: "Voice", message: errorMessage(error), duration: 7000 })
        return
      }

      // Recording is already running: the user can speak right away.
      active = recording
      phase = "recording"

      const stopped = new Promise<void>((resolve) => {
        stopWaiter = resolve
      })

      if (cfg.maxDurationMs > 0) autoStop = setTimeout(requestStop, cfg.maxDurationMs)

      try {
        if (cfg.showIndicator) {
          // Closing the notice (X / Esc / button) resolves the promise, which
          // is our signal to stop recording and transcribe.
          dialogOpen = true
          const closed = context.ui.dialog
            .alert({
              title: "🎙 Gravando",
              message:
                "Fale agora. Feche este aviso quando terminar — a transcrição entra no prompt automaticamente.",
            })
            .finally(() => {
              dialogOpen = false
            })
          await Promise.race([closed, stopped])
        } else {
          await stopped
        }
      } finally {
        stopWaiter = undefined
        if (autoStop) {
          clearTimeout(autoStop)
          autoStop = undefined
        }
      }

      if (active === recording) await finish()
    }

    async function finish(): Promise<void> {
      const recording = active
      active = undefined
      if (!recording) return
      if (autoStop) {
        clearTimeout(autoStop)
        autoStop = undefined
      }

      phase = "working"
      const cfg = config()
      toast({ variant: "info", title: "⏳ Transcrevendo", message: `Modelo ${cfg.model}…`, duration: 8000 })

      try {
        await stopCapture(recording)
        const { text } = await transcribeFile(recording.file, cfg)
        await cleanupRecording(recording)

        if (!text) {
          toast({ variant: "warning", title: "Voice", message: "Nada foi reconhecido no áudio.", duration: 5000 })
          return
        }
        await deliver(text, cfg)
      } catch (error) {
        await cleanupRecording(recording)
        toast({ variant: "error", title: "Voice", message: errorMessage(error), duration: 8000 })
      } finally {
        phase = "idle"
      }
    }

    // --------------------------------------------------------------- deliver

    async function deliver(text: string, cfg: ResolvedConfig): Promise<void> {
      // "send" only sends when a session is open; otherwise paste instead.
      if (cfg.delivery === "send") {
        const route = context.ui.router.current()
        if (route.type === "session") {
          await context.client.session.prompt({ sessionID: route.sessionID, text })
          toast({ variant: "success", title: "Voice", message: "Enviado para a sessão.", duration: 4000 })
          return
        }
      }

      if (cfg.delivery === "clipboard") {
        const copied = await copyToClipboard(text)
        toast(
          copied === "ok"
            ? { variant: "success", title: "Voice", message: "Copiado para o clipboard. Cole com Ctrl+V.", duration: 5000 }
            : {
                variant: "warning",
                title: "Voice",
                message: `Não consegui acessar o clipboard. Transcrição:\n${text}`,
                duration: 15_000,
              },
        )
        return
      }

      // paste (default), or send without an open session
      const copied = await copyToClipboard(text)
      if (copied === "ok") {
        try {
          context.keymap.dispatch("prompt.paste")
          toast({ variant: "success", title: "Voice", message: "Transcrição no prompt — revise e envie.", duration: 4000 })
          return
        } catch {
          // fall through to the visible transcript
        }
      }
      toast({
        variant: "warning",
        title: "Voice",
        message: `Não consegui colar automaticamente. Transcrição:\n${text}`,
        duration: 15_000,
      })
    }

    // ---------------------------------------------------------------- config

    async function openConfig(): Promise<void> {
      for (;;) {
        const cfg = config()
        const choice = await context.ui.dialog.select<string>({
          title: "Voice — configurações",
          options: [
            {
              title: `API key ${cfg.apiKey ? "(definida)" : "(não definida)"}`,
              value: "apiKey",
              description: "Groq: crie uma chave grátis em console.groq.com",
            },
            { title: `Provider: ${cfg.provider}`, value: "provider" },
            { title: `Modelo: ${cfg.model}`, value: "model" },
            { title: `Idioma: ${cfg.language}`, value: "language" },
            {
              title: `Microfone: ${cfg.device ?? "(auto)"}`,
              value: "device",
              description: process.platform === "win32" ? "Dispositivos DirectShow" : undefined,
            },
            { title: `Entrega: ${DELIVERY_LABEL[cfg.delivery]}`, value: "delivery" },
            { title: `Atalho: ${cfg.bind}`, value: "bind", description: "Ex.: <leader>v (ctrl+x v), f4, ctrl+shift+m, alt+m" },
            { title: "Fechar", value: "close" },
          ],
        })

        if (!choice || choice === "close") return

        if (choice === "apiKey") {
          const value = await context.ui.dialog.prompt({
            title: "API key de transcrição",
            description: "Fica salva localmente, por plugin.",
            placeholder: "gsk_…",
            value: cfg.apiKey ?? "",
          })
          if (value !== undefined) await updateStored((draft) => void (draft.apiKey = value.trim() || undefined))
          continue
        }

        if (choice === "provider") {
          const value = await context.ui.dialog.select<ResolvedConfig["provider"]>({
            title: "Provider",
            current: cfg.provider,
            options: [
              { title: "groq", value: "groq", description: "Grátis, rápido (recomendado)" },
              { title: "openai", value: "openai", description: "Pago" },
              { title: "custom", value: "custom", description: "Endpoint OpenAI-compatível (local)" },
            ],
          })
          if (value) await updateStored((draft) => void (draft.provider = value))
          continue
        }

        if (choice === "model") {
          const value = await context.ui.dialog.prompt({
            title: "Modelo de transcrição",
            description: `Sugestões: ${KNOWN_MODELS[cfg.provider].join(", ")}`,
            value: cfg.model,
          })
          if (value !== undefined) await updateStored((draft) => void (draft.model = value.trim() || undefined))
          continue
        }

        if (choice === "language") {
          const value = await context.ui.dialog.prompt({
            title: "Idioma",
            description: "Código ISO-639-1 (pt, en, es…) ou vazio para detectar.",
            value: cfg.language,
          })
          if (value !== undefined) await updateStored((draft) => void (draft.language = value.trim()))
          continue
        }

        if (choice === "device") {
          const devices = await listDevices(cfg.ffmpegPath, process.platform)
          const value = await context.ui.dialog.select<string>({
            title: "Microfone",
            current: cfg.device ?? "",
            options: [
              { title: "(auto)", value: "", description: "Detecta o primeiro microfone" },
              ...devices.map((device) => ({ title: device, value: device })),
            ],
          })
          if (value !== undefined) await updateStored((draft) => void (draft.device = value || undefined))
          continue
        }

        if (choice === "bind") {
          const value = await context.ui.dialog.prompt({
            title: "Atalho para gravar/parar",
            description: "Ex.: <leader>v (ctrl+x v), f4, ctrl+shift+m, alt+m",
            value: cfg.bind,
          })
          if (value !== undefined) await updateStored((draft) => void (draft.bind = value.trim() || undefined))
          continue
        }

        if (choice === "delivery") {
          const value = await context.ui.dialog.select<DeliveryMode>({
            title: "O que fazer com a transcrição",
            current: cfg.delivery,
            options: (Object.keys(DELIVERY_LABEL) as DeliveryMode[]).map((mode) => ({
              title: DELIVERY_LABEL[mode],
              value: mode,
            })),
          })
          if (value) await updateStored((draft) => void (draft.delivery = value))
          continue
        }
      }
    }

    // --------------------------------------------------------------- devices

    async function resolveDevice(cfg: ResolvedConfig): Promise<string | undefined> {
      if (process.platform !== "win32") return undefined
      if (cachedDevice !== undefined) return cachedDevice
      const devices = await listDevices(cfg.ffmpegPath, process.platform)
      cachedDevice = devices[0]
      return cachedDevice
    }

    // ----------------------------------------------------------- keymap layer

    context.keymap.layer(() => {
      const cfg = config()
      return {
        mode: "global",
        priority: 10,
        commands: [
          {
            id: "voice.toggle",
            title: "Voice: gravar / parar",
            description: "Ditar por voz e transcrever para o prompt",
            group: "Voice",
            bind: cfg.bind,
            palette: true,
            slash: { name: "voice", aliases: ["mic"] },
            run: () => toggle(),
          },
          {
            id: "voice.config",
            title: "Voice: configurações",
            group: "Voice",
            palette: true,
            slash: { name: "voice-config", aliases: ["vconf"] },
            run: () => openConfig(),
          },
        ],
        bindings: ["voice.toggle"],
      }
    })

    context.ui.toast.show({
      variant: "info",
      title: "Voice",
      message: `Pronto. ${config().bind} ou /voice para ditar.`,
      duration: 4000,
    })

    return async () => {
      if (autoStop) clearTimeout(autoStop)
      if (dialogOpen) context.ui.dialog.clear()
      if (active) {
        await stopCapture(active)
        await cleanupRecording(active)
        active = undefined
      }
    }
  },
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
