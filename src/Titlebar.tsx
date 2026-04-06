import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();
const isMac = navigator.userAgent.includes("Mac");

export default function Titlebar() {
  if (isMac) {
    return (
      <div data-tauri-drag-region className="titlebar titlebar-mac">
        <div className="titlebar-title" data-tauri-drag-region>
          Excalidraw Desktop
        </div>
      </div>
    );
  }

  return (
    <div data-tauri-drag-region className="titlebar">
      <div className="titlebar-title" data-tauri-drag-region>
        Excalidraw Desktop
      </div>
      <div className="titlebar-buttons">
        <button
          className="titlebar-btn"
          onClick={() => appWindow.minimize()}
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          onClick={() => appWindow.toggleMaximize()}
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              width="9"
              height="9"
              x="0.5"
              y="0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={() => appWindow.close()}
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
