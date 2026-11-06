import { expect, test } from "bun:test";
import {
  TextareaRenderable,
  TextAttributes,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { createTestRenderer, KeyCodes } from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import { analyzeDiffs, type ReviewSnapshot } from "../../../packages/core/src";
import type { CommentTarget, PublishedComment } from "./comments";
import { mountReview } from "./view";
import { themes } from "./theme";
import { sessionHighlights } from "./highlight-service";

function data() {
  const snapshot = structuredClone(fixture) as ReviewSnapshot;
  snapshot.sections[0].references = [{ kind: "file", fileId: "greeting" }];

  return { snapshot, analysis: analyzeDiffs(snapshot) };
}

const posted: PublishedComment = {
  id: 10,
  body: "Posted body",
  author: "me",
  url: `${fixture.pullRequest.url}#discussion_r10`,
};

for (const theme of Object.values(themes)) {
  for (const mode of ["inline", "side-by-side"] as const) {
    test(`${theme.name}/${mode}: editor consumes shortcuts, retains multiline drafts, and publishes source coordinates`, async () => {
      const ui = await createTestRenderer({ width: 120, height: 45 });
      const calls: { target: CommentTarget; body: string }[] = [];
      let finish!: (comment: PublishedComment) => void;

      try {
        const applyTheme = mountReview(
          ui.renderer,
          data(),
          theme,
          mode,
          async (target, body) => {
            calls.push({ target, body });

            return new Promise<PublishedComment>((resolve) => {
              finish = resolve;
            });
          },
        );
        await ui.mockInput.pressKeys(["n", "j", "j", "c"]);
        await sessionHighlights(ui.renderer).settled();
        await ui.renderOnce();

        const editor = () =>
          ui.renderer.root.findDescendantById(
            "comment-editor",
          ) as TextareaRenderable;
        const source = ui
          .captureCharFrame()
          .split("\n")
          .findIndex((line) =>
            line.includes(mode === "inline" ? "-hello" : "+hello world"),
          );
        const label = ui
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("line 1"));

        expect(label).toBeGreaterThan(source);
        const selected = ui
          .captureSpans()
          .lines[source].spans.find((span) =>
            span.text.includes(mode === "inline" ? "hello" : "world"),
          );
        expect(
          (selected?.attributes ?? 0) & TextAttributes.UNDERLINE,
        ).toBeTruthy();
        expect(editor()).toBeInstanceOf(TextareaRenderable);
        if (mode === "side-by-side") {
          const sourceText = ui.captureCharFrame().split("\n")[source];
          expect(editor().parent?.x).toBe(sourceText.indexOf(" │ ") + 3);
        } else expect(editor().x).toBeLessThan(6);

        await ui.mockInput.typeText("qnjkcdsz");
        await ui.mockInput.pressKeys([KeyCodes.RETURN]);
        await ui.mockInput.pasteBracketedText("second 🐱\nthird");
        await ui.renderOnce();

        const body = "qnjkcdsz\nsecond 🐱\nthird";
        expect(editor().plainText).toBe(body);
        const offset = editor().cursorOffset;
        await ui.mockInput.pressKeys(["\u001b[27u"]);
        await ui.renderOnce();

        expect(Boolean(editor())).toBe(false);
        await ui.mockInput.pressKeys(["n", "p", "j", "j", "c"]);
        await ui.renderOnce();

        expect(editor().plainText).toBe(body);
        expect(editor().cursorOffset).toBe(offset);
        applyTheme(
          themes[
            theme.name === "github-light" ? "github-dark" : "github-light"
          ],
        );
        ui.resize(90, 38);
        await ui.renderOnce();

        expect(editor().plainText).toBe(body);
        await ui.mockInput.pressKeys(["\u0013", "\u0013"]);
        await ui.mockInput.pasteBracketedText("must not change pending body");
        await ui.renderOnce();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
          target: {
            fileId: "greeting",
            path: "src/greeting.ts",
            side: mode === "inline" ? "old" : "new",
            line: 1,
          },
          body,
        });
        expect(editor().plainText).toBe(body);
        expect(ui.captureCharFrame()).toContain("Publishing");

        finish(posted);
        await ui.waitFor(() => !editor());
        await ui.renderOnce();

        expect(ui.captureCharFrame()).toContain("me: Posted body");
        await ui.mockInput.pressKeys(["n", "p"]);
        await ui.renderOnce();

        expect(ui.captureCharFrame()).toContain("me: Posted body");
        await ui.mockInput.pressKeys(["j", "j", "c"]);
        await ui.renderOnce();

        expect(editor().plainText).toBe("");
      } finally {
        await sessionHighlights(ui.renderer).settled();
        await ui.dispose();
      }
    });
  }
}

test("split cursor skips metadata, switches sides with Space, and preserves source through layout changes", async () => {
  const ui = await createTestRenderer({ width: 120, height: 42 });
  const targets: CommentTarget[] = [];

  try {
    mountReview(
      ui.renderer,
      data(),
      themes["github-dark"],
      "side-by-side",
      async (target) => {
        targets.push(target);

        return posted;
      },
    );
    await ui.mockInput.pressKeys(["n", "j", "j", " ", "c"]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("old line 1");
    await ui.mockInput.typeText("delete comment");
    await ui.mockInput.pressKeys(["\u0013"]);
    await ui.waitFor(
      () =>
        targets.length === 1 &&
        !ui.renderer.root.findDescendantById("comment-editor"),
    );
    await ui.mockInput.pressKeys(["j", "c"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("old line 2");
    await ui.mockInput.typeText("context draft");
    await ui.mockInput.pressKeys(["\u001b[27u", "d", "d", "c"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("new line 2");
    await ui.mockInput.pressKeys(["\u001b[27u", "j", "c"]);
    await ui.renderOnce();

    expect(ui.captureCharFrame()).toContain("old line 10");
    expect(targets[0].side).toBe("old");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("empty and failed submissions keep the editor and draft; Esc during publishing preserves the result", async () => {
  const ui = await createTestRenderer({ width: 120, height: 42 });
  let calls = 0;
  let finish!: (comment: PublishedComment) => void;

  try {
    mountReview(
      ui.renderer,
      data(),
      themes["github-dark"],
      "inline",
      async () => {
        calls++;
        if (calls === 1) throw new Error("Generate a fresh artifact");

        return new Promise<PublishedComment>((resolve) => {
          finish = resolve;
        });
      },
    );
    const editor = () =>
      ui.renderer.root.findDescendantById(
        "comment-editor",
      ) as TextareaRenderable;
    await ui.mockInput.pressKeys(["n", "j", "j", "c", "\u0013"]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    expect(calls).toBe(0);
    expect(ui.captureCharFrame()).toContain("Write a comment");
    await ui.mockInput.typeText("retain me");
    await ui.mockInput.pressKeys(["\u0013"]);
    await ui.waitForFrame((frame) => frame.includes("fresh artifact"));

    expect(editor().plainText).toBe("retain me");
    await ui.mockInput.pressKeys(["\u001b[27u", "c", "\u0013", "\u001b[27u"]);
    await ui.renderOnce();

    expect(Boolean(editor())).toBe(false);
    expect(calls).toBe(2);
    finish(posted);
    await ui.waitForFrame((frame) => frame.includes("me: Posted body"));
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("cursor scrolls into view and collapsed files and non-source sections cannot open editors", async () => {
  const ui = await createTestRenderer({ width: 100, height: 20 });
  const review = data();
  review.snapshot.sections[0].explanation = "Long explanation\n".repeat(60);

  try {
    mountReview(ui.renderer, review);
    await ui.mockInput.pressKeys(["n", ...Array(61).fill("j")]);
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    const body = ui.renderer.root.findDescendantById(
      "body",
    ) as ScrollBoxRenderable;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(ui.captureCharFrame()).toContain("▸");
    await ui.mockInput.pressKeys(["z", "c"]);
    await ui.renderOnce();

    expect(Boolean(ui.renderer.root.findDescendantById("comment-editor"))).toBe(
      false,
    );
    await ui.mockInput.pressKeys(["n", "n", "c"]);
    await ui.renderOnce();

    expect(Boolean(ui.renderer.root.findDescendantById("comment-editor"))).toBe(
      false,
    );
    await ui.mockInput.pressKeys(["s", "c"]);
    await ui.renderOnce();

    expect(Boolean(ui.renderer.root.findDescendantById("comment-editor"))).toBe(
      false,
    );
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("automatic layout changes retain old-context editor text, focus, and source anchor", async () => {
  const ui = await createTestRenderer({ width: 120, height: 38 });

  try {
    mountReview(ui.renderer, data());
    await ui.mockInput.pressKeys(["n", "j", "j", "j", " ", "c"]);
    await ui.mockInput.typeText("context draft");
    await sessionHighlights(ui.renderer).settled();
    await ui.renderOnce();

    const editor = () =>
      ui.renderer.root.findDescendantById(
        "comment-editor",
      ) as TextareaRenderable;
    expect(editor().plainText).toBe("context draft");
    expect(ui.captureCharFrame()).toContain("old line 2");

    ui.resize(70, 38);
    await ui.renderOnce();

    expect(editor().plainText).toBe("context draft");
    expect(editor().focused).toBe(true);
    expect(editor().x).toBeLessThan(6);
    expect(ui.captureCharFrame()).toContain("old line 2");
    await ui.mockInput.typeText(" continues");
    ui.resize(120, 38);
    await ui.renderOnce();

    expect(editor().plainText).toBe("context draft continues");
    expect(editor().focused).toBe(true);
    expect(editor().x).toBeGreaterThan(55);
    expect(ui.captureCharFrame()).toContain("old line 2");
  } finally {
    await sessionHighlights(ui.renderer).settled();
    await ui.dispose();
  }
});

test("renamed and deleted files publish correct paths and comments follow overlapping references", async () => {
  for (const deleted of [false, true]) {
    const review = data();
    const file = review.snapshot.files[1];
    if (deleted) {
      file.newPath = null;
      file.status = "deleted";
      file.diff = { kind: "text", unified: "@@ -1 +0,0 @@\n-Old guide\n" };
    }
    review.snapshot.sections = [1, 2].map((index) => ({
      title: `Guide ${index}`,
      explanation: "Inspect the guide.",
      references: [{ kind: "file", fileId: "guide" }],
    }));
    review.analysis = analyzeDiffs(review.snapshot);
    const ui = await createTestRenderer({ width: 120, height: 40 });
    const targets: CommentTarget[] = [];

    try {
      mountReview(
        ui.renderer,
        review,
        themes["github-dark"],
        "inline",
        async (target, body) => {
          targets.push(target);

          return { ...posted, id: targets.length, body };
        },
      );
      const editor = () =>
        ui.renderer.root.findDescendantById("comment-editor");
      await ui.mockInput.pressKeys(["n", "j", "j", "c"]);
      await ui.mockInput.typeText("First comment");
      await ui.mockInput.pressKeys(["\u0013"]);
      await sessionHighlights(ui.renderer).settled();
      await ui.waitFor(() => !editor());
      await ui.mockInput.pressKeys(["n", "j", "j", "c"]);
      await ui.mockInput.typeText("Second comment");
      await ui.mockInput.pressKeys(["\u0013"]);
      await ui.waitFor(() => !editor());
      await ui.renderOnce();

      expect(targets).toHaveLength(2);
      expect(targets[0]).toEqual({
        fileId: "guide",
        path: deleted ? "guide.md" : "docs/guide.md",
        side: "old",
        line: 1,
      });
      expect(targets[1]).toEqual(targets[0]);
      const frame = ui.captureCharFrame();
      expect(frame).toContain("First comment");
      expect(frame).toContain("Second comment");
      expect(frame.indexOf("First comment")).toBeLessThan(
        frame.indexOf("Second comment"),
      );
    } finally {
      await sessionHighlights(ui.renderer).settled();
      await ui.dispose();
    }
  }
});
