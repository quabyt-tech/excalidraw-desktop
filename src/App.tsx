import { useState, useCallback, useRef, useEffect } from "react";
import {
  Excalidraw,
  MainMenu,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import Titlebar from "./Titlebar";

window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

export default function App() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const currentFileRef = useRef<string | null>(null);

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
    if (!excalidrawAPI) return;

    try {
      const elements = excalidrawAPI.getSceneElements();
      const appState = excalidrawAPI.getAppState();
      const files = excalidrawAPI.getFiles();
      const data = serializeAsJSON(elements, appState, files, "local");

      let filePath = currentFileRef.current;
      if (!filePath) {
        const selected = await save({
          defaultPath: "drawing.excalidraw",
          filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        });
        if (!selected) return;
        filePath = selected;
        currentFileRef.current = filePath;
      }

      await writeTextFile(filePath, data);
    } catch (err) {
      console.error("Save failed:", err);
    }
  }, [excalidrawAPI]);

  const handleOpen = useCallback(async () => {
    if (!excalidrawAPI) return;

    try {
      const selected = await open({
        filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        multiple: false,
      });
      if (!selected) return;

      const filePath = typeof selected === "string" ? selected : selected;
      const content = await readTextFile(filePath);
      const parsed = JSON.parse(content);

      excalidrawAPI.updateScene({
        elements: parsed.elements,
        appState: parsed.appState,
      });
      currentFileRef.current = filePath;
    } catch (err) {
      console.error("Open failed:", err);
    }
  }, [excalidrawAPI]);

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

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <Titlebar />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          theme={theme}
          onLinkOpen={handleLinkOpen as any}
          onChange={(_elements, appState) => {
            if (appState.theme !== theme) setTheme(appState.theme);
          }}
          UIOptions={{
            canvasActions: {
              export: false,
            },
          }}
        >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.Item onSelect={handleOpen}>Open File...</MainMenu.Item>
          <MainMenu.Item onSelect={handleSave}>Save File...</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        </Excalidraw>
      </div>
    </div>
  );
}
