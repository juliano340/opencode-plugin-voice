/**
 * Server-side entrypoint.
 *
 * The voice plugin is TUI-only: recording, transcription and prompt delivery
 * all happen in the terminal process. This stub exists so the package can also
 * be listed as a regular plugin (its `./tui` export is then loaded by the CLI).
 */

import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode.voice",
  setup() {},
})
