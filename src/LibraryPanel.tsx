import { useEffect, useState } from "react";
import {
  exportToSvg,
  serializeLibraryAsJSON,
  MIME_TYPES,
  viewportCoordsToSceneCoords,
  getCommonBounds,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  LibraryItem,
} from "@excalidraw/excalidraw/types";

export interface LibrarySection {
  id: string;
  name: string;
  collapsed?: boolean;
  items: LibraryItem[];
}

export const PERSONAL_ID = "personal";

export const emptySections = (): LibrarySection[] => [
  { id: PERSONAL_ID, name: "Personal", items: [] },
];

// "aws-architecture-icons.excalidrawlib" -> "Aws Architecture Icons"
export const prettyLibName = (raw: string) =>
  decodeURIComponent(raw)
    .replace(/\.excalidrawlib$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Library";

const randId = () =>
  Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

type SceneElement = LibraryItem["elements"][number];

// Fresh ids for elements, groups and bindings so the same item can be inserted many times
function cloneForInsert(
  elements: readonly SceneElement[],
  dx: number,
  dy: number
): SceneElement[] {
  const ids = new Map(elements.map((el) => [el.id, randId()]));
  const groupIds = new Map<string, string>();
  const remapGroup = (g: string) => {
    if (!groupIds.has(g)) groupIds.set(g, randId());
    return groupIds.get(g)!;
  };
  return elements.map((el) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const clone: any = {
      ...el,
      id: ids.get(el.id),
      x: el.x + dx,
      y: el.y + dy,
      seed: (Math.random() * 2 ** 31) | 0,
      versionNonce: (Math.random() * 2 ** 31) | 0,
      groupIds: el.groupIds?.map(remapGroup) ?? [],
    };
    if (clone.boundElements) {
      clone.boundElements = clone.boundElements
        .filter((b: { id: string }) => ids.has(b.id))
        .map((b: { id: string }) => ({ ...b, id: ids.get(b.id) }));
    }
    if (clone.containerId) {
      clone.containerId = ids.get(clone.containerId) ?? null;
    }
    if (clone.frameId) clone.frameId = ids.get(clone.frameId) ?? null;
    for (const key of ["startBinding", "endBinding"]) {
      if (clone[key]) {
        clone[key] = ids.has(clone[key].elementId)
          ? { ...clone[key], elementId: ids.get(clone[key].elementId) }
          : null;
      }
    }
    return clone as SceneElement;
  });
}

export function insertLibraryItem(
  api: ExcalidrawImperativeAPI,
  item: LibraryItem
) {
  const appState = api.getAppState();
  const center = viewportCoordsToSceneCoords(
    {
      clientX: appState.offsetLeft + appState.width / 2,
      clientY: appState.offsetTop + appState.height / 2,
    },
    appState
  );
  const [minX, minY, maxX, maxY] = getCommonBounds(item.elements);
  const clones = cloneForInsert(
    item.elements,
    center.x - (minX + maxX) / 2,
    center.y - (minY + maxY) / 2
  );
  api.updateScene({
    elements: [...api.getSceneElements(), ...clones],
    appState: {
      selectedElementIds: Object.fromEntries(clones.map((c) => [c.id, true])),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

// ponytail: unbounded module cache; a 500-icon library costs a few MB of SVG strings, evict if it ever matters
const thumbCache = new Map<string, string>();

function Thumb({ item }: { item: LibraryItem }) {
  const [html, setHtml] = useState(() => thumbCache.get(item.id) ?? "");
  useEffect(() => {
    if (thumbCache.has(item.id)) return;
    let alive = true;
    exportToSvg({
      elements: item.elements,
      files: null,
      appState: { exportBackground: false },
      skipInliningFonts: true,
    })
      .then((svg: SVGSVGElement) => {
        if (!svg.getAttribute("viewBox")) {
          svg.setAttribute(
            "viewBox",
            `0 0 ${svg.getAttribute("width")} ${svg.getAttribute("height")}`
          );
        }
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        thumbCache.set(item.id, svg.outerHTML);
        if (alive) setHtml(svg.outerHTML);
      })
      .catch((err: unknown) => console.warn("Library thumbnail failed:", err));
    return () => {
      alive = false;
    };
  }, [item.id]);
  return (
    <div className="lib-thumb" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function LibraryPanel({
  sections,
  onToggleCollapse,
  onRemoveSection,
  onRemoveItem,
  onInsert,
}: {
  sections: LibrarySection[];
  onToggleCollapse: (sectionId: string) => void;
  onRemoveSection: (sectionId: string) => void;
  onRemoveItem: (sectionId: string, itemId: string) => void;
  onInsert: (item: LibraryItem) => void;
}) {
  return (
    <div className="lib-panel">
      {sections.map((s) => (
        <div key={s.id} className="lib-section">
          <div className="lib-section-header">
            <button
              className="lib-section-toggle"
              onClick={() => onToggleCollapse(s.id)}
            >
              <span className="lib-caret">{s.collapsed ? "▸" : "▾"}</span>
              <span className="lib-section-name">{s.name}</span>
              <span className="lib-section-count">{s.items.length}</span>
            </button>
            {s.id !== PERSONAL_ID && (
              <button
                className="lib-x"
                title={`Remove library "${s.name}"`}
                onClick={() => onRemoveSection(s.id)}
              >
                ×
              </button>
            )}
          </div>
          {!s.collapsed &&
            (s.items.length ? (
              <div className="lib-grid">
                {s.items.map((item) => (
                  <div
                    key={item.id}
                    className="lib-item"
                    title={item.name || "Untitled"}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        MIME_TYPES.excalidrawlib,
                        serializeLibraryAsJSON([item])
                      )
                    }
                    onClick={() => onInsert(item)}
                  >
                    <Thumb item={item} />
                    <button
                      className="lib-x lib-item-x"
                      title="Remove item"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(s.id, item.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="lib-empty">
                {s.id === PERSONAL_ID
                  ? "Select shapes, right-click → Add to library"
                  : "Empty library"}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
