# 🎙 opencode-plugin-voice

Ditado por voz para a TUI do **[OpenCode 2.0](https://opencode.ai)**: aperte um
atalho, fale, e a transcrição aparece no seu prompt — sem trocar de janela, sem
copiar e colar manualmente.

> Fala → áudio gravado → transcrição (Groq Whisper) → texto no prompt do OpenCode.

Foi feito para uso pessoal no dia a dia, mas funciona em qualquer máquina com
OpenCode 2.0 e `ffmpeg`.

---

## Índice

- [O que ele faz](#o-que-ele-faz)
- [Fluxo de uso](#fluxo-de-uso)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração da API](#configuração-da-api)
- [Atalhos e comandos](#atalhos-e-comandos)
- [Opções](#opções)
- [Como o texto entra no prompt](#como-o-texto-entra-no-prompt)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Desenvolvimento e testes](#desenvolvimento-e-testes)
- [Solução de problemas](#solução-de-problemas)
- [Limitações e roadmap](#limitações-e-roadmap)

---

## O que ele faz

- **Grava direto do microfone** usando `ffmpeg` (DirectShow no Windows,
  AVFoundation no macOS, PulseAudio no Linux), em WAV mono 16 kHz — o formato
  ideal para Whisper.
- **Transcreve** enviando o áudio para um endpoint **OpenAI-compatível**. O
  padrão é o **Groq** (`whisper-large-v3-turbo`), que é **grátis** e muito rápido
  em português. Também funciona com OpenAI e com servidores Whisper locais
  (`faster-whisper-server`, `whisper.cpp server`, Speaches…).
- **Entrega o texto no prompt** do OpenCode automaticamente, pronto para você
  revisar e enviar (ou enviar direto, se preferir).
- **Toda a configuração pela interface**: `/voice-config` ajusta API key,
  provider, modelo, idioma, microfone, atalho e modo de entrega.
- **Sem dependências nativas** no plugin: só o `ffmpeg` no sistema.

## Fluxo de uso

```
Ctrl+X V
   │
   ├─► ffmpeg começa a gravar na hora  ──►  aviso "🎙 Gravando"
   │
   ├─► você fala enquanto o aviso está aberto
   │
   ├─► fecha o aviso (X / Esc / botão)
   │        └─► ffmpeg finaliza o WAV
   │
   ├─► POST {baseUrl}/audio/transcriptions   (multipart, Bearer API key)
   │
   └─► transcrição colada no prompt para revisar e enviar
```

Não precisa apertar o atalho de novo nem colar manualmente: **fechar o aviso é o
sinal de "pare e transcreva"**.

## Requisitos

| Requisito | Detalhe |
| --- | --- |
| **OpenCode 2.0** | Testado com `2.0.32` |
| **ffmpeg** | No `PATH`, ou aponte `ffmpegPath` |
| **API key** | Grátis no [Groq](https://console.groq.com/keys) (recomendado) |

Instalando o ffmpeg:

```sh
# Windows
winget install Gyan.FFmpeg
# ou: scoop install ffmpeg

# macOS
brew install ffmpeg

# Linux
sudo apt install ffmpeg
```

## Instalação

O plugin é um **CLI/TUI plugin** do OpenCode 2.0. O jeito mais simples de
desenvolvê-lo é ter o código numa pasta e criar dois shims no diretório global
de plugins, que o OpenCode descobre automaticamente:

```ts
// ~/.config/opencode/plugins/voice/tui.ts
import plugin from "file:///C:/caminho/para/opencode-plugin-voice/src/tui.ts"
export default plugin
```

```ts
// ~/.config/opencode/plugins/voice/index.ts
import plugin from "file:///C:/caminho/para/opencode-plugin-voice/src/index.ts"
export default plugin
```

> No Windows, o diretório global é `C:\Users\<você>\.config\opencode\`.

Alternativas:

- copiar esta pasta para `<config-global>/plugins/voice/`;
- listar o pacote no `cli.json`:

```jsonc
// ~/.config/opencode/cli.json
{
  "plugins": [
    {
      "package": "C:/caminho/para/opencode-plugin-voice",
      "options": { "language": "pt" }
    }
  ]
}
```

Depois de instalar, **reinicie o OpenCode**. Um aviso "Voice — Pronto" confirma
que o plugin carregou.

## Configuração da API

1. Crie uma chave grátis em <https://console.groq.com/keys>.
2. No OpenCode, rode **`/voice-config`** → **API key** e cole a chave.

A chave também pode vir de outras fontes (a primeira encontrada vence):

1. valor salvo por `/voice-config`;
2. `options.apiKey` no `cli.json` / `opencode.json`;
3. variáveis de ambiente `OPENCODE_VOICE_API_KEY`, `GROQ_API_KEY` (ou
   `OPENAI_API_KEY`, conforme o provider);
4. arquivo legado `<config-global>/opencode/voice.json`
   (`{ "groq_api_key": "..." }`).

## Atalhos e comandos

| Ação | Como |
| --- | --- |
| Gravar / parar | **`Ctrl+X`** e depois **`V`** (configurável) |
| Alternativa | `/voice` (ou `/mic`) |
| Configurações | `/voice-config` (ou `/vconf`) |
| Parada automática | após `maxDurationMs` (2 min por padrão) |

> **Windows:** evite `Ctrl+Alt+<tecla>` — o sistema trata como **AltGr** e o
> terminal costuma engolir a combinação. O padrão `Ctrl+X V` funciona inclusive
> em terminais embutidos (VS Code, Windows Terminal).

## Opções

Disponíveis em `cli.json` → `plugins[].options`:

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `provider` | `groq` | `groq`, `openai` ou `custom` |
| `baseUrl` | por provider | Sobrescreve o endpoint (obrigatório em `custom`) |
| `apiKey` | env | Chave da API (prefira `/voice-config` ou env) |
| `model` | `whisper-large-v3-turbo` | Modelo de transcrição |
| `language` | `pt` | Código ISO-639-1, ou `""` para detectar |
| `prompt` | — | Prompt do Whisper (vocabulário/termos técnicos) |
| `device` | auto | Microfone de entrada |
| `ffmpegPath` | `ffmpeg` | Caminho do binário |
| `delivery` | `paste` | `paste`, `send` ou `clipboard` |
| `bind` | `<leader>v` (`Ctrl+X V`) | Atalho de gravar/parar |
| `maxDurationMs` | `120000` | Parada automática (`0` desativa) |
| `showIndicator` | `true` | Mostra o aviso "gravando" |

### Modos de entrega

- **`paste`** (padrão): cola a transcrição no prompt para revisar e enviar.
- **`send`**: envia direto como mensagem na sessão ativa (se não houver sessão
  aberta, cola no prompt).
- **`clipboard`**: apenas copia o texto.

### Exemplo com Whisper local

```jsonc
{
  "plugins": [
    {
      "package": "C:/caminho/para/opencode-plugin-voice",
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

## Como o texto entra no prompt

O OpenCode 2.0 **não expõe** aos plugins uma API para escrever diretamente no
campo de digitação (o `prompt`). O jeito suportado é:

1. copiar a transcrição para o **clipboard** do sistema;
2. disparar o comando nativo **`prompt.paste`** do OpenCode.

É exatamente o que acontece quando você aperta `Ctrl+V` — só que automático. Se
a colagem falhar por algum motivo, o texto continua no clipboard (e aparece no
aviso), sem perder nada.

## Estrutura do projeto

```
src/
├── index.ts       # entrypoint "server" (stub — permite carregar como plugin normal)
├── tui.ts         # entrypoint TUI: keymap, diálogos, toasts e o fluxo
├── config.ts      # resolução de config (storage + options + env + voice.json)
├── recorder.ts    # captura ffmpeg (WAV 16 kHz mono) e enumeração de microfones
├── transcribe.ts  # chamada ao endpoint OpenAI-compatível de transcrição
└── clipboard.ts   # escrita no clipboard do sistema (Windows/macOS/Linux)
```

O plugin usa apenas APIs públicas do `@opencode/plugin@2.0.x` (`Plugin.define`,
`context.keymap.layer`, `context.ui.dialog`, `context.ui.toast`,
`context.storage`, `context.client`).

## Desenvolvimento e testes

```sh
bun install
bun run typecheck

# grava 3s e mostra o tamanho do WAV (não transcreve)
bun run scripts/smoke.ts

# grava 3s e transcreve de verdade (usa a API key configurada)
bun run scripts/e2e.ts
```

O `e2e.ts` valida o caminho completo: microfone → WAV → HTTP → texto.

## Solução de problemas

| Problema | Causa / solução |
| --- | --- |
| `ffmpeg não encontrado` | Instale o ffmpeg ou defina `ffmpegPath` |
| Atalho não faz nada | `Ctrl+Alt…` é AltGr no Windows; use `Ctrl+X V` ou troque em `/voice-config` |
| `Nada foi reconhecido` | Microfone errado/baixo; confira em `/voice-config` → Microfone |
| `HTTP 401` | API key inválida/ausente |
| Não colou no prompt | O texto ficou no clipboard; cole com `Ctrl+V` ou use `/voice-config` → Entrega → Enviar direto |
| Plugin não carrega | Confira os shims em `~/.config/opencode/plugins/voice/` e reinicie o OpenCode |

## Limitações e roadmap

- [ ] Parada automática por silêncio (falar e parar sozinho, sem fechar o aviso)
- [ ] Streaming/transcrição parcial em tempo real
- [ ] Suporte a Whisper local com download automático de modelo
- [ ] Empacotar no npm para instalação com `plugins: ["opencode-plugin-voice"]`

---

Feito para uso pessoal com OpenCode 2.0. Sugestões e melhorias são bem-vindas.
