# Excalidraw Desktop App

A lightweight desktop app for [Excalidraw](https://excalidraw.com/) built with [Tauri](https://tauri.app/) + React.

## Install

Download the installer for your platform from [Releases](https://github.com/quabyt-tech/excalidraw-desktop/releases):

- **Windows**: `.exe` installer
- **macOS**: `.dmg` (Apple Silicon and Intel)
- **Linux**: `.deb` (Debian/Ubuntu), `.rpm` (Fedora/openSUSE), or `.AppImage` (any distro, self-updating)

No other dependencies needed, the app uses the OS webview (WebView2 on Windows is installed automatically if missing).

## Features

- Full Excalidraw editor experience
- Native file open/save dialogs (.excalidraw files) with Ctrl+S/Cmd+S support and an unsaved-changes indicator
- Opens `.excalidraw` files directly from your file manager (registered file association)
- Install libraries from [libraries.excalidraw.com](https://libraries.excalidraw.com) straight into the app; your library persists across restarts
- Dark/light theme toggle
- Single-instance app — relaunching focuses the existing window instead of opening a duplicate
- External links open in your default browser, not inside the app
- Cross-platform: Windows, macOS, and Linux
- Tiny footprint compared to Electron

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

## Contributing

Contributions are welcome! Fork the repo, create a branch, and open a pull request against `main`. For larger changes, please open an issue first to discuss the approach.

## License

[MIT](LICENSE). This app embeds the [@excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) editor, which is also MIT-licensed, all credit for the editor itself goes to the Excalidraw team.
