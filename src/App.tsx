import { useState, useCallback, useRef, useEffect } from "react";
import {
  Excalidraw,
  MainMenu,
  loadFromBlob,
  serializeAsJSON,
  getSceneVersion,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import Titlebar from "./Titlebar";

const LIBRARY_FILE = "library.json";

async function loadStoredLibrary() {
  try {
    return JSON.parse(
      await readTextFile(LIBRARY_FILE, { baseDir: BaseDirectory.AppData })
    );
  } catch {
    return []; // no file yet, or corrupt
  }
}

window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

export default function App() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [dirty, setDirty] = useState(false);
  const savedVersionRef = useRef(0);

  const markSaved = (elements: Parameters<typeof getSceneVersion>[0]) => {
    savedVersionRef.current = getSceneVersion(elements);
    setDirty(false);
  };

  // Deep link from libraries.excalidraw.com: excalidraw-desktop://library#addLibrary=<url>
  const pendingLibraryUrlRef = useRef<string | null>(null);

  const importLibrary = useCallback(async (deepLink: string) => {
    const api = apiRef.current;
    if (!api) {
      pendingLibraryUrlRef.current = deepLink;
      return;
    }
    const hash = deepLink.slice(deepLink.indexOf("#") + 1);
    const libraryUrl = new URLSearchParams(hash).get("addLibrary");
    if (!libraryUrl) return;
    try {
      const blob = await (await fetch(libraryUrl)).blob();
      await api.updateLibrary({
        libraryItems: blob,
        merge: true,
        prompt: true,
        openLibraryMenu: true,
        defaultStatus: "published",
      });
    } catch (err) {
      console.error("Library import failed:", err);
      api.setToast({ message: `Library import failed: ${err}`, closable: true });
    }
  }, []);

  useEffect(() => {
    const unlisten = onOpenUrl((urls) => urls.forEach(importLibrary));
    return () => {
      unlisten.then((f) => f());
    };
  }, [importLibrary]);

  const setFile = (path: string | null) => {
    currentFileRef.current = path;
    setCurrentFile(path);
  };
  useEffect(() => {
    setMounted(true);
  }, []);

  // Intercept external link clicks and open in default browser
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href");
        if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
          e.preventDefault();
          openUrl(href);
        }
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const handleSave = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;

    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const json = serializeAsJSON(elements, appState, files, "local");

    let filePath = currentFileRef.current;
    if (!filePath) {
      const selected = await save({
        filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        defaultPath: (appState.name || "Untitled") + ".excalidraw",
      });
      if (!selected) return;
      filePath = selected;
      setFile(filePath);
    }

    try {
      await writeTextFile(filePath, json);
      markSaved(elements);
    } catch (err) {
      console.error("Save failed:", err);
      api.setToast({ message: `Save failed: ${err}`, closable: true });
    }
  }, []);

  // Intercept Ctrl+S before Excalidraw can handle it
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [handleSave]);

  const handleOpen = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const selected = await open({
        filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        multiple: false,
      });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected;
      const content = await readTextFile(filePath);
      const blob = new Blob([content], { type: "application/json" });
      const scene = await loadFromBlob(blob, api.getAppState(), api.getSceneElements());
      api.updateScene(scene);
      api.scrollToContent();
      setFile(filePath);
      markSaved(api.getSceneElements());
    } catch (err) {
      console.error("Open failed:", err);
    }
  }, []);

  const handleLinkOpen = useCallback(
    (_element: unknown, event: CustomEvent) => {
      const url = event.detail?.url;
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        event.preventDefault();
        openUrl(url);
      }
    },
    []
  );

  if (!mounted) return null;

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (excalidrawAPI) {
      excalidrawAPI.updateScene({ appState: { theme: next } });
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <Titlebar theme={theme} onToggleTheme={toggleTheme} currentFile={currentFile} onSave={handleSave} dirty={dirty} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw
          excalidrawAPI={(api) => {
            if (api) {
              setExcalidrawAPI(api);
              apiRef.current = api;
              if (pendingLibraryUrlRef.current) {
                importLibrary(pendingLibraryUrlRef.current);
                pendingLibraryUrlRef.current = null;
              }
            }
          }}
          libraryReturnUrl="excalidraw-desktop://library"
          initialData={{ libraryItems: loadStoredLibrary() }}
          onLibraryChange={async (items) => {
            try {
              await writeTextFile(LIBRARY_FILE, JSON.stringify(items), {
                baseDir: BaseDirectory.AppData,
              });
            } catch (err) {
              console.error("Library persist failed:", err);
              apiRef.current?.setToast({
                message: `Could not save library: ${err}`,
                closable: true,
              });
            }
          }}
          theme={theme}
          onLinkOpen={handleLinkOpen as any}
          onChange={(elements, appState) => {
            if (appState.theme !== theme) setTheme(appState.theme);
            setDirty(getSceneVersion(elements) !== savedVersionRef.current);
          }}
          UIOptions={{
            canvasActions: {
              export: false,
              saveToActiveFile: false,
            },
          }}
        >
        <MainMenu>
          <MainMenu.Item onSelect={() => setTimeout(handleOpen, 100)}>Open File...</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        </Excalidraw>
      </div>
    </div>
  );
}
