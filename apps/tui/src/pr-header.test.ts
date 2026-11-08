import { expect, test } from "bun:test";
import {
  RGBA,
  type ScrollBoxRenderable,
  TextAttributes,
  type TextRenderable,
} from "@opentui/core";
import {
  createTestRenderer,
  setRendererCapabilities,
} from "@opentui/core/testing";
import fixture from "../../../packages/core/fixtures/valid.json";
import type { ReviewSnapshot } from "../../../packages/core/src";
import { loadReview } from "./load";
import { PullRequestHeader } from "./pr-header";
import { themes } from "./theme";
import { mountFullWidthReview as mountReview } from "./view-test-utils";

const pr: ReviewSnapshot["pullRequest"] = {
  ...fixture.pullRequest,
  status: "open",
  commitCount: 2,
  baseRefName: "main",
  headRefName: "feature/header",
};

for (const theme of Object.values(themes)) {
  test(`${theme.name}: PR header paints literal text, status icons, branches and a native hyperlink`, async () => {
    const ui = await createTestRenderer({ width: 120, height: 15 });

    try {
      setRendererCapabilities(ui.renderer, { hyperlinks: true });

      for (const [status, label, icon, verb] of [
        ["draft", "Draft", "\uf4dd", "wants to merge"],
        ["open", "Open", "\uf407", "wants to merge"],
        ["merged", "Merged", "\uf419", "merged"],
        ["closed", "Closed", "\uf4dc", "proposed merging"],
      ] as const) {
        const current = new PullRequestHeader(
          ui.renderer,
          { ...pr, title: "**literal title**", status },
          theme,
        );
        ui.renderer.root.add(current);
        await ui.renderOnce();

        const frame = ui.captureCharFrame();
        const spans = ui.captureSpans().lines.flatMap((line) => line.spans);
        const title = spans.find((span) =>
          span.text.includes("**literal title**"),
        );
        const number = spans.find((span) => span.text.includes("#42"));
        const badge = spans.find((span) => span.text.includes(label));
        const author = spans.find((span) => span.text.includes(pr.author));
        const branch = spans.find((span) =>
          span.text.includes("feature/header"),
        );

        expect(frame).toContain(`**literal title** #42`);
        expect(frame).toContain(`${icon} ${label}`);
        expect(frame).toContain(`${pr.author} ${verb} 2 commits into`);
        expect((title?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();
        expect(number?.fg.equals(RGBA.fromHex("#59636e"))).toBe(true);
        expect((number?.attributes ?? 0) & TextAttributes.BOLD).toBe(0);
        expect(badge?.fg.equals(RGBA.fromHex("#ffffff"))).toBe(true);
        expect(badge?.bg.equals(RGBA.fromHex(theme.pullRequest[status]))).toBe(
          true,
        );
        expect(
          (author?.attributes ?? 0) & TextAttributes.UNDERLINE,
        ).toBeTruthy();
        expect(
          branch?.fg.equals(RGBA.fromHex(theme.pullRequest.branch.foreground)),
        ).toBe(true);
        expect(
          branch?.bg.equals(RGBA.fromHex(theme.pullRequest.branch.background)),
        ).toBe(true);

        const node = current.findDescendantById("pr-title") as TextRenderable;
        expect(node.content.chunks.find((chunk) => chunk.link)).toMatchObject({
          text: "#42",
          link: { url: pr.url },
        });

        current.destroyRecursively();
      }
    } finally {
      await ui.dispose();
    }
  });
}

test("legacy and partial metadata stay passive and never invent merge details", async () => {
  const ui = await createTestRenderer({ width: 110, height: 12 });

  try {
    for (const captured of [
      fixture.pullRequest,
      { ...fixture.pullRequest, status: "open" as const, commitCount: 2 },
    ]) {
      const header = new PullRequestHeader(
        ui.renderer,
        captured,
        themes["github-dark"],
      );
      ui.renderer.root.add(header);
      await ui.renderOnce();

      const frame = ui.captureCharFrame();
      expect(frame).toContain("Update the greeting #42");
      expect(frame).toContain(pr.author);
      expect(frame).not.toContain("wants to merge");
      expect(frame).not.toContain("main");

      header.destroyRecursively();
    }

    for (const url of [
      "javascript:alert(1)",
      "http://github.com/example/project/pull/42",
      "https://other.example/project/pull/42",
      "https://user@github.com/example/project/pull/42",
      "https://github.com/example/project/pull/42?next=unsafe",
      "https://github.com/example/project/issues/42",
    ]) {
      const header = new PullRequestHeader(
        ui.renderer,
        { ...pr, url },
        themes["github-dark"],
      );
      ui.renderer.root.add(header);

      const title = header.findDescendantById("pr-title") as TextRenderable;
      expect(title.content.chunks.every((chunk) => !chunk.link)).toBe(true);

      header.destroyRecursively();
    }
  } finally {
    await ui.dispose();
  }
});

test("singular wording, long metadata, scrolling, resizing, navigation and live themes", async () => {
  for (const mode of ["inline", "side-by-side"] as const) {
    const review = await loadReview(
      new URL("../../../packages/core/fixtures/valid.json", import.meta.url)
        .pathname,
    );
    review.snapshot.pullRequest = {
      ...pr,
      commitCount: 1,
      title: "A long title ".repeat(10),
      headRefName:
        "feature/long-branch-name-with-unbroken-text-for-narrow-terminals",
    };
    review.snapshot.pullRequest.description = "Scrollable narrative\n".repeat(
      60,
    );

    const ui = await createTestRenderer({ width: 110, height: 18 });

    try {
      const applyTheme = mountReview(
        ui.renderer,
        review,
        themes["github-light"],
        mode,
      );
      await ui.renderOnce();

      expect(ui.captureCharFrame()).toContain("wants to merge 1 commit into");

      const body = ui.renderer.root.findDescendantById(
        "body",
      ) as ScrollBoxRenderable;
      await ui.mockInput.pressKeys(["j", "j"]);
      await ui.renderOnce();

      const scrollTop = body.scrollTop;
      const title = ui.renderer.root.findDescendantById("pr-title");
      applyTheme(themes["github-dark"]);
      await ui.renderOnce();

      expect(body.scrollTop).toBe(scrollTop);
      expect(ui.renderer.root.findDescendantById("pr-title")).toBe(title);

      const recolored = ui.renderer.root.findDescendantById(
        "pr-details",
      ) as TextRenderable;
      const branch = recolored.content.chunks.find((chunk) =>
        chunk.text.includes("feature/long-branch"),
      );
      expect(
        branch?.bg?.equals(
          RGBA.fromHex(themes["github-dark"].pullRequest.branch.background),
        ),
      ).toBe(true);

      ui.resize(30, 24);
      await ui.renderOnce();
      await ui.mockInput.pressKeys(["\u000e"]);
      await ui.renderOnce();

      expect(ui.renderer.root.findDescendantById("pr-title")).toBe(title);

      await ui.mockInput.pressKeys(["s"]);
      await ui.renderOnce();

      expect(body.scrollTop).toBe(0);
      const details = ui.renderer.root.findDescendantById(
        "pr-details",
      ) as TextRenderable;
      expect(
        details.content.chunks.map((chunk) => chunk.text).join(""),
      ).toContain("1 commit into");
      expect(details.height).toBeGreaterThan(1);

      ui.resize(110, 18);
      await ui.renderOnce();

      expect(ui.captureCharFrame()).toContain("feature/long-branch-name");
    } finally {
      await ui.dispose();
    }
  }
});
