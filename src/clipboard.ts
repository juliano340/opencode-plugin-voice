/**
 * Write text to the system clipboard.
 *
 * On Windows the payload is base64-encoded and decoded inside PowerShell so
 * accents and newlines survive regardless of the console code page.
 */

import { spawn } from "node:child_process"

export type ClipboardResult = "ok" | "unsupported"

export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  if (process.platform === "win32") {
    const base64 = Buffer.from(text, "utf8").toString("base64")
    const script =
      `$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}')); ` +
      `Set-Clipboard -Value $t`
    await run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
    return "ok"
  }

  if (process.platform === "darwin") {
    await run("pbcopy", [], text)
    return "ok"
  }

  const candidates: Array<[string, string[]]> = [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ]
  for (const [command, args] of candidates) {
    try {
      await run(command, args, text)
      return "ok"
    } catch {}
  }
  return "unsupported"
}

function run(command: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? "ignore" : "pipe", "ignore", "pipe"],
      windowsHide: true,
    })
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} saiu com código ${code}: ${stderr.slice(0, 200)}`))
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}
