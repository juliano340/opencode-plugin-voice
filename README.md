# opencode-plugin-voice

Ditado por voz para a TUI do **OpenCode 2.0**. Aperte um atalho, fale, e a
transcrição aparece no seu prompt para você revisar e enviar.

- **Captura**: `ffmpeg` grava WAV mono 16 kHz direto do microfone (DirectShow no
  Windows, AVFoundation no macOS, PulseAudio no Linux).
- **Transcrição**: endpoint **OpenAI-compatível** — por padrão o **Groq**
  (`whisper-large-v3-turbo`, plano grátis). Também aceita OpenAI e servidores
  locais (`faster-whisper-server`, `whisper.cpp server`, Speaches…).
- **Entrega**: **cola no prompt automaticamente** (padrão). Também dá para
  enviar direto na sessão ativa ou apenas copiar.

## Requisitos

1. **OpenCode 2.0**.
2. **ffmpeg** no `PATH` (ou aponte `ffmpegPath` nas opções).
   - Windows: `winget install Gyan.FFmpeg` ou `scoop install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`
3. **API key do Groq** (grátis): crie em <https://console.groq.com/keys>.

## Instalação

O plugin é descoberto automaticamente a partir do diretório global de plugins,
então não é preciso editar o `cli.json`. Crie dois shims (o mesmo padrão usado
pelo plugin `time`) que apontam para o código em `D:\sandbox\OpenCode_Plugins\voice`:

```ts
// ~/.config/opencode/plugins/voice/tui.ts
import plugin from "file:///D:/sandbox/OpenCode_Plugins/voice/src/tui.ts"
export default plugin
```

```ts
// ~/.config/opencode/plugins/voice/index.ts
import plugin from "file:///D:/sandbox/OpenCode_Plugins/voice/src/index.ts"
export default plugin
```

> No Windows o diretório global é `C:\Users\<você>\.config\opencode\`.
> Se preferir não usar shim, copie a pasta inteira para
> `<config-global>/plugins/voice/` ou liste via caminho absoluto no `cli.json`:
>
> ```jsonc
> // ~/.config/opencode/cli.json
> {
>   "plugins": [{ "package": "D:/sandbox/OpenCode_Plugins/voice", "options": { "language": "pt" } }]
> }
> ```

Reinicie o OpenCode. A primeira execução mostra um toast "Voice pronto".

### API key

A chave é procurada, em ordem:

1. valor salvo por `/voice-config`;
2. `options.apiKey` no `cli.json`;
3. variáveis de ambiente `OPENCODE_VOICE_API_KEY` ou `GROQ_API_KEY`;
4. arquivo legado `<config-global>/opencode/voice.json` (`{ "groq_api_key": "..." }`).

## Uso

1. **`Ctrl+X` e depois `V`** (configurável) ou **`/voice`** — começa a gravar na
   hora; abre um aviso **"🎙 Gravando"**.
2. **Fale enquanto o aviso está aberto.**
3. **Feche o aviso** (X, Esc ou o botão) — a gravação para, transcreve e o
   texto é colado no prompt automaticamente.

Não precisa apertar o atalho de novo nem colar manualmente.

- **`/voice-config`** — API key, provider, modelo, idioma, microfone e modo de
  entrega.
- Padrão de entrega: **colar no prompt** (revise e aperte Enter). `send` envia
  direto na sessão ativa; `clipboard` só copia.

## Opções (`cli.json` → `plugins[].options`)

| Opção           | Padrão                   | Descrição                                                        |
| --------------- | ------------------------ | ---------------------------------------------------------------- |
| `provider`      | `groq`                   | `groq`, `openai` ou `custom`.                                    |
| `baseUrl`       | (por provider)           | Sobrescreve o endpoint. Obrigatório com `provider: "custom"`.     |
| `apiKey`        | env                      | Chave da API (prefira `/voice-config` ou env).                   |
| `model`         | `whisper-large-v3-turbo` | Modelo de transcrição.                                           |
| `language`      | `pt`                     | Código ISO-639-1, ou `""` para detectar.                          |
| `prompt`        | —                        | Prompt do Whisper (bias de vocabulário, ex.: termos técnicos).    |
| `device`        | auto                     | Dispositivo de entrada (ex.: `Microphone (Realtek(R) Audio)`).    |
| `ffmpegPath`    | `ffmpeg`                 | Caminho do binário ffmpeg.                                        |
| `delivery`      | `paste`                  | `paste`, `send` ou `clipboard`.                                  |
| `bind`          | `<leader>v` (ctrl+x v)   | Atalho de gravar/parar (também em `/voice-config`).               |
| `maxDurationMs` | `120000`                 | Parada automática. `0` desativa.                                  |
| `showIndicator` | `true`                   | Mostra o aviso "gravando" (fechar = parar).                      |

### Exemplo com servidor Whisper local

```jsonc
{
  "plugins": [
    {
      "package": "D:/sandbox/OpenCode_Plugins/voice",
      "options": {
        "provider": "custom",
        "baseUrl": "http://127.0.0.1:8000/v1",
        "apiKey": "local",
        "model": "Systran/faster-whisper-large-v3"
      }
    }
  ]
}
```

## Problemas comuns

- **"ffmpeg não encontrado"** — instale o ffmpeg ou defina `ffmpegPath`.
- **"Nada foi reconhecido"** — microfone errado/baixo; teste `/voice-config` →
  microfone e confira se aparece áudio.
- **HTTP 401** — API key inválida/ausente.
- **Não colou no prompt** — o plugin cai no clipboard; cole com `Ctrl+V`.
- **Atalho não faz nada** — `Ctrl+Alt+` no Windows é AltGr e o terminal pode
  engolir; use o padrão `Ctrl+X V` ou troque em `/voice-config` → Atalho
  (ex.: `f4`).

## Como funciona

```
Ctrl+Alt+V
   ├── ffmpeg -f dshow -i audio="Microfone" -ac 1 -ar 16000 → temp.wav
   ├── aviso "🎙 Gravando" (fale enquanto ele está aberto)
   ├── fechar o aviso → 'q' no stdin do ffmpeg → finaliza o WAV
   ├── POST {baseUrl}/audio/transcriptions (multipart, Bearer apiKey)
   └── clipboard + keymap.dispatch("prompt.paste")  → texto no prompt
```

A inserção no composer é feita copiando para o clipboard e disparando o comando
nativo `prompt.paste` do OpenCode, porque o V2 não expõe uma API de "anexar ao
prompt" para plugins.

## Estrutura

```
src/
├── index.ts       # entrypoint server (stub; habilita o carregamento via plugin normal)
├── tui.ts         # entrypoint TUI: keymap, diálogos, toasts, fluxo
├── config.ts      # resolução de configuração (options + storage + env)
├── recorder.ts    # captura ffmpeg (WAV 16k mono) e enumeração de dispositivos
├── transcribe.ts  # chamada ao endpoint de transcrição
└── clipboard.ts   # escrita no clipboard do sistema
```

## Desenvolvimento

```sh
bun install
bun run typecheck
bun run scripts/smoke.ts   # grava 3s e imprime o tamanho do WAV (sem transcrever)
bun run scripts/e2e.ts     # grava 3s e transcreve de verdade (usa a API key)
```
