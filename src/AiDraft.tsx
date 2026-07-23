import { useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type Provider = "gemini" | "anthropic";

const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-haiku-4-5",
};
const KEY_STORAGE: Record<Provider, string> = {
  gemini: "geminiApiKey",
  anthropic: "anthropicApiKey",
};
const MODEL_STORAGE: Record<Provider, string> = {
  gemini: "geminiModel",
  anthropic: "anthropicModel",
};

// LLM writes Mermaid, the existing mermaid-to-excalidraw converter does the rest.
// Only flowchart/sequence/class convert to editable shapes; anything else falls
// back to a flat image, so constrain the model to those three.
const SYSTEM_PROMPT =
  "You convert a plain-language description into a Mermaid diagram definition. " +
  "Reply with ONLY valid Mermaid code: no code fences, no commentary, no explanation. " +
  "You MUST use one of exactly these three diagram types, which are the only supported ones: " +
  "a flowchart (start with `flowchart TD` or `graph TD`), a `sequenceDiagram`, or a `classDiagram`. " +
  "Never use any other type (no mindmap, gantt, pie, erDiagram, stateDiagram, journey, etc.); " +
  "if the description doesn't obviously fit sequence or class, use a flowchart. " +
  "Keep node labels short and on a single line: do not use <br> or other HTML tags. " +
  "Do not wrap labels in double quotes; if a label needs quoting, use single quotes.";

const stripFences = (s: string) =>
  s.replace(/^\s*```(?:mermaid)?\s*/i, "").replace(/```\s*$/, "").trim();

// Strip in-label line breaks the model still emits: <br>/<br/> and literal
// \n / \r (backslash sequences) both render as literal text in Mermaid labels.
// Real newlines are left alone — they separate statements structurally.
const stripBreaks = (s: string) =>
  s.replace(/<br\s*\/?>/gi, " ").replace(/\\[nr]/g, " ");

// Guard against the converter's silent image fallback: only these lead keywords
// produce editable Excalidraw shapes.
const SUPPORTED = /^\s*(flowchart|graph|sequenceDiagram|classDiagram)\b/;
const isSupportedMermaid = (m: string) => SUPPORTED.test(m);

// Keys only ever go to the provider's official endpoint; the app's CSP
// (tauri.conf.json connect-src) blocks requests to any other host.
async function generateMermaid(
  provider: Provider,
  key: string,
  model: string,
  prompt: string
): Promise<string> {
  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    if (!res.ok) {
      const detail = (await res.json().catch(() => null))?.error?.message ?? "";
      if (res.status === 400 || res.status === 403)
        throw new Error("Invalid API key.");
      if (res.status === 429)
        throw new Error(
          `Quota exhausted for "${model}" (free-tier limits are per-model). ` +
            `Switch to a different model above, or wait for the quota to reset.`
        );
      throw new Error(
        `Gemini API error ${res.status}${detail ? `: ${detail}` : ""}`
      );
    }
    const data = await res.json();
    const parts: Array<{ text?: string }> =
      data.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? "").join("");
  }

  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      throw new Error("Invalid API key.");
    if (err instanceof Anthropic.RateLimitError)
      throw new Error(
        `Quota or rate limit reached for "${model}". ` +
          `Switch to a different model above, or wait a moment.`
      );
    if (err instanceof Anthropic.APIError)
      throw new Error(`API error ${err.status}: ${err.message}`);
    throw err;
  }
}

export default function AiDraft({
  api,
  onClose,
}: {
  api: ExcalidrawImperativeAPI;
  onClose: () => void;
}) {
  // Always open on Gemini (the free default); key/model are still remembered per provider
  const [provider, setProvider] = useState<Provider>("gemini");
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(KEY_STORAGE[provider]) ?? ""
  );
  const [model, setModel] = useState(
    () =>
      localStorage.getItem(MODEL_STORAGE[provider]) ?? DEFAULT_MODEL[provider]
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Note: no outside-click or Escape close — only the Cancel button closes,
  // so users don't lose their prompt accidentally.

  // Hand off to Excalidraw's own Mermaid dialog (live preview + parse errors)
  // seeded with the text. The dialog reads this localStorage key on open;
  // EditorLocalStorage stores values JSON-encoded, so match that.
  const openInMermaidEditor = (text: string) => {
    localStorage.setItem("mermaid-to-excalidraw", JSON.stringify(text));
    api.updateScene({
      appState: { openDialog: { name: "ttd", tab: "mermaid" } },
    });
    onClose();
  };

  const switchProvider = (p: Provider) => {
    setProvider(p);
    setApiKey(localStorage.getItem(KEY_STORAGE[p]) ?? "");
    setModel(localStorage.getItem(MODEL_STORAGE[p]) ?? DEFAULT_MODEL[p]);
  };

  const insertMermaid = async (mermaid: string) => {
    // Lazy import: keeps the multi-MB mermaid bundle out of the startup chunk
    const { parseMermaidToExcalidraw } = await import(
      "@excalidraw/mermaid-to-excalidraw"
    );
    // Match Excalidraw's own dialog: some node/subgraph labels with double
    // quotes make the mermaid parser throw; retry with them swapped to single
    // quotes before giving up.
    let parsed;
    try {
      parsed = await parseMermaidToExcalidraw(mermaid);
    } catch {
      parsed = await parseMermaidToExcalidraw(mermaid.replace(/"/g, "'"));
    }
    const { elements: skeleton, files } = parsed;
    // The converter emits a single `image` element when it can't turn the
    // diagram into shapes (unsupported/partly-broken). Reject that so we never
    // silently paste a flat picture.
    if (skeleton.some((el) => el.type === "image")) {
      throw new Error("image-fallback");
    }
    const elements = convertToExcalidrawElements(skeleton, {
      regenerateIds: true,
    });
    if (!elements.length) throw new Error("Diagram came back empty");

    // Drop the diagram at the viewport center
    const st = api.getAppState();
    const minX = Math.min(...elements.map((e) => e.x));
    const minY = Math.min(...elements.map((e) => e.y));
    const maxX = Math.max(...elements.map((e) => e.x + e.width));
    const maxY = Math.max(...elements.map((e) => e.y + e.height));
    const dx = st.width / 2 / st.zoom.value - st.scrollX - (minX + maxX) / 2;
    const dy = st.height / 2 / st.zoom.value - st.scrollY - (minY + maxY) / 2;
    const moved = elements.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));

    if (files && Object.keys(files).length) api.addFiles(Object.values(files));
    api.updateScene({
      elements: [...api.getSceneElements(), ...moved],
    });
  };

  const generate = async () => {
    const key = apiKey.trim();
    const modelId = model.trim() || DEFAULT_MODEL[provider];
    if (!key || !prompt.trim() || busy) return;
    localStorage.setItem(KEY_STORAGE[provider], key);
    localStorage.setItem(MODEL_STORAGE[provider], modelId);
    setBusy(true);
    setError(null);
    // One retry: malformed/unsupported Mermaid is common, and a second pass
    // with the failure fed back usually fixes it.
    let lastText = "";
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const hint =
          attempt === 0
            ? prompt
            : `${prompt}\n\nYour previous answer was not a valid, supported Mermaid ` +
              `flowchart/sequenceDiagram/classDiagram. Return corrected Mermaid only:\n${lastText}`;
        const text = stripBreaks(
          stripFences(await generateMermaid(provider, key, modelId, hint))
        );
        lastText = text;
        if (!text || !isSupportedMermaid(text)) continue; // retry
        try {
          await insertMermaid(text);
          onClose();
          return;
        } catch {
          // conversion failed (syntax error or image fallback) — retry once
        }
      }
      // Couldn't convert here — hand the text straight to Excalidraw's Mermaid
      // editor (live preview + parse errors) so the user can fix it there.
      if (lastText) {
        openInMermaidEditor(lastText);
      } else {
        setError("The model didn't return a diagram. Try rephrasing.");
      }
    } catch (err) {
      // API/network errors (bad key, quota) — keep the dialog open so the user
      // can switch model or key.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tpl-overlay">
      <div className="ai-modal">
        <div className="ai-head">
          <div className="ai-head-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.6 3.9L17.5 8.5 13.6 10 12 14l-1.6-4L6.5 8.5l3.9-1.6L12 3z" />
              <path d="M18.5 14l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
            </svg>
          </div>
          <div>
            <div className="ai-title">AI Diagram</div>
            <div className="ai-subtitle">
              Describe a diagram in plain words and drop editable shapes on the canvas.
            </div>
          </div>
        </div>

        <div className="ai-seg" role="tablist" aria-label="Provider">
          <button
            role="tab"
            aria-selected={provider === "gemini"}
            className={provider === "gemini" ? "active" : ""}
            onClick={() => switchProvider("gemini")}
          >
            Google Gemini
          </button>
          <button
            role="tab"
            aria-selected={provider === "anthropic"}
            className={provider === "anthropic" ? "active" : ""}
            onClick={() => switchProvider("anthropic")}
          >
            Anthropic Claude
          </button>
        </div>

        <label className="ai-label">
          <span className="ai-label-text">Describe the diagram</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. auth flow: user logs in, backend checks credentials against Postgres, issues a JWT, client stores it and sends it with API calls"
            autoFocus
          />
        </label>

        <div className="ai-row">
          <label className="ai-label">
            <span className="ai-label-text">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === "gemini" ? "AIza..." : "sk-ant-..."}
              autoComplete="off"
            />
          </label>
          <label className="ai-label ai-model">
            <span className="ai-label-text">Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_MODEL[provider]}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="ai-hint">
          {provider === "gemini" ? (
            <>
              Get a free API key from{" "}
              <button
                type="button"
                className="ai-link"
                onClick={() => openUrl("https://aistudio.google.com/api-keys")}
              >
                aistudio.google.com/api-keys
              </button>
              .{" "}
            </>
          ) : null}
          Stored only on this machine; sent only to the provider.
        </div>

        {error && <div className="ai-error">{error}</div>}

        <div className="ai-actions">
          <button className="ai-btn ai-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="ai-btn ai-generate"
            disabled={busy || !apiKey.trim() || !prompt.trim()}
            onClick={generate}
          >
            {busy ? "Generating…" : "Generate & Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}
