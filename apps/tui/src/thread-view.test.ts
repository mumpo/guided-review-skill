import { expect, test } from "bun:test";
import type { TextareaRenderable, Renderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import { resolveKeybindings } from "../../../packages/preferences/src";
import {
  type ReviewThread,
  type ThreadService,
  type ReactionContent,
  reactionChoices,
} from "./comments";
import { mountFullWidthReview as mountReview } from "./view-test-utils";
import { themes } from "./theme";
import { sessionHighlights } from "./highlight-service";

function data() {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;
  snapshot.sections[0].references = [{ kind: "file", fileId: "greeting" }];

  return { snapshot, analysis: analyzeDiffs(snapshot) };
}

function sample(): ReviewThread {
  return {
    id: "T1",
    path: "src/greeting.ts",
    side: "new",
    line: 2,
    startLine: 1,
    resolved: true,
    outdated: false,
    comments: [
      {
        id: 1,
        nodeId: "C1",
        body: "Root body",
        author: "alice",
        url: `${fixture.pullRequest.url}#discussion_r1`,
        reactions: [{ content: "HEART", count: 2, viewerHasReacted: true }],
      },
      {
        id: 2,
        nodeId: "C2",
        body: "Reply body",
        author: "bob",
        url: `${fixture.pullRequest.url}#discussion_r2`,
        reactions: [],
      },
    ],
  };
}

function service(threads = [sample()]): ThreadService {
  return {
    load: async () => threads,
    reply: async (_thread, body) => ({
      id: 3,
      nodeId: "C3",
      body,
      author: "me",
      url: `${fixture.pullRequest.url}#discussion_r3`,
      reactions: [],
    }),
    react: async (_comment, content, remove) => [
      { content, count: remove ? 1 : 3, viewerHasReacted: !remove },
    ],
  };
}

const node = (
  ui: Awaited<ReturnType<typeof createTestRenderer>>,
  id: string,
) => {
  const found = ui.renderer.root.findDescendantById(id);
  if (!found) throw new Error(`Missing ${id}`);

  return found;
};
async function click(
  ui: Awaited<ReturnType<typeof createTestRenderer>>,
  target: Renderable,
) {
  await ui.mockMouse.click(target.x, target.y);
  await ui.renderOnce();
}

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: range thread folds into one row, smart z, picker clicks/keys, replies and live layout`, async () => {
      const ui = await createTestRenderer({ width: 120, height: 55 });
      const threads = [sample()];
      const api = service(threads);
      const replies: string[] = [];
      const reactions: {
        id: number;
        content: ReactionContent;
        remove: boolean;
      }[] = [];
      const reply = api.reply;
      api.reply = async (thread, body) => {
        replies.push(body);
        return reply(thread, body);
      };
      const react = api.react;
      api.react = async (comment, content, remove) => {
        reactions.push({ id: comment.id, content, remove });
        return react(comment, content, remove);
      };
      try {
        const applyTheme = mountReview(
          ui.renderer,
          data(),
          theme,
          mode,
          undefined,
          resolveKeybindings(),
          { threads: api },
        );
        await ui.mockInput.pressKeys(["\u000e"]);
        await sessionHighlights(ui.renderer).settled();
        await ui.renderOnce();

        const header = node(ui, "thread-T1");
        expect(header.height).toBe(1);
        expect(header.parent?.height).toBe(1);
        expect(ui.captureCharFrame()).toContain("› \uf41f 2 comments");
        expect(ui.captureCharFrame()).not.toContain("Root body");
        const source = ui
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("unchanged"));
        expect(header.y).toBe(source + 1);
        if (mode === "side-by-side") expect(header.x).toBeGreaterThan(55);
        await click(ui, header);

        expect(ui.captureCharFrame()).toContain("Root body");
        expect(ui.captureCharFrame()).toContain("lines 1–2 · Resolved");
        expect(ui.captureCharFrame()).toContain("❤️ 2 ✓");
        expect(node(ui, "react-2")).toBeDefined();
        await ui.mockInput.pressKeys(["j", "j", "r"]);
        await ui.renderOnce();

        expect(node(ui, "reaction-picker").visible).toBe(true);
        for (let index = 1; index <= 8; index++)
          expect(node(ui, `reaction-choice-${index}`).visible).toBe(true);
        await ui.mockInput.pressKeys(["z", "c", "q", "\u001b[27u"]);
        await ui.renderOnce();

        expect(node(ui, "reaction-picker").visible).toBe(false);
        expect(
          ui.renderer.root.findDescendantById("comment-editor"),
        ).toBeUndefined();
        expect(ui.captureCharFrame()).toContain("Root body");
        await ui.mockInput.pressKeys(["+", "6"]);
        await ui.waitFor(
          () =>
            (
              node(
                ui,
                "reaction-1-HEART",
              ) as import("@opentui/core").TextRenderable
            ).plainText === "❤️ 1",
        );
        await ui.renderOnce();

        expect(reactions).toEqual([{ id: 1, content: "HEART", remove: true }]);
        expect(ui.captureCharFrame()).toContain("❤️ 1");
        await click(ui, node(ui, "reaction-1-HEART"));
        await ui.waitFor(
          () =>
            (
              node(
                ui,
                "reaction-1-HEART",
              ) as import("@opentui/core").TextRenderable
            ).plainText === "❤️ 3 ✓",
        );
        await ui.renderOnce();

        expect(reactions[1]).toEqual({
          id: 1,
          content: "HEART",
          remove: false,
        });
        await click(ui, node(ui, "react-2"));
        await click(ui, node(ui, "reaction-choice-8"));

        await ui.waitFor(
          () => !!ui.renderer.root.findDescendantById("reaction-2-EYES"),
        );
        expect(reactions[2]).toEqual({ id: 2, content: "EYES", remove: false });
        await ui.mockInput.pressKeys(["j", "j", "c"]);
        await ui.mockInput.typeText("A reply\nwith text");
        await ui.mockInput.pressKeys(["\u001b[27u", "c"]);
        await ui.renderOnce();

        expect(
          (node(ui, "comment-editor") as TextareaRenderable).plainText,
        ).toBe("A reply\nwith text");
        applyTheme(
          themes[
            theme.name === "github-light" ? "github-dark" : "github-light"
          ],
        );
        ui.resize(85, 50);
        await ui.renderOnce();

        expect((node(ui, "comment-editor") as TextareaRenderable).focused).toBe(
          true,
        );
        await ui.mockInput.pressKeys(["\u0013", "\u0013"]);
        await ui.waitFor(
          () => !ui.renderer.root.findDescendantById("comment-editor"),
        );
        await ui.renderOnce();

        expect(replies).toEqual(["A reply\nwith text"]);
        expect(ui.captureCharFrame()).toContain("3 comments");
        expect(ui.captureCharFrame()).toContain("me: A reply");
        await ui.mockInput.pressKeys(["c"]);
        await ui.renderOnce();

        expect(
          Boolean(ui.renderer.root.findDescendantById("comment-editor")),
        ).toBe(true);
        await ui.mockInput.pressKeys(["\u001b[27u", "z"]);
        await ui.renderOnce();

        expect(ui.captureCharFrame()).not.toContain("Root body");
        expect(ui.captureCharFrame()).toContain("unchanged");
        await ui.mockInput.pressKeys(["z"]);
        await ui.renderOnce();

        expect(ui.captureCharFrame()).toContain("Root body");
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}

test("initial expansion, folded comment search, file threads and unmatched/outdated omission", async () => {
  const ui = await createTestRenderer({ width: 100, height: 50 });
  const threads = [
    sample(),
    { ...sample(), id: "file", fileLevel: true, line: null },
    { ...sample(), id: "unmatched", line: 99 },
    { ...sample(), id: "outdated", outdated: true },
  ];
  try {
    mountReview(
      ui.renderer,
      data(),
      themes["github-dark"],
      "inline",
      undefined,
      resolveKeybindings(),
      { threads: service(threads) },
    );
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    expect(
      ui.renderer.root.findDescendantById("thread-unmatched"),
    ).toBeUndefined();
    expect(
      ui.renderer.root.findDescendantById("thread-outdated"),
    ).toBeUndefined();
    expect(node(ui, "thread-file").y).toBe(
      node(ui, "file-header-greeting").y + 3,
    );
    await ui.mockInput.pressKeys(["/", ..."Root body", "\r"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("Root body");
    expect(ui.captureCharFrame()).toContain("⌄ \uf41f 2 comments");
    await ui.mockInput.pressKeys(["\u001b[27u", "z"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).not.toContain("Root body");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("failed loading preserves the walkthrough and async loading retains a source draft", async () => {
  const ui = await createTestRenderer({ width: 100, height: 45 });
  let load!: (threads: ReviewThread[]) => void;
  const api = service();
  api.load = () =>
    new Promise((resolve) => {
      load = resolve;
    });
  try {
    mountReview(
      ui.renderer,
      data(),
      themes["github-dark"],
      "inline",
      undefined,
      resolveKeybindings(),
      { threads: api, commentsUnfolded: true },
    );
    await ui.mockInput.pressKeys(["\u000e", "j", "j", "j", "c"]);
    await ui.mockInput.typeText("retained draft");
    load([sample()]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    expect((node(ui, "comment-editor") as TextareaRenderable).plainText).toBe(
      "retained draft",
    );
    expect((node(ui, "comment-editor") as TextareaRenderable).focused).toBe(
      true,
    );
    expect(ui.captureCharFrame()).toContain("Root body");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
  const failed = await createTestRenderer({ width: 100, height: 35 });
  try {
    mountReview(
      failed.renderer,
      data(),
      themes["github-dark"],
      "inline",
      undefined,
      resolveKeybindings(),
      {
        threads: {
          ...service(),
          load: async () => {
            throw new Error("Authentication required");
          },
        },
      },
    );
    await failed.waitFor(() =>
      (
        node(
          failed,
          "thread-load-status",
        ) as import("@opentui/core").TextRenderable
      ).plainText.includes("Authentication"),
    );
    await failed.renderOnce();

    expect(failed.captureCharFrame()).toContain(
      "Could not load review threads: Authentication required",
    );
    await failed.mockInput.pressKeys(["\u000e", "j", "j", "j", "c"]);
    await failed.renderOnce();

    expect(node(failed, "comment-editor")).toBeDefined();
  } finally {
    await sessionHighlights(failed.renderer).settled();
    await failed.dispose();
  }
});

test("all eight numeric shortcuts select the focused comment; remapped open/close keys remain modal", async () => {
  const ui = await createTestRenderer({ width: 90, height: 45 });
  const selected: ReactionContent[] = [];
  const api = service();
  api.react = async (comment, content) => {
    expect(comment.id).toBe(1);
    selected.push(content);

    return [{ content, count: 1, viewerHasReacted: true }];
  };
  try {
    mountReview(
      ui.renderer,
      data(),
      themes["github-dark"],
      "inline",
      undefined,
      resolveKeybindings({ open_reactions: ["a"], close_reactions: ["x"] }),
      { threads: api, commentsUnfolded: true },
    );
    await ui.mockInput.pressKeys(["\u000e"]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();
    await click(ui, node(ui, "react-1"));
    await ui.mockInput.pressKeys(["x"]);
    await ui.renderOnce();

    expect(node(ui, "reaction-picker").visible).toBe(false);
    expect(
      (node(ui, "react-1") as import("@opentui/core").TextRenderable).plainText,
    ).toBe("\uf4a2 a");
    for (const [index, [content]] of reactionChoices.entries()) {
      await ui.mockInput.pressKeys(["a"]);
      ui.resize(index % 2 ? 32 : 90, 45);
      await ui.renderOnce();
      expect(node(ui, "reaction-picker").visible).toBe(true);
      expect(node(ui, "reaction-choice-8").y).toBeLessThan(45);
      await ui.mockInput.pressKeys([String(index + 1)]);
      await ui.waitFor(
        () => !!ui.renderer.root.findDescendantById(`reaction-1-${content}`),
      );
      await ui.renderOnce();
    }

    expect(selected).toEqual(reactionChoices.map(([content]) => content));
    expect(node(ui, "reaction-picker").visible).toBe(false);
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("thread state follows repeated sections, pending reactions deduplicate, and failures retain counts and reply drafts", async () => {
  const ui = await createTestRenderer({ width: 100, height: 45 });
  const review = data();
  review.snapshot.sections = review.snapshot.sections
    .slice(0, 2)
    .map((section) => ({
      ...section,
      references: [{ kind: "file", fileId: "greeting" }],
    }));
  review.analysis = analyzeDiffs(review.snapshot);
  const api = service();
  let failReaction!: (error: Error) => void;
  let failReply!: (error: Error) => void;
  let attempts = 0;
  api.react = () => {
    attempts++;
    return new Promise((_resolve, reject) => {
      failReaction = reject;
    });
  };
  api.reply = () =>
    new Promise((_resolve, reject) => {
      failReply = reject;
    });
  try {
    mountReview(
      ui.renderer,
      review,
      themes["github-dark"],
      "inline",
      undefined,
      resolveKeybindings(),
      { threads: api, commentsUnfolded: true },
    );
    await ui.mockInput.pressKeys(["\u000e"]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();
    await click(ui, node(ui, "reaction-1-HEART"));
    await click(ui, node(ui, "reaction-1-HEART"));

    expect(attempts).toBe(1);
    expect(ui.captureCharFrame()).toContain("Updating reaction");
    failReaction(new Error("Reaction unavailable"));
    await ui.waitFor(
      () => !ui.captureCharFrame().includes("Updating reaction"),
    );
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("❤️ 2 ✓");
    expect(ui.captureCharFrame()).toContain("Reaction unavailable");
    await ui.mockInput.pressKeys(["c"]);
    await ui.mockInput.typeText("keep failed reply");
    await ui.mockInput.pressKeys(["\u0013", "\u001b[27u"]);
    failReply(new Error("Reply unavailable"));
    await ui.mockInput.pressKeys(["\u000e"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("Reply unavailable");
    await click(ui, node(ui, "reply-T1"));
    await ui.renderOnce();

    expect((node(ui, "comment-editor") as TextareaRenderable).plainText).toBe(
      "keep failed reply",
    );
    await ui.mockInput.pressKeys(["\u001b[27u", "z"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).not.toContain("Root body");
    await ui.mockInput.pressKeys(["\u0010"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).not.toContain("Root body");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("a comment published while loading becomes one shared thread when the fetch completes", async () => {
  const ui = await createTestRenderer({ width: 100, height: 50 });
  let finish!: (threads: ReviewThread[]) => void;
  const api = service();
  api.load = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const posted = { ...sample().comments[0], body: "Written during loading" };
  try {
    mountReview(
      ui.renderer,
      data(),
      themes["github-dark"],
      "inline",
      async () => posted,
      resolveKeybindings(),
      { threads: api },
    );
    await ui.mockInput.pressKeys(["\u000e", "j", "j", "j", "c"]);
    await ui.mockInput.typeText(posted.body);
    await ui.mockInput.pressKeys(["\u0013"]);
    await ui.waitFor(
      () => !ui.renderer.root.findDescendantById("comment-editor"),
    );
    finish([
      {
        ...sample(),
        side: "old",
        line: 1,
        startLine: null,
        comments: [posted],
      },
    ]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    expect(ui.renderer.root.findDescendantById("thread-T1")).toBeUndefined();
    expect(node(ui, "thread-local:1")).toBeDefined();
    expect(ui.captureCharFrame().match(/Written during loading/g)).toHaveLength(
      1,
    );
    await click(ui, node(ui, "reply-local:1"));
    await ui.renderOnce();

    expect(Boolean(ui.renderer.root.findDescendantById("comment-editor"))).toBe(
      true,
    );
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});
