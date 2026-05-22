// SaveToVasa.ts — Save/Load NPC to jatygh/vasa npc_library
import m from "mithril";
import { state } from "../../state/state.ts";
import { getCanvas, renderCharacter } from "../../canvas/renderer.ts";
import { canvasToBlob } from "../../canvas/canvas-utils.ts";
import { exportStateAsJSON, importStateFromJSON, serializeLayersForJson } from "../../state/json.ts";
import { drawCalls } from "../../canvas/renderer.ts";

const GITHUB_TOKEN_KEY = "vasa_gh_token";
const VASA_REPO = "jatygh/vasa";
const VASA_BRANCH = "main";
const BASE = `https://api.github.com/repos/${VASA_REPO}/contents`;

// ── Local state ──────────────────────────────────────────────────
let npcId = "";
let npcName = "";
let npcPrefix = "";
let saving = false;
let saveStatus = "";
let showTokenInput = false;
let tokenDraft = "";

// Load panel state
let showLoadPanel = false;
let loadList: Array<{ id: string; name: string; path: string }> = [];
let loadListStatus = "";
let loadListFetched = false;

function getToken(): string {
  return localStorage.getItem(GITHUB_TOKEN_KEY) || "";
}
function saveToken(t: string): void {
  localStorage.setItem(GITHUB_TOKEN_KEY, t.trim());
}

// ── GitHub helpers ───────────────────────────────────────────────
async function ghGet(path: string, token: string) {
  const r = await fetch(`${BASE}/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status}`);
  return r.json();
}

async function ghPut(path: string, token: string, content: string, message: string, sha?: string) {
  const body: Record<string, string> = { message, content, branch: VASA_BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(`${BASE}/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `GitHub PUT ${path}: ${r.status}`);
  }
  return r.json();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── New NPC ──────────────────────────────────────────────────────
function newNpc() {
  npcId = "";
  npcName = "";
  npcPrefix = "";
  saveStatus = "";
  // Reset the generator state by reloading the page — simplest clean slate
  if (confirm("Start a new NPC? Unsaved changes will be lost.")) {
    window.location.reload();
  }
}

// ── Load NPC list ────────────────────────────────────────────────
async function fetchNpcList() {
  const token = getToken();
  if (!token) { showTokenInput = true; m.redraw(); return; }
  loadListStatus = "Loading…";
  loadListFetched = false;
  m.redraw();
  try {
    const items = await ghGet("npc_library", token);
    if (!items) { loadListStatus = "No NPCs saved yet."; loadListFetched = true; m.redraw(); return; }
    const jsonFiles = (items as Array<{ name: string; path: string }>)
      .filter(f => f.name.endsWith(".json"));
    const npcs = await Promise.all(
      jsonFiles.map(async f => {
        try {
          const data = await ghGet(f.path, token);
          const decoded = JSON.parse(atob((data as { content: string }).content.replace(/\n/g, "")));
          return { id: decoded.id || f.name.replace(".json", ""), name: decoded.name || decoded.id, path: f.path };
        } catch {
          return { id: f.name.replace(".json", ""), name: f.name.replace(".json", ""), path: f.path };
        }
      })
    );
    loadList = npcs.sort((a, b) => a.id.localeCompare(b.id));
    loadListStatus = loadList.length ? "" : "No NPCs saved yet.";
    loadListFetched = true;
  } catch (e: unknown) {
    loadListStatus = `✗ ${e instanceof Error ? e.message : String(e)}`;
    loadListFetched = true;
  }
  m.redraw();
}

async function loadNpc(jsonPath: string) {
  const token = getToken();
  try {
    loadListStatus = "Loading NPC…";
    m.redraw();
    const data = await ghGet(jsonPath, token);
    const decoded = JSON.parse(atob((data as { content: string }).content.replace(/\n/g, "")));
    npcId = decoded.id || "";
    npcName = decoded.name && decoded.name !== decoded.id ? decoded.name : "";
    npcPrefix = decoded.prefix || "";
    const imported = importStateFromJSON(JSON.stringify(decoded.lpcConfig));
    Object.assign(state, imported);
    // Force full re-render with the loaded body type
    await renderCharacter(state.selections, state.bodyType);
    showLoadPanel = false;
    loadListStatus = "";
    saveStatus = `✓ Loaded ${npcId}`;
    m.redraw();
  } catch (e: unknown) {
    loadListStatus = `✗ Failed to load: ${e instanceof Error ? e.message : String(e)}`;
    m.redraw();
  }
}

// ── Save ─────────────────────────────────────────────────────────
async function saveToVasa() {
  const token = getToken();
  if (!token) { showTokenInput = true; m.redraw(); return; }
  if (!npcId.trim()) { saveStatus = "⚠ NPC ID required"; m.redraw(); return; }
  saving = true;
  saveStatus = "Saving…";
  m.redraw();
  try {
    const id = npcId.trim();
    const basePath = `npc_library/${id}`;
    const canvasResult = getCanvas();
    if (canvasResult.isErr()) throw new Error("Canvas not ready");
    const blobResult = await canvasResult.asyncMap(canvasToBlob);
    if (blobResult.isErr()) throw new Error("Failed to get canvas blob");
    const pngBase64 = await blobToBase64(blobResult.value);
    const layerJson = exportStateAsJSON(state, serializeLayersForJson(drawCalls));
    const metadata = {
      id,
      name: npcName.trim() || "",
      prefix: npcPrefix.trim() || id.split("_")[0] || "",
      lpcConfig: JSON.parse(layerJson),
    };
    const jsonBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(metadata, null, 2))));
    const [existingPng, existingJson] = await Promise.all([
      ghGet(`${basePath}.png`, token),
      ghGet(`${basePath}.json`, token),
    ]);
    await Promise.all([
      ghPut(`${basePath}.png`, token, pngBase64, `NPC: add ${id} spritesheet`, (existingPng as { sha?: string } | null)?.sha),
      ghPut(`${basePath}.json`, token, jsonBase64, `NPC: add ${id} metadata`, (existingJson as { sha?: string } | null)?.sha),
    ]);
    saveStatus = `✓ Saved ${id}`;
    // Refresh load list if open
    if (showLoadPanel) { loadListFetched = false; fetchNpcList(); }
  } catch (e: unknown) {
    saveStatus = `✗ ${e instanceof Error ? e.message : String(e)}`;
  }
  saving = false;
  m.redraw();
}

// ── Component ────────────────────────────────────────────────────
const BTN = "padding:4px 12px;font-size:11px;border-radius:5px;cursor:pointer;border:1px solid;";

export const SaveToVasa: m.Component = {
  view() {
    return m("div#save-to-vasa", {
      style: "border:1px solid #7c6af7;border-radius:8px;padding:12px;margin-top:12px;background:#1a1d27;"
    }, [

      // ── Header row ──
      m("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:10px;" }, [
        m("span", { style: "font-weight:700;color:#a08fff;font-size:13px;flex:1;" }, "✦ Vasa NPC Library"),
        m("button", {
          title: "New NPC",
          onclick: newNpc,
          style: `${BTN}background:#1a2a1a;border-color:#52d48a;color:#52d48a;`,
        }, "＋ New"),
        m("button", {
          title: "Load existing NPC",
          onclick: () => {
            showLoadPanel = !showLoadPanel;
            if (showLoadPanel && !loadListFetched) fetchNpcList();
          },
          style: `${BTN}background:${showLoadPanel ? "#2a2060" : "#1a1d27"};border-color:#7c6af7;color:#a08fff;`,
        }, "📂 Load"),
      ]),

      // ── Load panel ──
      showLoadPanel ? m("div", {
        style: "background:#0f1117;border:1px solid #363b52;border-radius:6px;padding:8px;margin-bottom:10px;max-height:180px;overflow-y:auto;"
      }, [
        loadListStatus ? m("div", { style: "font-size:11px;color:#8b90aa;padding:4px;" }, loadListStatus) : null,
        ...loadList.map(npc =>
          m("div", {
            style: "display:flex;align-items:center;gap:6px;padding:4px 2px;border-bottom:1px solid #1a1d27;cursor:pointer;",
            onclick: () => loadNpc(npc.path),
          }, [
            m("span", { style: "flex:1;font-size:11px;color:#e2e4f0;" }, npc.id),
            npc.name !== npc.id ? m("span", { style: "font-size:10px;color:#555a72;" }, npc.name) : null,
            m("span", { style: "font-size:10px;color:#7c6af7;" }, "load →"),
          ])
        ),
      ]) : null,

      // ── Fields ──
      m("div", { style: "display:flex;gap:6px;margin-bottom:6px;" }, [
        m("div", { style: "flex:1;" }, [
          m("label", { style: "font-size:11px;color:#8b90aa;display:block;margin-bottom:2px;" }, "NPC ID *"),
          m("input", {
            type: "text", placeholder: "e.g. FA_Rodrigo", value: npcId,
            oninput: (e: Event) => { npcId = (e.target as HTMLInputElement).value; },
            style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #464d6a;border-radius:5px;color:#e2e4f0;"
          }),
        ]),
        m("div", { style: "flex:1;" }, [
          m("label", { style: "font-size:11px;color:#8b90aa;display:block;margin-bottom:2px;" }, "Prefix"),
          m("input", {
            type: "text", placeholder: "e.g. FA", value: npcPrefix,
            oninput: (e: Event) => { npcPrefix = (e.target as HTMLInputElement).value; },
            style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #464d6a;border-radius:5px;color:#e2e4f0;"
          }),
        ]),
      ]),

      m("div", { style: "margin-bottom:8px;" }, [
        m("label", { style: "font-size:11px;color:#8b90aa;display:block;margin-bottom:2px;" }, "Full Name"),
        m("input", {
          type: "text", placeholder: "e.g. Rodrigo Vasquez", value: npcName,
          oninput: (e: Event) => { npcName = (e.target as HTMLInputElement).value; },
          style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #464d6a;border-radius:5px;color:#e2e4f0;"
        }),
      ]),

      // ── Token input ──
      showTokenInput ? m("div", { style: "margin-bottom:8px;" }, [
        m("label", { style: "font-size:11px;color:#f5c842;display:block;margin-bottom:2px;" }, "GitHub Token (stored locally)"),
        m("input", {
          type: "password", placeholder: "ghp_...", value: tokenDraft,
          oninput: (e: Event) => { tokenDraft = (e.target as HTMLInputElement).value; },
          style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #f5c842;border-radius:5px;color:#e2e4f0;"
        }),
        m("button", {
          onclick: () => { saveToken(tokenDraft); showTokenInput = false; saveToVasa(); },
          style: `margin-top:4px;${BTN}background:#1a4d35;border-color:#52d48a;color:#52d48a;`
        }, "Save token & continue"),
      ]) : null,

      // ── Save row ──
      m("div", { style: "display:flex;gap:6px;align-items:center;" }, [
        m("button", {
          onclick: saveToVasa, disabled: saving,
          style: `${BTN}background:${saving ? "#2c3047" : "#4a3fa8"};border-color:#7c6af7;color:#fff;font-weight:600;padding:5px 14px;`,
        }, saving ? "Saving…" : "💾 Save to Library"),
        getToken() ? m("span", {
          onclick: () => { showTokenInput = true; tokenDraft = ""; m.redraw(); },
          style: "font-size:10px;color:#555a72;cursor:pointer;text-decoration:underline;"
        }, "change token") : null,
      ]),

      saveStatus ? m("div", {
        style: `margin-top:6px;font-size:11px;color:${saveStatus.startsWith("✓") ? "#52d48a" : saveStatus.startsWith("⚠") ? "#f5c842" : "#f06b6b"};`
      }, saveStatus) : null,

    ]);
  },
};
