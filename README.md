# Excalidraw Desktop App

A lightweight desktop app for [Excalidraw](https://excalidraw.com/) built with [Tauri](https://tauri.app/) + React.

## Install

Download the installer for your platform from [Releases](https://github.com/quabyt-tech/excalidraw-desktop/releases):

- **Windows**: `.exe` installer
- **macOS**: `.dmg` (Apple Silicon and Intel)
- **Linux**: `.deb` (Debian/Ubuntu), `.rpm` (Fedora/openSUSE), or `.AppImage` (any distro, self-updating)

No other dependencies needed, the app uses the OS webview (WebView2 on Windows is installed automatically if missing).

## Why the desktop app?

The full Excalidraw editor, plus everything a real desktop tool should do that a browser tab (or PWA) can't:

- **Real files**: a folder-workspace sidebar (nested folders, inline create/rename, right-click actions), true `Ctrl+S` save, autosave, Open Recent, session restore, file association, external-edit detection, and safe deletes to the OS trash.
- **Organized shape libraries**: each imported library is its own collapsible section; one-click installs from [libraries.excalidraw.com](https://libraries.excalidraw.com), local `.excalidrawlib` imports, and a personal section for your own shapes.
- **AI Diagram**: describe a diagram in plain words and drop editable shapes on the canvas, via Gemini (free AI Studio keys) or Anthropic. See [Security & API keys](#security--api-keys).
- **Desktop-grade behavior**: self-updating (signed packages), persistent preferences, single-instance, custom titlebar, and a tiny footprint using the OS webview.
- **Cross-platform**: Windows, macOS, and Linux.

## Developing

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Rust](https://rustup.rs/) toolchain
- Windows: MSVC C++ build tools (via Visual Studio Build Tools)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Linux: `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## Getting Started

```bash
bun install
bun run tauri dev
```

## Build for Production

```bash
bun run tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

## Security & API keys

The AI Diagram feature calls a model provider (Google Gemini or Anthropic) using
**your own** API key. A few things to know about how that key is handled:

- **Keys never leave your machine except to the provider.** The app ships a strict
  Content-Security-Policy (`connect-src` in `src-tauri/tauri.conf.json`) that limits
  all network requests to the provider endpoints (`generativelanguage.googleapis.com`,
  `api.anthropic.com`) plus Excalidraw's library CDN. Any attempt by app code or a
  dependency to send a key to a different host is blocked by the webview before the
  request leaves your computer.
- **Keys are stored locally, in plain text.** They live in the app's `localStorage`
  (per provider) so you don't have to re-enter them. This means anyone with access to
  your user profile's app data on disk can read them. Treat provider API keys as
  revocable secrets: prefer free / rate-limited keys (e.g. Google AI Studio), and
  revoke and rotate a key if your machine may be compromised.
- **No client app can protect a key on a fully compromised machine**, since the app
  must decrypt and use the key to make the request. The controls above defend against
  network exfiltration and casual access, not against malware already running as you.

To revoke a key: Google AI Studio → API keys, or the Anthropic Console → API keys.

## Contributing

Contributions are welcome! Fork the repo, create a branch, and open a pull request against `main`. For larger changes, please open an issue first to discuss the approach.

## License

[MIT](LICENSE): free to use, modify, and distribute; provided "as is", without warranty of any kind.

This app embeds the [@excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) editor, which is also MIT-licensed, all credit for the editor itself goes to the Excalidraw team. This project is not affiliated with or endorsed by Excalidraw.
