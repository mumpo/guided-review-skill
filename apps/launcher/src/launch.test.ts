import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadPreferences } from "../../../packages/preferences/src";
import {
  launch,
  run,
  selectTarget,
  shellQuote,
  viewerCommand,
  type Request,
  type Run,
} from "./launch";

const temp = await mkdtemp(join(tmpdir(), "review-launcher-"));
const fixture = resolve(
  import.meta.dir,
  "../../../packages/core/fixtures/valid.json",
);
afterAll(() => rm(temp, { recursive: true, force: true }));
const defaults = await loadPreferences({}, {}, join(temp, "missing.toml"));

function recorder(reply = "") {
  const requests: Request[] = [];
  const run: Run = async (request) => {
    requests.push(request);
    return reply;
  };

  return { requests, run };
}

test("auto detection prefers calling Herdr, then tmux, then local macOS", () => {
  expect(
    selectTarget(
      "auto",
      {
        HERDR_PANE_ID: "p1",
        HERDR_WORKSPACE_ID: "w1",
        TMUX: "socket",
        TMUX_PANE: "%1",
      },
      "darwin",
    ),
  ).toBe("herdr-tab");
  expect(
    selectTarget("auto", { TMUX: "socket", TMUX_PANE: "%1" }, "linux"),
  ).toBe("tmux-window");
  expect(selectTarget("auto", {}, "darwin")).toBe("terminal-window");
  expect(() => selectTarget("auto", {}, "linux")).toThrow(
    "No supported terminal",
  );
  expect(() =>
    selectTarget("auto", { SSH_TTY: "/dev/pts/1" }, "darwin"),
  ).toThrow("No supported terminal");
  expect(selectTarget("custom", {}, "darwin")).toBe("custom");
});

test("custom command preserves argument boundaries and absolute config/viewer/artifact paths", async () => {
  const path = join(temp, "preferences ' $.toml");
  await writeFile(
    path,
    '[tui]\ndiff_mode = "inline"\n[tui.keybindings]\nnext_section = ["x"]',
  );
  const settings = await loadPreferences({ config: path }, {});
  const artifact = join(temp, "review ' `echo injected` $(echo injected).json");
  const { requests, run } = recorder();

  await launch(
    {
      ...settings,
      launch: "custom",
      custom: ["kitty", "--title", "Review", "{viewer}"],
    },
    artifact,
    { run, env: {}, cwd: temp },
  );

  expect(requests[0]).toEqual({
    argv: ["kitty", "--title", "Review", ...viewerCommand(settings, artifact)],
    cwd: temp,
    detached: true,
  });
  expect(requests[0].argv).toContain(path);
  expect(
    (
      await loadPreferences(
        { config: requests[0].argv[requests[0].argv.indexOf("--config") + 1] },
        {},
      )
    ).keybindings.next_section,
  ).toEqual(["x"]);
  expect(requests[0].argv.at(-1)).toBe(artifact);
});

test("tmux window, split, and popup target the calling session and return without waiting for review", async () => {
  const env = { TMUX: "socket", TMUX_PANE: "%7" };
  for (const target of ["tmux-window", "tmux-pane", "tmux-popup"] as const) {
    const { requests, run } = recorder(
      target === "tmux-window" ? "$0\n" : "/dev/ttys001\n",
    );

    const result = await launch(
      { ...defaults, launch: target, pane: { direction: "down", size: 35 } },
      fixture,
      { env, run, cwd: temp },
    );

    expect(result).toContain("Launch request accepted");
    expect(requests[0].argv).toContain("%7");
    if (target === "tmux-popup") {
      expect(requests[1].argv).toContain("/dev/ttys001");
      expect(requests[1].argv).toContain("90%");
      expect(requests[1].detached).toBe(true);
    } else {
      const creation = requests[requests.length - 1];
      expect(creation.argv.at(-1)).toBe(fixture);
      if (target === "tmux-window") expect(creation.argv).toContain("$0:");
      if (target === "tmux-pane") {
        expect(requests[0].argv).toContain("-v");
        expect(requests[0].argv).toContain("35%");
      }
    }
  }
});

test("Herdr runs only in the newly returned pane and explicitly targets the calling workspace/pane", async () => {
  for (const target of ["herdr-tab", "herdr-pane"] as const) {
    const response = JSON.stringify({
      result: { root_pane: { pane_id: "new" }, pane: { pane_id: "new" } },
    });
    const { requests, run } = recorder(response);

    await launch({ ...defaults, launch: target }, fixture, {
      run,
      env: { HERDR_PANE_ID: "original", HERDR_WORKSPACE_ID: "workspace" },
      cwd: temp,
    });

    expect(requests[0].argv).toContain(
      target === "herdr-tab" ? "workspace" : "original",
    );
    expect(requests[0].argv).toContain("--focus");
    expect(requests[1].argv.slice(0, 4)).toEqual([
      "herdr",
      "pane",
      "run",
      "new",
    ]);
    expect(requests[1].argv[4]).toContain(shellQuote(fixture));
  }
});

test("unsupported targets, invalid Herdr responses and adapter errors never fall back", async () => {
  for (const target of [
    "tmux-window",
    "tmux-pane",
    "tmux-popup",
    "herdr-tab",
    "herdr-pane",
    "terminal-window",
  ] as const) {
    const { requests, run } = recorder();

    await expect(
      launch({ ...defaults, launch: target }, fixture, {
        run,
        env: {},
        platform: "linux",
      }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  }

  const { requests, run } = recorder('{"result":{}}');
  await expect(
    launch({ ...defaults, launch: "herdr-tab" }, fixture, {
      run,
      env: { HERDR_PANE_ID: "p", HERDR_WORKSPACE_ID: "w" },
    }),
  ).rejects.toThrow("new pane ID");
  expect(requests).toHaveLength(1);

  let attempts = 0;
  await expect(
    launch(
      { ...defaults, launch: "custom", custom: ["missing", "{viewer}"] },
      fixture,
      {
        run: async () => {
          attempts++;
          throw new Error("ENOENT");
        },
      },
    ),
  ).rejects.toThrow("ENOENT");
  expect(attempts).toBe(1);
});

test("shell quoting preserves metacharacters rather than executing captured strings", async () => {
  const literal =
    "quote ' and \" newline\n dollar $(echo bad) backtick `echo bad` \\";
  const output = await run({
    argv: ["/bin/sh", "-c", `printf %s ${shellQuote(literal)}`],
    cwd: temp,
  });

  expect(output).toBe(literal);
  await expect(
    run({ argv: ["/does-not-exist"], cwd: temp, detached: true }),
  ).rejects.toThrow("ENOENT");
  await expect(
    run({
      argv: ["/bin/sh", "-c", "echo failure >&2; exit 2"],
      cwd: temp,
      detached: true,
    }),
  ).rejects.toThrow("failure");
});

test("Terminal AppleScript keeps shell input inside an escaped string literal", async () => {
  const { requests, run } = recorder();
  const artifact = join(temp, "quote \" and ' $(bad).json");
  await launch({ ...defaults, launch: "terminal-window" }, artifact, {
    run,
    env: {},
    platform: "darwin",
    cwd: temp,
  });

  expect(requests[0].argv.slice(0, 2)).toEqual(["osascript", "-e"]);
  const script = requests[0].argv[2];
  const encoded = script.split("do script ")[1].split("\nend tell")[0];
  expect(JSON.parse(encoded)).toContain(shellQuote(artifact));
});

test("public CLI skips disabled auto-opening, validates first, and retains artifacts on failure", async () => {
  const path = join(temp, "disabled.toml");
  await writeFile(
    path,
    'auto_open = false\n[tui]\nlaunch = "custom"\n[tui.custom]\ncommand = ["/does-not-exist", "{viewer}"]',
  );
  async function cli(args: string[]) {
    const child = Bun.spawn(
      [process.execPath, "run", "open:review", "--config", path, ...args],
      {
        cwd: resolve(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    return { code, stdout, stderr };
  }

  expect(await cli(["--from-skill", fixture])).toMatchObject({
    code: 0,
    stdout: expect.stringContaining("disabled"),
  });
  expect(await cli([fixture])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Open manually:"),
  });
  expect(await cli([join(temp, "missing.json")])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Cannot read artifact"),
  });
  expect(await Bun.file(fixture).exists()).toBe(true);
});

test("detached launchers survive later output after the launcher returns", async () => {
  const marker = join(temp, "detached-finished");

  await run({
    argv: [
      process.execPath,
      "-e",
      "setTimeout(async () => { console.log('later output'); console.error('later diagnostics'); await Bun.write(process.argv[1], 'finished'); }, 500)",
      marker,
    ],
    cwd: temp,
    detached: true,
  });
  expect(await Bun.file(marker).exists()).toBe(false);
  await Bun.sleep(700);

  expect(await Bun.file(marker).text()).toBe("finished");
});

test("skill discovery paths launch from unrelated directories with resolved preferences", async () => {
  const config = join(temp, "handoff.toml");
  const receiver = join(temp, "receive.ts");
  const captured = join(temp, "arguments.json");
  await writeFile(
    receiver,
    `await Bun.write(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2)));`,
  );
  await writeFile(
    config,
    `[tui]\nlaunch = "custom"\ntheme = "github-light"\ndiff_mode = "inline"\n[tui.custom]\ncommand = ${JSON.stringify([process.execPath, receiver, "{viewer}"])}\n`,
  );

  for (const discovery of [".agents", ".claude"]) {
    const skill = resolve(
      import.meta.dir,
      "../../..",
      discovery,
      "skills/guided-review",
    );
    const realSkill = await import("node:fs/promises").then(({ realpath }) =>
      realpath(skill),
    );
    const entry = resolve(realSkill, "../../apps/launcher/src/index.ts");
    const child = Bun.spawn(
      [
        process.execPath,
        entry,
        "--from-skill",
        "--config",
        config,
        "--",
        fixture,
      ],
      { cwd: temp, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("Launch request accepted: custom");
    const argv: string[] = JSON.parse(await Bun.file(captured).text());
    expect(argv).toContain(config);
    expect(argv).toContain("github-light");
    expect(argv).toContain("inline");
    expect(argv.at(-1)).toBe(fixture);
  }
});

test("Herdr closes its review pane after success and leaves failures visible", async () => {
  const directory = await mkdtemp(join(temp, "cleanup-"));
  const marker = join(directory, "closed.json");
  const binary = join(directory, "herdr");
  await writeFile(
    binary,
    `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o700 },
  );

  for (const target of ["herdr-tab", "herdr-pane"] as const) {
    for (const status of [0, 1]) {
      await rm(marker, { force: true });
      const { requests, run } = recorder(
        JSON.stringify({
          result: {
            root_pane: { pane_id: "owned" },
            pane: { pane_id: "owned" },
          },
        }),
      );
      await launch({ ...defaults, launch: target }, fixture, {
        run,
        env: { HERDR_PANE_ID: "original", HERDR_WORKSPACE_ID: "workspace" },
      });
      const viewer = viewerCommand(defaults, fixture).map(shellQuote).join(" ");
      const simulatedViewer = [
        process.execPath,
        "-e",
        `process.exit(${status})`,
      ]
        .map(shellQuote)
        .join(" ");
      const submitted = requests[1].argv[4].replace(viewer, simulatedViewer);
      const child = Bun.spawn(["/bin/sh", "-c", submitted], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await child.exited).toBe(status);
      if (status === 0) {
        expect(JSON.parse(await Bun.file(marker).text())).toEqual([
          "pane",
          "close",
          "owned",
        ]);
      } else {
        expect(await Bun.file(marker).exists()).toBe(false);
      }
    }
  }
});
