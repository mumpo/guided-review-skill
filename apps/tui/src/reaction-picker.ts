import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import {
  actionKeys,
  keyAction,
  type Keybindings,
} from "../../../packages/preferences/src/keybindings";
import { reactionChoices, type PublishedComment } from "./comments";
import { toggleReaction, type CommentState } from "./diff-view";
import type { Theme } from "./theme";

/** A single modal owns reaction shortcuts, independent of document occurrences. */
export class ReactionPicker {
  readonly overlay: BoxRenderable;
  private panel: BoxRenderable;
  private labels: TextRenderable[] = [];
  private comment?: PublishedComment;

  constructor(
    private renderer: CliRenderer,
    private state: CommentState,
    private bindings: Keybindings,
    theme: Theme,
  ) {
    this.overlay = new BoxRenderable(renderer, {
      id: "reaction-picker",
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      zIndex: 20,
      visible: false,
      onMouseDown: (event) => event.stopPropagation(),
    });
    this.panel = new BoxRenderable(renderer, {
      id: "reaction-picker-panel",
      position: "absolute",
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      title: " Reactions ",
      paddingLeft: 1,
      paddingRight: 1,
    });
    const choices = new BoxRenderable(renderer, {
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      flexShrink: 0,
    });
    reactionChoices.forEach(([, icon], index) => {
      const label = new TextRenderable(renderer, {
        id: `reaction-choice-${index + 1}`,
        content: `${icon}\n${index + 1}`,
        width: 5,
        height: 2,
        onMouseDown: (event) => {
          if (event.button !== 0) return;

          event.stopPropagation();
          this.choose(index);
        },
      });
      this.labels.push(label);
      choices.add(label);
    });
    const hint = new TextRenderable(renderer, {
      content: `${actionKeys(bindings, "close_reactions", "reactions").join("/") || "unbound"}: close`,
      width: "100%",
      wrapMode: "word",
      flexShrink: 0,
    });
    this.labels.push(hint);
    this.panel.add(choices);
    this.panel.add(hint);
    this.overlay.add(this.panel);
    renderer.root.add(this.overlay);
    this.setTheme(theme);
    this.resize();
  }

  open(comment: PublishedComment) {
    this.comment = comment;
    this.overlay.visible = true;
    this.resize();
  }

  close() {
    this.overlay.visible = false;
    this.comment = undefined;
  }

  private choose(index: number) {
    const comment = this.comment;
    this.close();
    if (comment)
      void toggleReaction(this.state, comment, reactionChoices[index][0]);
  }

  handleKey(key: KeyEvent) {
    if (!this.overlay.visible) return false;

    const action = keyAction(this.bindings, key, "reactions");
    if (action === "interrupt") this.renderer.destroy();
    else if (action === "close_reactions") this.close();
    else if (!key.ctrl && !key.meta && !key.option && /^[1-8]$/.test(key.name))
      this.choose(Number(key.name) - 1);
    key.preventDefault();
    return true;
  }

  resize() {
    const width = Math.min(44, Math.max(7, this.renderer.width - 2));
    const rows = Math.ceil(8 / Math.max(1, Math.floor((width - 4) / 5)));
    const height = rows * 2 + 3;
    this.panel.width = width;
    this.panel.height = height;
    this.panel.left = Math.max(
      0,
      Math.floor((this.renderer.width - width) / 2),
    );
    this.panel.top = Math.max(
      0,
      Math.floor((this.renderer.height - height) / 2),
    );
  }

  setTheme(theme: Theme) {
    this.panel.backgroundColor = theme.surface;
    this.panel.borderColor = theme.border;
    this.panel.titleColor = theme.text;
    for (const label of this.labels) {
      label.fg = theme.text;
      label.bg = theme.surface;
    }
  }
}
