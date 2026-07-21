import { useState, useCallback, useRef, useEffect } from "react";
import {
  Excalidraw,
  MainMenu,
  Sidebar,
  exportToSvg,
  loadFromBlob,
  loadLibraryFromBlob,
  serializeAsJSON,
  getSceneVersion,
} from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { open, save, ask, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  readTextFile,
  writeTextFile,
  readDir,
  exists,
  rename,
  mkdir,
  watch,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { appDataDir } from "@tauri-apps/api/path";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import Titlebar from "./Titlebar";
import {
  LibraryPanel,
  insertLibraryItem,
  prettyLibName,
  emptySections,
  PERSONAL_ID,
  type LibrarySection,
} from "./LibraryPanel";
import type { LibraryItem } from "@excalidraw/excalidraw/types";

const LIBRARY_FILE = "library.json"; // pre-0.3.0 flat library, migrated into LIBRARIES_FILE
const LIBRARIES_FILE = "libraries.json";
const SETTINGS_FILE = "settings.json";
const MAX_RECENT = 10;

interface Settings {
  recentFiles: string[];
  autosave: boolean;
  workspaceDir: string | null;
  lastFile: string | null;
  showSidebar: boolean;
}
const DEFAULT_SETTINGS: Settings = {
  recentFiles: [],
  autosave: false,
  workspaceDir: null,
  lastFile: null,
  showSidebar: true,
};

const normPath = (p: string) => p.replace(/\\/g, "/");
const parentDir = (p: string) =>
  p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));

interface WsNode {
  name: string;
  path: string;
  dir: boolean;
  children?: WsNode[];
}

// Template picker groups: top-level dirs are categories, root files go under "General"
function tplGroups(nodes: WsNode[]) {
  const flatten = (ns: WsNode[]): WsNode[] =>
    ns.flatMap((n) => (n.dir ? flatten(n.children ?? []) : [n]));
  const root = nodes.filter((n) => !n.dir);
  return [
    ...(root.length ? [{ name: "General", files: root }] : []),
    ...nodes
      .filter((n) => n.dir)
      .map((d) => ({ name: d.name, files: flatten(d.children ?? []) }))
      .filter((g) => g.files.length > 0),
  ];
}

// ponytail: depth cap 4, hidden dirs skipped
async function buildTree(dir: string, depth = 0): Promise<WsNode[]> {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return [];
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  const nodes: WsNode[] = [];
  for (const e of entries.filter((e) => e.isDirectory && !e.name.startsWith(".")).sort(byName)) {
    const path = `${dir}/${e.name}`;
    nodes.push({ name: e.name, path, dir: true, children: await buildTree(path, depth + 1) });
  }
  for (const e of entries
    .filter((e) => e.isFile && e.name.endsWith(".excalidraw"))
    .sort(byName)) {
    nodes.push({ name: e.name, path: `${dir}/${e.name}`, dir: false });
  }
  return nodes;
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const FileIcon = () => (
  <svg {...iconProps} className="ws-icon ws-icon-file">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M8 13h2" />
    <path d="M8 17h5" />
    <path d="m13.5 12.5 2-2" />
  </svg>
);

const FolderIcon = ({ open }: { open: boolean }) =>
  open ? (
    <svg {...iconProps} className="ws-icon ws-icon-folder">
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  ) : (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className="ws-icon ws-icon-folder"
    >
      <path d="M2 5a2 2 0 0 1 2-2h4.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
    </svg>
  );

const FilePlusIcon = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const FolderPlusIcon = () => (
  <svg {...iconProps}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <line x1="12" y1="10" x2="12" y2="16" />
    <line x1="9" y1="13" x2="15" y2="13" />
  </svg>
);

async function loadLibrarySections(): Promise<LibrarySection[]> {
  try {
    const sections = JSON.parse(
      await readTextFile(LIBRARIES_FILE, { baseDir: BaseDirectory.AppData })
    );
    if (Array.isArray(sections) && sections.length) return sections;
  } catch {
    // no file yet, or corrupt — fall through to migration
  }
  try {
    const items = JSON.parse(
      await readTextFile(LIBRARY_FILE, { baseDir: BaseDirectory.AppData })
    );
    const sections = emptySections();
    if (Array.isArray(items)) sections[0].items = items;
    return sections;
  } catch {
    return emptySections();
  }
}

async function loadSettings(): Promise<Settings> {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(
        await readTextFile(SETTINGS_FILE, { baseDir: BaseDirectory.AppData })
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

// Slide order: frame name (numeric-aware); unnamed frames keep scene order
function sortedFrames(api: ExcalidrawImperativeAPI) {
  return api
    .getSceneElements()
    .filter((el) => el.type === "frame")
    .sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true })
    );
}

// Canvas preferences persisted across restarts (the web app keeps these in localStorage too)
const PREFS_KEY = "canvas-prefs";
const PREF_KEYS = [
  "viewBackgroundColor",
  "gridModeEnabled",
  "gridStep",
  "zenModeEnabled",
  "objectsSnapModeEnabled",
] as const;

function loadCanvasPrefs(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

// "Open Recent ▸" menu row with a hover flyout (Excalidraw's menu API has no submenu).
// Fixed positioning escapes the menu's scroll container; local state resets when the menu closes.
function RecentFlyout({
  files,
  onOpen,
}: {
  files: string[];
  onOpen: (path: string) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = (e: React.MouseEvent) => {
    window.clearTimeout(timer.current);
    const r = e.currentTarget.getBoundingClientRect();
    setPos({
      left: r.right + 2,
      top: Math.min(r.top - 4, window.innerHeight - 300),
    });
  };
  const hideSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPos(null), 150);
  };
  const cancelHide = () => window.clearTimeout(timer.current);

  return (
    <div
      className="recent-trigger"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <span>Open Recent</span>
      <span className="recent-caret">▸</span>
      {pos && (
        <div
          className="recent-flyout"
          style={pos}
          onMouseEnter={cancelHide}
          onMouseLeave={hideSoon}
        >
          {files.map((path) => (
            <button
              key={path}
              className="recent-flyout-item"
              title={path}
              onClick={() => onOpen(path)}
            >
              {baseName(path)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

export default function App() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("theme") === "dark" ? "dark" : "light"
  );
  const lastPrefsRef = useRef("");
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [dirty, setDirty] = useState(false);
  const savedVersionRef = useRef(0);

  // ---- Presentation mode: frames become slides
  const [presenting, setPresenting] = useState(false);
  const presentRef = useRef<{
    frames: string[];
    index: number;
    prev: Pick<
      AppState,
      | "viewModeEnabled"
      | "zenModeEnabled"
      | "frameRendering"
      | "scrollX"
      | "scrollY"
      | "zoom"
    >;
  } | null>(null);
  const [slide, setSlide] = useState({ index: 0, total: 0 });

  // Persisted settings (recent files, autosave, workspace)
  const settingsRef = useRef<Settings>({ ...DEFAULT_SETTINGS });
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [autosave, setAutosave] = useState(false);
  const autosaveRef = useRef(false);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [workspaceTree, setWorkspaceTree] = useState<WsNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // Folder targeted by the header new-file/new-folder buttons (click a row to set)
  const [selectedDir, setSelectedDir] = useState<string | null>(null);

  // Inline rename (mirrored in a ref so Enter+blur don't double-commit)
  const [renaming, setRenamingState] = useState<{ path: string; value: string; dir?: boolean } | null>(null);
  const renamingRef = useRef<typeof renaming>(null);
  const setRenaming = (r: typeof renaming) => {
    renamingRef.current = r;
    setRenamingState(r);
  };

  // Sidebar right-click context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: WsNode } | null>(null);

  // Drag-and-drop move (node in a ref: dataTransfer can't carry objects)
  const dragNodeRef = useRef<WsNode | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);

  // Templates: <appData>/templates, subfolders are categories
  const [tplPicker, setTplPicker] = useState<WsNode[] | null>(null);
  const tplDirRef = useRef<string>("");

  useEffect(() => {
    if (!tplPicker) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTplPicker(null);
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [tplPicker]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // Timestamp of our own last write, so file watchers can ignore it
  const lastWriteRef = useRef(0);

  // ---- Library sections: "Personal" (mirrors Excalidraw's internal library) + one per import
  const [libSections, setLibSections] = useState<LibrarySection[]>(emptySections);
  const libSectionsRef = useRef(libSections);
  const [libDocked, setLibDocked] = useState(true);
  const libSectionsPromiseRef = useRef<Promise<LibrarySection[]> | null>(null);
  if (!libSectionsPromiseRef.current) {
    // Kicked off on first render; initialData below reuses this promise, and our
    // .then is attached first so the ref is populated before onLibraryChange echoes.
    libSectionsPromiseRef.current = loadLibrarySections().then((sections) => {
      libSectionsRef.current = sections;
      setLibSections(sections);
      return sections;
    });
  }

  const updateLibSections = (
    mutate: (prev: LibrarySection[]) => LibrarySection[]
  ) => {
    const next = mutate(libSectionsRef.current);
    libSectionsRef.current = next;
    setLibSections(next);
    writeTextFile(LIBRARIES_FILE, JSON.stringify(next), {
      baseDir: BaseDirectory.AppData,
    }).catch((err) => {
      console.error("Library persist failed:", err);
      apiRef.current?.setToast({
        message: `Could not save library: ${err}`,
        closable: true,
      });
    });
  };

  // Re-importing a library with the same name replaces it (update-in-place)
  const addLibrarySection = (name: string, items: LibraryItem[]) => {
    updateLibSections((prev) => [
      ...prev.filter(
        (s) => s.id === PERSONAL_ID || s.name.toLowerCase() !== name.toLowerCase()
      ),
      { id: crypto.randomUUID(), name, items },
    ]);
    apiRef.current?.toggleSidebar({ name: "libraries", force: true });
  };

  const removeLibItem = (sectionId: string, itemId: string) => {
    updateLibSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.filter((i) => i.id !== itemId) }
          : s
      )
    );
    if (sectionId === PERSONAL_ID) {
      const items =
        libSectionsRef.current.find((s) => s.id === PERSONAL_ID)?.items ?? [];
      apiRef.current?.updateLibrary({ libraryItems: items });
    }
  };

  const removeLibSection = async (sectionId: string) => {
    const section = libSectionsRef.current.find((s) => s.id === sectionId);
    if (!section) return;
    const yes = await confirm(
      `Remove library "${section.name}" (${section.items.length} items)?`,
      { title: "Remove library", kind: "warning", okLabel: "Remove" }
    );
    if (!yes) return;
    updateLibSections((prev) => prev.filter((s) => s.id !== sectionId));
  };

  const handleImportLibraryFile = async () => {
    const selected = await open({
      filters: [
        { name: "Excalidraw library", extensions: ["excalidrawlib"] },
      ],
      multiple: false,
    });
    if (!selected) return;
    try {
      const content = await readTextFile(selected);
      const items = await loadLibraryFromBlob(new Blob([content]));
      addLibrarySection(prettyLibName(baseName(selected)), items as LibraryItem[]);
    } catch (err) {
      console.error("Library import failed:", err);
      apiRef.current?.setToast({
        message: `Library import failed: ${err}`,
        closable: true,
      });
    }
  };

  const handleBrowseLibraries = () =>
    openUrl(
      "https://libraries.excalidraw.com/?target=_blank&useHash=true&version=2&referrer=" +
        encodeURIComponent("excalidraw-desktop://library")
    );

  const settingsWriteQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persistSettings = (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;

    // Serialize writes and capture each immutable snapshot. Without this, nearby
    // updates (for example recents followed by lastFile) can finish out of order
    // and an older settings snapshot can overwrite the newer one.
    const write = settingsWriteQueueRef.current.then(() =>
      writeTextFile(SETTINGS_FILE, JSON.stringify(next, null, 2), {
        baseDir: BaseDirectory.AppData,
      })
    );
    settingsWriteQueueRef.current = write.catch((err) => {
      console.error("Settings persist failed:", err);
    });
    return settingsWriteQueueRef.current;
  };

  const addRecent = (path: string) => {
    const list = [
      path,
      ...settingsRef.current.recentFiles.filter((p) => p !== path),
    ].slice(0, MAX_RECENT);
    setRecentFiles(list);
    persistSettings({ recentFiles: list });
  };

  const setFile = (path: string | null) => {
    currentFileRef.current = path;
    setCurrentFile(path);
  };

  const markSaved = (elements: Parameters<typeof getSceneVersion>[0]) => {
    savedVersionRef.current = getSceneVersion(elements);
    setDirty(false);
  };

  const hasUnsavedChanges = () => {
    const api = apiRef.current;
    return (
      !!api && getSceneVersion(api.getSceneElements()) !== savedVersionRef.current
    );
  };

  const confirmDiscard = async (what: string) => {
    if (!hasUnsavedChanges()) return true;
    return confirm(`You have unsaved changes. Discard them and ${what}?`, {
      title: "Unsaved changes",
      kind: "warning",
      okLabel: "Discard",
    });
  };

  // Shared loader used by Open dialog, recents, workspace, file manager, reload
  const loadFile = useCallback(async (filePath: string) => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const content = await readTextFile(filePath);
      const blob = new Blob([content], { type: "application/json" });
      const scene = await loadFromBlob(blob, api.getAppState(), null);
      api.updateScene(scene);
      if (scene.files) api.addFiles(Object.values(scene.files));
      api.scrollToContent();
      setFile(filePath);
      markSaved(api.getSceneElements());
      addRecent(filePath);
      persistSettings({ lastFile: filePath });
    } catch (err) {
      console.error("Open failed:", err);
      api.setToast({ message: `Could not open ${baseName(filePath)}: ${err}`, closable: true });
    }
  }, []);

  const openPathGuarded = useCallback(
    async (filePath: string) => {
      if (filePath === currentFileRef.current) return;
      if (!(await confirmDiscard(`open ${baseName(filePath)}`))) return;
      await loadFile(filePath);
    },
    [loadFile]
  );

  // ---- Startup: settings, launch file (file manager double-click), second-instance opens
  const pendingOpenRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const unlisten = listen<string>("open-file", (event) => {
      if (apiRef.current) {
        openPathGuarded(event.payload);
      } else {
        pendingOpenRef.current = event.payload;
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [openPathGuarded]);

  const refreshWorkspace = useCallback(async (dir: string) => {
    setWorkspaceTree(await buildTree(dir));
  }, []);

  // Runs once the Excalidraw API is ready
  const onApiReady = useCallback(async () => {
    const settings = await loadSettings();
    settingsRef.current = settings;
    setRecentFiles(settings.recentFiles);
    setAutosave(settings.autosave);
    autosaveRef.current = settings.autosave;
    setShowSidebar(settings.showSidebar);
    if (settings.workspaceDir && (await exists(settings.workspaceDir))) {
      setWorkspaceDir(settings.workspaceDir);
      refreshWorkspace(settings.workspaceDir);
    }

    // A file double-clicked in the file manager wins; else reopen where we left off
    const launchFile =
      pendingOpenRef.current ?? (await invoke<string | null>("get_launch_file"));
    pendingOpenRef.current = null;
    const restore = launchFile ?? settings.lastFile;
    if (restore && (await exists(restore))) loadFile(restore);
  }, [loadFile, refreshWorkspace]);

  // ---- Warn before closing with unsaved changes (covers titlebar X, Alt+F4)
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (!hasUnsavedChanges()) return;
      const closeAnyway = await confirm(
        "You have unsaved changes. Close without saving?",
        { title: "Unsaved changes", kind: "warning", okLabel: "Close anyway" }
      );
      if (!closeAnyway) event.preventDefault();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // ---- Deep link from libraries.excalidraw.com: excalidraw-desktop://library#addLibrary=<url>
  const pendingLibraryUrlRef = useRef<string | null>(null);

  // Only libraries.excalidraw.com is a trusted source for addLibrary deep links;
  // anyone can craft an excalidraw-desktop://library#addLibrary=<url> link, so this
  // guards against fetching (and rendering the SVG preview of) an attacker-controlled URL.
  const TRUSTED_LIBRARY_HOST = "libraries.excalidraw.com";

  const importLibrary = useCallback(async (deepLink: string) => {
    const api = apiRef.current;
    if (!api) {
      pendingLibraryUrlRef.current = deepLink;
      return;
    }
    const hash = deepLink.slice(deepLink.indexOf("#") + 1);
    const libraryUrl = new URLSearchParams(hash).get("addLibrary");
    if (!libraryUrl) return;
    let parsed: URL;
    try {
      parsed = new URL(libraryUrl);
    } catch {
      console.warn("Library import rejected: not a valid URL:", libraryUrl);
      return;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== TRUSTED_LIBRARY_HOST) {
      console.warn("Library import rejected: untrusted source:", libraryUrl);
      api.setToast({
        message: `Refused to import library from untrusted source: ${parsed.hostname}`,
        closable: true,
      });
      return;
    }
    const name = prettyLibName(libraryUrl.split("/").pop() ?? "Library");
    try {
      // No confirmation: the user just clicked "Add to Excalidraw" on the
      // trusted library site; the host check above is the security gate
      const blob = await (await fetch(libraryUrl)).blob();
      const items = await loadLibraryFromBlob(blob);
      addLibrarySection(name, items as LibraryItem[]);
      api.setToast({ message: `Added library "${name}"`, closable: true });
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

  // ---- Check for app updates on startup (no-op in dev; endpoint only has release builds)
  useEffect(() => {
    (async () => {
      try {
        const update = await check();
        if (!update) return;
        const yes = await ask(
          `Version ${update.version} is available. Download and install now?`,
          { title: "Update available", kind: "info" }
        );
        if (!yes) return;
        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        console.warn("Update check failed:", err);
      }
    })();
  }, []);

  // ---- Intercept external link clicks and open in default browser
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
    localStorage.setItem("theme", theme);
  }, [theme]);

  // ---- Save
  const doSave = useCallback(async (forceDialog: boolean) => {
    const api = apiRef.current;
    if (!api) return;

    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const json = serializeAsJSON(elements, appState, files, "local");

    let filePath = forceDialog ? null : currentFileRef.current;
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
      lastWriteRef.current = Date.now();
      await writeTextFile(filePath, json);
      markSaved(elements);
      addRecent(filePath);
      persistSettings({ lastFile: filePath });
    } catch (err) {
      console.error("Save failed:", err);
      api.setToast({ message: `Save failed: ${err}`, closable: true });
    }
  }, []);

  const handleSave = useCallback(() => doSave(false), [doSave]);
  const handleSaveAs = useCallback(() => doSave(true), [doSave]);

  // ---- Templates
  const templatesDir = async () => {
    const dir = `${await appDataDir()}/templates`;
    await mkdir(dir, { recursive: true });
    tplDirRef.current = dir;
    return dir;
  };

  const handleSaveAsTemplate = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const dir = await templatesDir();
      const target = await save({
        filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        defaultPath: `${dir}/${baseName(currentFileRef.current ?? "Template.excalidraw")}`,
      });
      if (!target) return;
      await writeTextFile(
        target,
        serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local")
      );
      api.setToast({
        message: `Template saved: ${baseName(target).replace(/\.excalidraw$/, "")}`,
        closable: true,
      });
    } catch (err) {
      console.error("Save template failed:", err);
      apiRef.current?.setToast({ message: `Save template failed: ${err}`, closable: true });
    }
  }, []);

  const handleNewFromTemplate = useCallback(async () => {
    if (!(await confirmDiscard("start from a template"))) return;
    setTplPicker(await buildTree(await templatesDir()));
  }, []);

  const applyTemplate = async (path: string) => {
    setTplPicker(null);
    const api = apiRef.current;
    if (!api) return;
    try {
      const content = await readTextFile(path);
      const scene = await loadFromBlob(
        new Blob([content], { type: "application/json" }),
        api.getAppState(),
        null
      );
      api.updateScene(scene);
      if (scene.files) api.addFiles(Object.values(scene.files));
      api.scrollToContent();
      // A fresh unsaved copy: the template file itself is never the open file,
      // and the content has no backing file yet, so it starts out dirty
      setFile(null);
      savedVersionRef.current = -1;
      setDirty(true);
      persistSettings({ lastFile: null });
    } catch (err) {
      console.error("Template load failed:", err);
      api.setToast({ message: `Could not load template: ${err}`, closable: true });
    }
  };

  // ---- Autosave: save shortly after the scene becomes dirty (needs an open file)
  useEffect(() => {
    if (!dirty || !autosave || !currentFileRef.current) return;
    const timer = setTimeout(() => doSave(false), 2000);
    return () => clearTimeout(timer);
  }, [dirty, autosave, doSave]);

  const toggleAutosave = () => {
    const next = !autosaveRef.current;
    autosaveRef.current = next;
    setAutosave(next);
    persistSettings({ autosave: next });
  };

  // ---- Reload when the open file changes on disk (external edit)
  useEffect(() => {
    if (!currentFile) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    let reloading = false;
    watch(
      currentFile,
      async () => {
        if (Date.now() - lastWriteRef.current < 1500) return; // our own save
        if (reloading) return;
        reloading = true;
        try {
          if (hasUnsavedChanges()) {
            const reload = await confirm(
              `${baseName(currentFile)} changed on disk. Reload and lose your unsaved changes?`,
              { title: "File changed", kind: "warning", okLabel: "Reload" }
            );
            if (!reload) return;
          }
          await loadFile(currentFile);
        } finally {
          reloading = false;
        }
      },
      { delayMs: 300 }
    )
      .then((unwatch) => {
        if (cancelled) unwatch();
        else stop = unwatch;
      })
      .catch((err) => console.warn("File watch failed:", err));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [currentFile, loadFile]);

  // ---- Workspace: watch the folder for added/removed files
  useEffect(() => {
    if (!workspaceDir) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    watch(workspaceDir, () => refreshWorkspace(workspaceDir), {
      delayMs: 500,
      recursive: true,
    })
      .then((unwatch) => {
        if (cancelled) unwatch();
        else stop = unwatch;
      })
      .catch((err) => console.warn("Workspace watch failed:", err));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [workspaceDir, refreshWorkspace]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    setWorkspaceDir(selected);
    setSelectedDir(null);
    setShowSidebar(true);
    persistSettings({ workspaceDir: selected, showSidebar: true });
    refreshWorkspace(selected);
  }, [refreshWorkspace]);

  // × hides the sidebar; the folder stays remembered for the titlebar toggle
  const handleCloseFolder = () => {
    setShowSidebar(false);
    setSelectedDir(null);
    persistSettings({ showSidebar: false });
  };

  const toggleSidebar = useCallback(() => {
    if (showSidebar && workspaceDir) {
      handleCloseFolder();
    } else if (workspaceDir) {
      setShowSidebar(true);
      persistSettings({ showSidebar: true });
    } else {
      handleOpenFolder();
    }
  }, [showSidebar, workspaceDir, handleOpenFolder]);

  const createFileIn = useCallback(
    async (dir: string) => {
      const api = apiRef.current;
      if (!api) return;
      if (!(await confirmDiscard("create a new file"))) return;
      try {
        let name = "Untitled.excalidraw";
        for (let i = 2; await exists(`${dir}/${name}`); i++) {
          name = `Untitled-${i}.excalidraw`;
        }
        const path = `${dir}/${name}`;
        lastWriteRef.current = Date.now();
        await writeTextFile(path, serializeAsJSON([], api.getAppState(), {}, "local"));
        api.resetScene();
        setFile(path);
        markSaved(api.getSceneElements());
        addRecent(path);
        persistSettings({ lastFile: path });
        if (workspaceDir) {
          setExpandedDirs((prev) => new Set(prev).add(dir));
          await refreshWorkspace(workspaceDir);
        }
        // Drop straight into naming the new file
        setRenaming({ path, value: name.replace(/\.excalidraw$/, "") });
      } catch (err) {
        console.error("New file failed:", err);
        api.setToast({ message: `Could not create file: ${err}`, closable: true });
      }
    },
    [workspaceDir, refreshWorkspace]
  );

  const deleteNode = async (node: WsNode) => {
    // Nodes only ever come from the workspace tree, which requires an open folder.
    if (!workspaceDir) return;
    const yes = await confirm(
      node.dir
        ? `Move folder "${node.name}" and everything in it to the trash?`
        : `Move "${node.name}" to the trash?`,
      { title: node.dir ? "Delete folder" : "Delete file", kind: "warning", okLabel: "Move to Trash" }
    );
    if (!yes) return;
    try {
      await invoke("move_to_trash", { path: node.path, workspaceRoot: workspaceDir });
      const gone = normPath(node.path);
      const covers = (p: string) => {
        const pn = normPath(p);
        return pn === gone || pn.startsWith(gone + "/");
      };
      if (currentFileRef.current && covers(currentFileRef.current)) {
        apiRef.current?.resetScene();
        setFile(null);
        markSaved(apiRef.current?.getSceneElements() ?? []);
        persistSettings({ lastFile: null });
      }
      if (selectedDir && covers(selectedDir)) setSelectedDir(null);
      const recents = settingsRef.current.recentFiles.filter((p) => !covers(p));
      setRecentFiles(recents);
      persistSettings({ recentFiles: recents });
      if (workspaceDir) refreshWorkspace(workspaceDir);
    } catch (err) {
      console.error("Delete failed:", err);
      apiRef.current?.setToast({ message: `Delete failed: ${err}`, closable: true });
    }
  };

  const commitRename = async () => {
    const r = renamingRef.current;
    if (!r) return;
    setRenaming(null);
    const clean = r.value.trim().replace(/[\\/:*?"<>|]/g, "");
    const oldPath = r.path;
    const parent = oldPath.slice(
      0,
      Math.max(oldPath.lastIndexOf("/"), oldPath.lastIndexOf("\\"))
    );
    const newPath = `${parent}/${clean}${r.dir ? "" : ".excalidraw"}`;
    if (!clean || normPath(newPath) === normPath(oldPath)) return;
    try {
      if (await exists(newPath)) {
        apiRef.current?.setToast({
          message: `${baseName(newPath)} already exists`,
          closable: true,
        });
        return;
      }
      lastWriteRef.current = Date.now();
      await rename(oldPath, newPath);
      fixupPaths(oldPath, newPath, !!r.dir);
      if (workspaceDir) refreshWorkspace(workspaceDir);
    } catch (err) {
      console.error("Rename failed:", err);
      apiRef.current?.setToast({ message: `Rename failed: ${err}`, closable: true });
    }
  };

  // Fix up references to the old path after a rename/move
  // (a moved dir may contain the open file or recents)
  const fixupPaths = (oldPath: string, newPath: string, isDir: boolean) => {
    const on = normPath(oldPath);
    const remap = (p: string) => {
      const pn = normPath(p);
      if (pn === on) return newPath;
      if (isDir && pn.startsWith(on + "/")) return normPath(newPath) + pn.slice(on.length);
      return null;
    };
    const current = currentFileRef.current;
    const replaced = current ? remap(current) : null;
    if (replaced) {
      setFile(replaced);
      persistSettings({ lastFile: replaced });
    }
    const recents = settingsRef.current.recentFiles.map((p) => remap(p) ?? p);
    setRecentFiles(recents);
    persistSettings({ recentFiles: recents });
  };

  const moveNode = async (node: WsNode, destDir: string) => {
    const from = normPath(node.path);
    const dest = normPath(destDir);
    if (normPath(parentDir(node.path)) === dest) return; // already there
    if (node.dir && (dest === from || dest.startsWith(from + "/"))) return; // into itself
    const newPath = `${destDir}/${node.name}`;
    try {
      if (await exists(newPath)) {
        apiRef.current?.setToast({
          message: `${node.name} already exists in ${baseName(destDir)}`,
          closable: true,
        });
        return;
      }
      lastWriteRef.current = Date.now();
      await rename(node.path, newPath);
      fixupPaths(node.path, newPath, node.dir);
      setExpandedDirs((prev) => new Set(prev).add(destDir));
      if (workspaceDir) refreshWorkspace(workspaceDir);
    } catch (err) {
      console.error("Move failed:", err);
      apiRef.current?.setToast({ message: `Move failed: ${err}`, closable: true });
    }
  };

  const createFolderIn = useCallback(
    async (dir: string) => {
      try {
        let name = "New Folder";
        for (let i = 2; await exists(`${dir}/${name}`); i++) {
          name = `New Folder ${i}`;
        }
        const path = `${dir}/${name}`;
        await mkdir(path);
        if (workspaceDir) {
          setExpandedDirs((prev) => new Set(prev).add(dir));
          await refreshWorkspace(workspaceDir);
        }
        setRenaming({ path, value: name, dir: true });
      } catch (err) {
        console.error("New folder failed:", err);
        apiRef.current?.setToast({ message: `Could not create folder: ${err}`, closable: true });
      }
    },
    [workspaceDir, refreshWorkspace]
  );

  // ---- Frames panel: PowerPoint-style slide list
  const [frameThumbs, setFrameThumbs] = useState<
    { id: string; name: string; svg: string }[]
  >([]);
  const [framesDocked, setFramesDocked] = useState(true);
  const [hasFrames, setHasFrames] = useState(false);
  const framesOpenRef = useRef(false);
  const thumbTimerRef = useRef<number | undefined>(undefined);

  const refreshFrameThumbs = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const elements = api.getSceneElements();
    const files = api.getFiles();
    const bg = api.getAppState().viewBackgroundColor;
    const thumbs = await Promise.all(
      sortedFrames(api).map(async (frame, i) => {
        const name = frame.name ?? "Frame";
        try {
          const svg = await exportToSvg({
            elements,
            files,
            appState: { exportBackground: true, viewBackgroundColor: bg },
            exportingFrame: frame,
            skipInliningFonts: true,
          });
          if (!svg.getAttribute("viewBox")) {
            svg.setAttribute(
              "viewBox",
              `0 0 ${svg.getAttribute("width")} ${svg.getAttribute("height")}`
            );
          }
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "100%");
          // clipPath ids are frame ids, identical across exports; namespace them
          // per thumbnail or all inlined SVGs resolve against the first one's defs
          svg.querySelectorAll("clipPath").forEach((cp: Element) => {
            const next = `thumb${i}-${cp.id}`;
            svg
              .querySelectorAll(`[clip-path="url(#${cp.id})"]`)
              .forEach((el: Element) =>
                el.setAttribute("clip-path", `url(#${next})`)
              );
            cp.id = next;
          });
          return { id: frame.id, name, svg: svg.outerHTML };
        } catch {
          return { id: frame.id, name, svg: "" };
        }
      })
    );
    setFrameThumbs(thumbs);
  }, []);

  const goToFrame = (id: string) => {
    const api = apiRef.current;
    const frame = api?.getSceneElements().find((el) => el.id === id);
    if (api && frame) {
      // No fit option: center the frame and leave the user's zoom alone
      api.scrollToContent(frame, {
        animate: true,
        duration: 300,
      });
    }
  };

  // ---- Presentation mode
  const showSlide = useCallback((i: number) => {
    const api = apiRef.current;
    const p = presentRef.current;
    if (!api || !p) return;
    const index = Math.max(0, Math.min(i, p.frames.length - 1));
    p.index = index;
    setSlide({ index, total: p.frames.length });
    const frame = api.getSceneElements().find((el) => el.id === p.frames[index]);
    if (frame) {
      api.scrollToContent(frame, {
        fitToViewport: true,
        viewportZoomFactor: 1,
        animate: true,
        duration: 300,
      });
    }
  }, []);

  const startPresentation = useCallback(() => {
    const api = apiRef.current;
    if (!api || presentRef.current) return;
    const frames = sortedFrames(api);
    if (frames.length === 0) {
      api.setToast({
        message: "Add frames to the canvas to present them as slides",
        closable: true,
      });
      return;
    }
    const st = api.getAppState();
    presentRef.current = {
      frames: frames.map((f) => f.id),
      index: 0,
      prev: {
        viewModeEnabled: st.viewModeEnabled,
        zenModeEnabled: st.zenModeEnabled,
        frameRendering: st.frameRendering,
        scrollX: st.scrollX,
        scrollY: st.scrollY,
        zoom: st.zoom,
      },
    };
    setPresenting(true);
    getCurrentWindow().setFullscreen(true).catch(console.warn);
    api.updateScene({
      appState: {
        viewModeEnabled: true,
        zenModeEnabled: true,
        openMenu: null,
        frameRendering: { enabled: true, clip: true, name: false, outline: false },
      },
    });
    api.setActiveTool({ type: "laser" });
    showSlide(0);
  }, [showSlide]);

  const exitPresentation = useCallback(() => {
    const api = apiRef.current;
    const p = presentRef.current;
    if (!p) return;
    presentRef.current = null;
    setPresenting(false);
    getCurrentWindow().setFullscreen(false).catch(console.warn);
    if (api) {
      api.updateScene({ appState: p.prev });
      api.setActiveTool({ type: "selection" });
    }
  }, []);

  useEffect(() => {
    if (!presenting) return;
    const handler = (e: KeyboardEvent) => {
      const p = presentRef.current;
      if (!p) return;
      if (e.key === "Escape") exitPresentation();
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key))
        showSlide(p.index + 1);
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key))
        showSlide(p.index - 1);
      else if (e.key === "Home") showSlide(0);
      else if (e.key === "End") showSlide(p.frames.length - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [presenting, exitPresentation, showSlide]);

  // ---- Keyboard: Ctrl+S / Ctrl+Shift+S / F5 before Excalidraw sees them
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Keep canvas/tool shortcuts out of the library search field. This
      // listener runs in capture phase, before Excalidraw handles the key.
      if ((e.target as Element | null)?.closest?.(".lib-search")) {
        e.stopImmediatePropagation();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          handleSave();
        }
      } else if (e.key === "F5") {
        e.preventDefault();
        e.stopPropagation();
        if (!presentRef.current) startPresentation();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [handleSave, handleSaveAs, startPresentation]);

  const handleNew = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    if (!(await confirmDiscard("start a new file"))) return;
    api.resetScene();
    setFile(null);
    markSaved(api.getSceneElements());
    persistSettings({ lastFile: null });
  }, []);

  const handleOpen = useCallback(async () => {
    if (!(await confirmDiscard("open another file"))) return;
    const selected = await open({
      filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
      multiple: false,
    });
    if (!selected) return;
    await loadFile(selected);
  }, [loadFile]);

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

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNodes = (nodes: WsNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: 8 + depth * 14 };
      if (renaming && normPath(renaming.path) === normPath(node.path)) {
        return (
          <input
            key={node.path}
            className="workspace-rename"
            style={{ marginLeft: 8 + depth * 14 }}
            autoFocus
            value={renaming.value}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={commitRename}
          />
        );
      }
      if (node.dir) {
        const isOpen = expandedDirs.has(node.path);
        const selected = selectedDir === node.path;
        return (
          <div key={node.path}>
            <button
              className={`workspace-file workspace-dir${selected ? " selected" : ""}${
                dropDir === node.path ? " drop-target" : ""
              }`}
              style={indent}
              draggable
              onDragStart={(e) => {
                dragNodeRef.current = node;
                e.dataTransfer.effectAllowed = "move";
                // WebKit aborts drags with an empty dataTransfer
                e.dataTransfer.setData("text/plain", node.path);
              }}
              onDragEnd={() => {
                dragNodeRef.current = null;
                setDropDir(null);
              }}
              onDragOver={(e) => {
                if (!dragNodeRef.current) return;
                e.preventDefault();
                e.stopPropagation();
                setDropDir(node.path);
              }}
              onDragLeave={() => setDropDir((d) => (d === node.path ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropDir(null);
                const n = dragNodeRef.current;
                dragNodeRef.current = null;
                if (n) moveNode(n, node.path);
              }}
              onClick={() => {
                toggleDir(node.path);
                setSelectedDir(node.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelectedDir(node.path);
                setCtxMenu({ x: e.clientX, y: e.clientY, node });
              }}
            >
              <span className="workspace-caret">{isOpen ? "▾" : "▸"}</span>
              <FolderIcon open={isOpen} />
              <span className="workspace-name">{node.name}</span>
            </button>
            {isOpen && renderNodes(node.children ?? [], depth + 1)}
          </div>
        );
      }
      const active =
        !!currentFile && normPath(currentFile) === normPath(node.path);
      return (
        <button
          key={node.path}
          className={`workspace-file${active ? " active" : ""}`}
          style={indent}
          draggable
          onDragStart={(e) => {
            dragNodeRef.current = node;
            e.dataTransfer.effectAllowed = "move";
            // WebKit aborts drags with an empty dataTransfer
            e.dataTransfer.setData("text/plain", node.path);
          }}
          onDragEnd={() => {
            dragNodeRef.current = null;
            setDropDir(null);
          }}
          onDragOver={(e) => {
            // Dropping on a file targets its parent folder
            if (!dragNodeRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            setDropDir(parentDir(node.path));
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropDir(null);
            const n = dragNodeRef.current;
            dragNodeRef.current = null;
            if (n) moveNode(n, parentDir(node.path));
          }}
          onClick={() => {
            setSelectedDir(parentDir(node.path));
            openPathGuarded(node.path);
          }}
          onDoubleClick={() =>
            setRenaming({
              path: node.path,
              value: node.name.replace(/\.excalidraw$/, ""),
            })
          }
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ x: e.clientX, y: e.clientY, node });
          }}
          title={node.name}
        >
          <span className="workspace-caret" />
          <FileIcon />
          <span className="workspace-name">{node.name.replace(/\.excalidraw$/, "")}</span>
          {active && dirty && <sup className="workspace-dirty">*</sup>}
        </button>
      );
    });

  if (!mounted) return null;

  const toggleMenu = () => {
    const api = apiRef.current;
    if (!api) return;
    const open = api.getAppState().openMenu === "canvas";
    api.updateScene({ appState: { openMenu: open ? null : "canvas" } });
  };

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (excalidrawAPI) {
      excalidrawAPI.updateScene({ appState: { theme: next } });
    }
  };

  return (
    <div
      className={presenting ? "presenting" : undefined}
      style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}
    >
      {!presenting && (
        <Titlebar
          theme={theme}
          onToggleTheme={toggleTheme}
          currentFile={currentFile}
          onSave={handleSave}
          dirty={dirty}
          autosave={autosave}
          onToggleAutosave={toggleAutosave}
          onToggleSidebar={toggleSidebar}
          onToggleMenu={toggleMenu}
          onPresent={startPresentation}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {workspaceDir && showSidebar && !presenting && (
          <div className="workspace-sidebar">
            <div className="workspace-header">
              <span
                className="workspace-title"
                title={workspaceDir}
                onClick={() => setSelectedDir(null)}
              >
                {baseName(workspaceDir)}
              </span>
              <button
                className="workspace-btn"
                onClick={() => createFileIn(selectedDir ?? workspaceDir)}
                title={`New file in ${baseName(selectedDir ?? workspaceDir)}`}
              >
                <FilePlusIcon />
              </button>
              <button
                className="workspace-btn"
                onClick={() => createFolderIn(selectedDir ?? workspaceDir)}
                title={`New folder in ${baseName(selectedDir ?? workspaceDir)}`}
              >
                <FolderPlusIcon />
              </button>
              <button className="workspace-btn" onClick={handleCloseFolder} title="Close folder">
                ×
              </button>
            </div>
            <div
              className={`workspace-list${
                dropDir && normPath(dropDir) === normPath(workspaceDir) ? " drop-root" : ""
              }`}
              onDragOver={(e) => {
                if (!dragNodeRef.current) return;
                e.preventDefault();
                setDropDir(workspaceDir);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDropDir(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDropDir(null);
                const n = dragNodeRef.current;
                dragNodeRef.current = null;
                if (n) moveNode(n, workspaceDir);
              }}
            >
              {renderNodes(workspaceTree, 0)}
              {workspaceTree.length === 0 && (
                <div className="workspace-empty">No .excalidraw files</div>
              )}
            </div>
          </div>
        )}
        {ctxMenu && (
          <div
            className="ctx-menu"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 190),
              top: Math.min(ctxMenu.y, window.innerHeight - 140),
            }}
          >
            {ctxMenu.node.dir ? (
              <>
                <button className="ctx-menu-item" onClick={() => createFileIn(ctxMenu.node.path)}>
                  New file here
                </button>
                <button
                  className="ctx-menu-item"
                  onClick={() =>
                    setRenaming({
                      path: ctxMenu.node.path,
                      value: ctxMenu.node.name,
                      dir: true,
                    })
                  }
                >
                  Rename
                </button>
                <button className="ctx-menu-item ctx-menu-item-danger" onClick={() => deleteNode(ctxMenu.node)}>
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  className="ctx-menu-item"
                  onClick={() =>
                    setRenaming({
                      path: ctxMenu.node.path,
                      value: ctxMenu.node.name.replace(/\.excalidraw$/, ""),
                    })
                  }
                >
                  Rename
                </button>
                <button className="ctx-menu-item ctx-menu-item-danger" onClick={() => deleteNode(ctxMenu.node)}>
                  Delete
                </button>
              </>
            )}
            <button
              className="ctx-menu-item"
              onClick={() => revealItemInDir(ctxMenu.node.path)}
            >
              Reveal in file manager
            </button>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Excalidraw
            excalidrawAPI={(api) => {
              if (api && apiRef.current !== api) {
                setExcalidrawAPI(api);
                apiRef.current = api;
                if (pendingLibraryUrlRef.current) {
                  importLibrary(pendingLibraryUrlRef.current);
                  pendingLibraryUrlRef.current = null;
                }
                onApiReady();
              }
            }}
            libraryReturnUrl="excalidraw-desktop://library"
            initialData={{
              libraryItems: libSectionsPromiseRef.current.then(
                (sections) =>
                  sections.find((s) => s.id === PERSONAL_ID)?.items ?? []
              ),
              appState: loadCanvasPrefs(),
            }}
            onLibraryChange={(items) =>
              // "Add to library" (and other internal changes) land in the Personal section
              updateLibSections((prev) =>
                prev.map((s) =>
                  s.id === PERSONAL_ID
                    ? { ...s, items: items as LibraryItem[] }
                    : s
                )
              )
            }
            renderTopRightUI={() => (
              <>
                {hasFrames && (
                  <Sidebar.Trigger name="frames" title="Frames">
                    Frames
                  </Sidebar.Trigger>
                )}
                <Sidebar.Trigger name="libraries" title="Libraries">
                  Library
                </Sidebar.Trigger>
              </>
            )}
            theme={theme}
            onLinkOpen={handleLinkOpen as any}
            onChange={(elements, appState) => {
              if (appState.theme !== theme) setTheme(appState.theme);
              // onChange includes soft-deleted elements; savedVersionRef is
              // computed from getSceneElements() (non-deleted only) — filter
              // or the versions never match again after any deletion
              setDirty(
                getSceneVersion(elements.filter((el) => !el.isDeleted)) !==
                  savedVersionRef.current
              );
              const anyFrames = elements.some(
                (el) => el.type === "frame" && !el.isDeleted
              );
              setHasFrames(anyFrames);
              // trigger hides with the last frame; close the orphaned panel too
              if (!anyFrames && framesOpenRef.current)
                apiRef.current?.toggleSidebar({ name: "frames", force: false });
              if (framesOpenRef.current) {
                window.clearTimeout(thumbTimerRef.current);
                thumbTimerRef.current = window.setTimeout(refreshFrameThumbs, 600);
              }
              const prefs = JSON.stringify(
                Object.fromEntries(
                  PREF_KEYS.map((k) => [k, (appState as unknown as Record<string, unknown>)[k]])
                )
              );
              if (prefs !== lastPrefsRef.current) {
                lastPrefsRef.current = prefs;
                localStorage.setItem(PREFS_KEY, prefs);
              }
            }}
            UIOptions={{
              canvasActions: {
                export: false,
                saveToActiveFile: false,
              },
            }}
          >
            <MainMenu>
              <MainMenu.Item onSelect={() => setTimeout(handleNew, 100)}>New File</MainMenu.Item>
              <MainMenu.Item onSelect={() => setTimeout(handleNewFromTemplate, 100)}>
                New from Template...
              </MainMenu.Item>
              <MainMenu.Item onSelect={() => setTimeout(handleOpen, 100)}>Open File...</MainMenu.Item>
              <MainMenu.Item onSelect={() => setTimeout(handleOpenFolder, 100)}>Open Folder...</MainMenu.Item>
              <MainMenu.Item onSelect={() => setTimeout(handleSave, 100)}>Save</MainMenu.Item>
              <MainMenu.Item onSelect={() => setTimeout(handleSaveAs, 100)}>Save As...</MainMenu.Item>
              <MainMenu.Item onSelect={() => setTimeout(handleSaveAsTemplate, 100)}>
                Save as Template...
              </MainMenu.Item>
              {recentFiles.length > 0 && (
                <MainMenu.ItemCustom className="recent-item-custom">
                  <RecentFlyout
                    files={recentFiles}
                    onOpen={(path) => {
                      apiRef.current?.updateScene({ appState: { openMenu: null } });
                      setTimeout(() => openPathGuarded(path), 100);
                    }}
                  />
                </MainMenu.ItemCustom>
              )}
              <MainMenu.Separator />
              <MainMenu.Item onSelect={() => setTimeout(startPresentation, 100)}>
                Present (F5)
              </MainMenu.Item>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.CommandPalette />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
              <MainMenu.Separator />
              {!!currentFile && (
                <MainMenu.Item onSelect={toggleAutosave}>
                  {autosave ? "Autosave: On" : "Autosave: Off"}
                </MainMenu.Item>
              )}
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
            <Sidebar name="libraries" docked={libDocked} onDock={setLibDocked}>
              <Sidebar.Header>
                <div className="lib-header">
                  <span className="lib-header-title">Libraries</span>
                  <button
                    className="lib-header-btn"
                    title="Import library file..."
                    onClick={handleImportLibraryFile}
                  >
                    <svg {...iconProps}>
                      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
                      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                      <path d="M12 18v-6" />
                      <path d="m9 15 3 3 3-3" />
                    </svg>
                  </button>
                  <button
                    className="lib-header-btn"
                    title="Browse libraries (libraries.excalidraw.com)"
                    onClick={handleBrowseLibraries}
                  >
                    <svg {...iconProps}>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </button>
                </div>
              </Sidebar.Header>
              <LibraryPanel
                sections={libSections}
                onToggleCollapse={(id) =>
                  updateLibSections((prev) =>
                    prev.map((s) =>
                      s.id === id ? { ...s, collapsed: !s.collapsed } : s
                    )
                  )
                }
                onRemoveSection={removeLibSection}
                onRemoveItem={removeLibItem}
                onInsert={(item) =>
                  apiRef.current && insertLibraryItem(apiRef.current, item)
                }
              />
            </Sidebar>
            <Sidebar
              name="frames"
              docked={framesDocked}
              onDock={setFramesDocked}
              onStateChange={(state) => {
                const open = state?.name === "frames";
                if (open && !framesOpenRef.current) refreshFrameThumbs();
                framesOpenRef.current = open;
              }}
            >
              <Sidebar.Header>
                <div className="lib-header">
                  <span className="lib-header-title">Frames</span>
                </div>
              </Sidebar.Header>
              <div className="frames-list">
                {frameThumbs.map((f, i) => (
                  <button
                    key={f.id}
                    className="frame-item"
                    onClick={() => goToFrame(f.id)}
                    title={f.name}
                  >
                    <span className="frame-item-num">{i + 1}</span>
                    <span className="frame-item-body">
                      <span
                        className="frame-thumb"
                        dangerouslySetInnerHTML={{ __html: f.svg }}
                      />
                      <span className="frame-item-name">{f.name}</span>
                    </span>
                  </button>
                ))}
                {frameThumbs.length === 0 && (
                  <div className="lib-empty">
                    No frames yet. Use the frame tool (F) to create slides.
                  </div>
                )}
              </div>
            </Sidebar>
          </Excalidraw>
        </div>
      </div>
      {presenting && (
        <div className="present-bar">
          <button
            onClick={() => showSlide(slide.index - 1)}
            disabled={slide.index === 0}
            title="Previous slide"
          >
            ‹
          </button>
          <span className="present-count">
            {slide.index + 1} / {slide.total}
          </span>
          <button
            onClick={() => showSlide(slide.index + 1)}
            disabled={slide.index === slide.total - 1}
            title="Next slide"
          >
            ›
          </button>
          <button onClick={exitPresentation} title="Exit (Esc)">
            ×
          </button>
        </div>
      )}
      {tplPicker && (
        <div className="tpl-overlay" onClick={() => setTplPicker(null)}>
          <div className="tpl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tpl-modal-title">
              <span>New from Template</span>
              <button
                className="lib-header-btn"
                title="Open templates folder"
                onClick={() => revealItemInDir(tplDirRef.current)}
              >
                <FolderIcon open={false} />
              </button>
            </div>
            {tplGroups(tplPicker).map((g) => (
              <div key={g.name}>
                <div className="tpl-cat">{g.name}</div>
                {g.files.map((f) => (
                  <button
                    key={f.path}
                    className="tpl-item"
                    onClick={() => applyTemplate(f.path)}
                  >
                    <FileIcon />
                    <span>{f.name.replace(/\.excalidraw$/, "")}</span>
                  </button>
                ))}
              </div>
            ))}
            {tplGroups(tplPicker).length === 0 && (
              <div className="tpl-empty">
                No templates yet. Draw something and use "Save as Template...".
                Subfolders of the templates folder become categories.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
