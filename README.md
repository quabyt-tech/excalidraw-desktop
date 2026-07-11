# Excalidraw Desktop App

A lightweight desktop app for [Excalidraw](https://excalidraw.com/) built with Tauri v2 + React.

## Install

Download the installer for your platform from [Releases](https://github.com/quabyt-tech/excalidraw-desktop/releases):

- **Windows**: `.exe` (NSIS) or `.msi`
- **macOS**: `.dmg` (Apple Silicon and Intel)
- **Linux**: `.deb`, `.rpm`, or `.AppImage`

No other dependencies needed — the app uses the OS webview (WebView2 on Windows is installed automatically if missing).

## Features

- Full Excalidraw editor experience
- Native file open/save dialogs (.excalidraw files), unsaved-changes indicator
- Install libraries from [libraries.excalidraw.com](https://libraries.excalidraw.com) straight into the app; your library persists across restarts
- Dark/light theme toggle
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
