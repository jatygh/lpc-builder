// SaveToVasa.ts — Save NPC to jatygh/vasa npc_library
import m from "mithril";
import { state } from "../../state/state.ts";
import { getCanvas } from "../../canvas/renderer.ts";
import { canvasToBlob } from "../../canvas/canvas-utils.ts";
import { exportStateAsJSON, serializeLayersForJson } from "../../state/json.ts";
import { drawCalls } from "../../canvas/renderer.ts";

const GITHUB_TOKEN_KEY = "vasa_gh_token";
const VASA_REPO = "jatygh/vasa";
const VASA_BRANCH = "main";

// ── Local state ──────────────────────────────────────────────────
let npcId = "";
let npcName = "";
let npcPrefix = "";
let saving = false;
let saveStatus = "";
let showTokenInput = false;
let tokenDraft = "";

function getToken(): string {
  return localStorage.getItem(GITHUB_TOKEN_KEY) || "";
}

function saveToken(t: string): void {
  localStorage.setItem(GITHUB_TOKEN_KEY, t.trim());
}

// ── GitHub API helpers ───────────────────────────────────────────
async function ghGet(path: string, token: string) {
  const r = await fetch(`https://api.github.com/repos/${VASA_REPO}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status}`);
  return r.json();
}

async function ghPut(path: string, token: string, content: string, message: string, sha?: string) {
  const body: Record<string, string> = {
    message,
    content,
    branch: VASA_BRANCH,
  };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${VASA_REPO}/contents/${path}`, {
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
    throw new Error(err.message || `GitHub PUT ${path}: ${r.status}`);
  }
  return r.json();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // strip data:...;base64,
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Save logic ───────────────────────────────────────────────────
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

    // 1. Get PNG blob from canvas
    const canvasResult = getCanvas();
    if (canvasResult.isErr()) throw new Error("Canvas not ready");
    const blobResult = await canvasResult.asyncMap(canvasToBlob);
    if (blobResult.isErr()) throw new Error("Failed to get canvas blob");
    const pngBase64 = await blobToBase64(blobResult.value);

    // 2. Build JSON
    const layerJson = exportStateAsJSON(state, serializeLayersForJson(drawCalls));
    const metadata = {
      id,
      name: npcName.trim() || id,
      prefix: npcPrefix.trim() || id.split("_")[0] || "",
      lpcConfig: JSON.parse(layerJson),
    };
    const jsonBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(metadata, null, 2))));

    // 3. Check existing SHAs
    const [existingPng, existingJson] = await Promise.all([
      ghGet(`${basePath}.png`, token),
      ghGet(`${basePath}.json`, token),
    ]);

    // 4. Push both files
    await Promise.all([
      ghPut(`${basePath}.png`, token, pngBase64, `NPC: add ${id} spritesheet`, existingPng?.sha),
      ghPut(`${basePath}.json`, token, jsonBase64, `NPC: add ${id} metadata`, existingJson?.sha),
    ]);

    saveStatus = `✓ Saved ${id} to vasa library`;
  } catch (e: unknown) {
    saveStatus = `✗ ${e instanceof Error ? e.message : String(e)}`;
  }

  saving = false;
  m.redraw();
}

// ── Component ────────────────────────────────────────────────────
export const SaveToVasa: m.Component = {
  view() {
    return m("div#save-to-vasa", {
      style: "border:1px solid #7c6af7;border-radius:8px;padding:12px;margin-top:12px;background:#1a1d27;"
    }, [
      m("div", { style: "font-weight:700;color:#a08fff;margin-bottom:8px;font-size:13px;" }, "✦ Save to Vasa Library"),

      m("div", { style: "display:flex;gap:6px;margin-bottom:6px;" }, [
        m("div", { style: "flex:1;" }, [
          m("label", { style: "font-size:11px;color:#8b90aa;display:block;margin-bottom:2px;" }, "NPC ID *"),
          m("input", {
            type: "text",
            placeholder: "e.g. FA_Rodrigo",
            value: npcId,
            oninput: (e: Event) => { npcId = (e.target as HTMLInputElement).value; },
            style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #464d6a;border-radius:5px;color:#e2e4f0;"
          }),
        ]),
        m("div", { style: "flex:1;" }, [
          m("label", { style: "font-size:11px;color:#8b90aa;display:block;margin-bottom:2px;" }, "Prefix"),
          m("input", {
            type: "text",
            placeholder: "e.g. FA",
            value: npcPrefix,
            oninput: (e: Event) => { npcPrefix = (e.target as HTMLInputElement).value; },
            style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #464d6a;border-radius:5px;color:#e2e4f0;"
          }),
        ]),
      ]),

      m("div", { style: "margin-bottom:8px;" }, [
        m("label", { style: "font-size:11px;color:#8b90aa;display:block;margin-bottom:2px;" }, "Full Name"),
        m("input", {
          type: "text",
          placeholder: "e.g. Rodrigo Vasquez",
          value: npcName,
          oninput: (e: Event) => { npcName = (e.target as HTMLInputElement).value; },
          style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #464d6a;border-radius:5px;color:#e2e4f0;"
        }),
      ]),

      showTokenInput
        ? m("div", { style: "margin-bottom:8px;" }, [
            m("label", { style: "font-size:11px;color:#f5c842;display:block;margin-bottom:2px;" }, "GitHub Token (stored locally)"),
            m("input", {
              type: "password",
              placeholder: "ghp_...",
              value: tokenDraft,
              oninput: (e: Event) => { tokenDraft = (e.target as HTMLInputElement).value; },
              style: "width:100%;padding:4px 8px;font-size:11px;background:#2c3047;border:1px solid #f5c842;border-radius:5px;color:#e2e4f0;"
            }),
            m("button", {
              onclick: () => { saveToken(tokenDraft); showTokenInput = false; saveToVasa(); },
              style: "margin-top:4px;padding:4px 10px;font-size:11px;background:#1a4d35;border:1px solid #52d48a;border-radius:5px;color:#52d48a;cursor:pointer;"
            }, "Save token & continue"),
          ])
        : null,

      m("div", { style: "display:flex;gap:6px;align-items:center;" }, [
        m("button", {
          onclick: saveToVasa,
          disabled: saving,
          style: `padding:5px 14px;font-size:11px;background:${saving ? "#2c3047" : "#4a3fa8"};border:1px solid #7c6af7;border-radius:5px;color:#fff;cursor:${saving ? "wait" : "pointer"};font-weight:600;`
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
