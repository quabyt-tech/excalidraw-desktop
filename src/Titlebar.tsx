import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();
const isMac = navigator.userAgent.includes("Mac");

interface TitlebarProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  currentFile: string | null;
  onSave: () => void;
  dirty: boolean;
}

function SaveButton({ onSave, dirty }: { onSave: () => void; dirty: boolean }) {
  return (
    <button
      className="titlebar-btn theme-toggle-btn"
      onClick={onSave}
      disabled={!dirty}
      title={dirty ? "Save (Ctrl+S)" : "All changes saved"}
      aria-label="Save"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
    </button>
  );
}

function ThemeToggle({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
  return (
    <button
      className="titlebar-btn theme-toggle-btn"
      onClick={onToggleTheme}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )}
    </button>
  );
}

export default function Titlebar({ theme, onToggleTheme, currentFile, onSave, dirty }: TitlebarProps) {
  const fileName = currentFile ? currentFile.split(/[\\/]/).pop() : null;
  const title = fileName
    ? `Excalidraw Desktop - ${dirty ? "● " : ""}${fileName}`
    : "Excalidraw Desktop";
  if (isMac) {
    return (
      <div data-tauri-drag-region className="titlebar titlebar-mac">
        <img src="/icon.png" alt="" className="titlebar-icon" draggable={false} />
        <div className="titlebar-title" data-tauri-drag-region>
          {title}
        </div>
        <div className="titlebar-actions">
          <SaveButton onSave={onSave} dirty={dirty} />
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </div>
    );
  }

  return (
    <div data-tauri-drag-region className="titlebar">
      <img src="/icon.png" alt="" className="titlebar-icon" draggable={false} />
      <div className="titlebar-title" data-tauri-drag-region>
        {title}
      </div>
      <div className="titlebar-buttons">
        <SaveButton onSave={onSave} dirty={dirty} />
        <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
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
