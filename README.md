# Excalidraw Desktop App

A lightweight desktop app for [Excalidraw](https://excalidraw.com/) built with Tauri v2 + React.

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Rust](https://rustup.rs/) toolchain
- Windows: MSVC C++ build tools (via Visual Studio Build Tools)
- macOS: Xcode Command Line Tools (`xcode-select --install`)

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

## Features

- Full Excalidraw editor experience
- Native file open/save dialogs (.excalidraw files)
- Dark/light theme toggle
- Tiny footprint compared to Electron
