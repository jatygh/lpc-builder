// Body type selector component (styled as tree category)
import m from "mithril";
import { state } from "../../state/state.ts";
import { renderCharacter } from "../../canvas/renderer.ts";
import { getItemMerged } from "../../state/catalog.ts";
import { BODY_TYPES } from "../../state/constants.ts";
import { capitalize } from "../../utils/helpers.ts";

type State = { isExpanded: boolean };

/**
 * Map from body type to the best default head itemId for that type.
 * Used when the current head doesn't support the new body type.
 */
const DEFAULT_HEAD_FOR_TYPE: Record<string, { itemId: string; name: string }> = {
  male:      { itemId: "heads_human_male",   name: "Human Male"   },
  muscular:  { itemId: "heads_human_male",   name: "Human Male"   },
  female:    { itemId: "heads_human_female", name: "Human Female" },
  pregnant:  { itemId: "heads_human_female", name: "Human Female" },
  teen:      { itemId: "heads_human_male",   name: "Human Male"   },
  child:     { itemId: "heads_human_child",  name: "Human Child"  },
};

/**
 * Returns true if the given head itemId has a layer path for bodyType.
 */
function headSupportsBodyType(itemId: string, bodyType: string): boolean {
  const result = getItemMerged(itemId);
  if (result.isErr()) return false;
  const meta = result.value;
  const layer = meta.layers?.["layer_1"];
  if (!layer) return false;
  return !!(layer as Record<string, unknown>)[bodyType];
}

/**
 * When switching body type, update the head selection if the current head
 * doesn't support the new type. Preserves recolor/variant from current selection.
 */
function syncHeadToBodyType(newType: string): void {
  const currentHead = state.selections["head"];
  if (currentHead && headSupportsBodyType(currentHead.itemId, newType)) {
    // Head supports the new body type — just update the display name to match
    const defaults = DEFAULT_HEAD_FOR_TYPE[newType];
    if (defaults && currentHead.itemId === DEFAULT_HEAD_FOR_TYPE[state.bodyType]?.itemId) {
      // Only rename if it was the default head for the old type
      state.selections["head"] = {
        ...currentHead,
        itemId: defaults.itemId,
        name: defaults.name,
      };
    }
  } else {
    // Current head doesn't support new type — swap to default for new type
    const defaults = DEFAULT_HEAD_FOR_TYPE[newType];
    if (defaults) {
      state.selections["head"] = {
        itemId: defaults.itemId,
        name: defaults.name,
        subId: currentHead?.subId ?? null,
        variant: currentHead?.variant ?? null,
        recolor: currentHead?.recolor ?? null,
      };
    }
  }
}

export const BodyTypeSelector: m.Component<Record<string, never>, State> = {
  oninit(vnode) {
    vnode.state.isExpanded = true;
  },
  view(vnode) {
    return m("div.mb-3", [
      m(
        "div.tree-label",
        {
          onclick: () => {
            vnode.state.isExpanded = !vnode.state.isExpanded;
          },
        },
        [
          m("span.tree-arrow", {
            class: vnode.state.isExpanded ? "expanded" : "collapsed",
          }),
          m("span.has-text-weight-semibold", "Body Type"),
        ],
      ),
      vnode.state.isExpanded
        ? m("div.ml-4.mt-2", [
            m(
              "div.buttons.ml-4",
              BODY_TYPES.map((type) =>
                m(
                  "button.button.is-small",
                  {
                    class: state.bodyType === type ? "is-primary" : "",
                    onclick: () => {
                      if (state.bodyType === type) {
                        // Force re-render if same type re-clicked
                        state.bodyType = "";
                        requestAnimationFrame(() => {
                          state.bodyType = type;
                          renderCharacter(state.selections, state.bodyType);
                          m.redraw();
                        });
                      } else {
                        syncHeadToBodyType(type);
                        state.bodyType = type;
                      }
                    },
                  },
                  capitalize(type),
                ),
              ),
            ),
          ])
        : null,
    ]);
  },
};
