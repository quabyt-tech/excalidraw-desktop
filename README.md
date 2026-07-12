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

### Work with real files

- **Folder workspace**: open a folder and get a file-explorer sidebar with nested folders, inline create/rename, and right-click actions (rename, delete, reveal in file manager). Point it at a OneDrive/Dropbox/Google Drive folder and your drawings sync across machines.
- **True save semantics**: Ctrl+S writes straight to the `.excalidraw` file, Ctrl+Shift+S for Save As. No downloads folder, no permission prompts.
- **Autosave**: flip the titlebar toggle and changes are written a moment after you stop drawing.
- **Never lose work**: unsaved-changes indicator, and a warning before closing, opening, or switching files would discard edits.
- **File association**: double-click any `.excalidraw` file to open it in the app.
- **Open Recent**: last 10 files, one hover away in the menu.
- **Session restore**: reopens the file you were working on when you relaunch.
- **External-edit detection**: if the open file changes on disk (git pull, cloud sync, another editor), the app reloads it, asking first if you have unsaved changes.
- **Safe deletes**: sidebar deletes go to the OS recycle bin / trash.

### Shape libraries, organized

- **A section per library**: each imported library shows up under its own collapsible title (like draw.io's shape palette), instead of everything merging into one flat pile. Collapse the ones you're not using, remove a whole library with one click.
- **One-click installs**: "Add to Excalidraw" on [libraries.excalidraw.com](https://libraries.excalidraw.com) opens straight in the app via deep link; grab AWS, Azure, GCP, and other shape packs from there and each lands as its own section. Re-importing a library updates it in place.
- **Local imports**: load `.excalidrawlib` files from disk via the sidebar.
- **Personal section**: select shapes on the canvas, right-click, "Add to library", and they land in your own section.
- **Click or drag to insert**: click a shape to drop it at the center of the view, or drag it anywhere on the canvas.
- **Persists across restarts**: your libraries are stored locally, and existing libraries migrate automatically.

### Desktop-grade behavior

- **Auto-update**: the app checks GitHub releases on startup and updates itself (signed packages).
- **Preferences that stick**: theme, grid, zen mode, snapping, and canvas background survive restarts.
- **Single instance**: relaunching focuses the existing window instead of opening a duplicate.
- **Native touches**: custom titlebar, external links open in your default browser, tiny footprint compared to Electron (a few MB, using the OS webview).
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

## Contributing

Contributions are welcome! Fork the repo, create a branch, and open a pull request against `main`. For larger changes, please open an issue first to discuss the approach.

## License

[MIT](LICENSE): free to use, modify, and distribute; provided "as is", without warranty of any kind.

This app embeds the [@excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) editor, which is also MIT-licensed, all credit for the editor itself goes to the Excalidraw team. This project is not affiliated with or endorsed by Excalidraw.
