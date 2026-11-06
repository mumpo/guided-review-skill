import type { CliRenderer } from "@opentui/core";
import { Worker } from "node:worker_threads";
import {
  highlightSource,
  languageForFence,
  type SourceColors,
} from "./highlight";

export interface SyntaxService {
  highlight(
    source: string,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<SourceColors | undefined>;
}

type Job = {
  id: number;
  key: string;
  source: string;
  language: string;
  background: boolean;
  listeners: Set<{
    resolve: (colors: SourceColors | undefined) => void;
    signal?: AbortSignal;
    abort: () => void;
  }>;
};

/** One worker and a bounded exact-source cache per viewer session. */
export class HighlightService implements SyntaxService {
  private worker?: Worker;
  private unavailable = false;
  private sequence = 0;
  private active?: Job;
  private jobs = new Map<string, Job>();
  private cache = new Map<
    string,
    { colors: SourceColors | undefined; bytes: number }
  >();
  private bytes = 0;
  private waiters = new Set<() => void>();

  constructor(
    private maxEntries = 128,
    private maxBytes = 16 * 1024 * 1024,
    private createWorker: () => Worker = () =>
      new Worker(new URL("./highlight-worker.ts", import.meta.url)),
  ) {}

  highlight(
    source: string,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<SourceColors | undefined> {
    return this.request(source, language, signal, false);
  }

  /** Warm one captured sample per language without delaying visible requests. */
  preload(samples: Iterable<{ source: string; language: string }>) {
    for (const { source, language } of samples) {
      void this.request(source, language, undefined, true);
    }
  }

  private request(
    source: string,
    language: string | undefined,
    signal: AbortSignal | undefined,
    background: boolean,
  ): Promise<SourceColors | undefined> {
    if (
      this.unavailable ||
      signal?.aborted ||
      !language ||
      languageForFence(language) !== language
    )
      return Promise.resolve(undefined);

    const key = JSON.stringify([language, source]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached.colors);
    }

    let job = this.jobs.get(key);
    if (!job) {
      job = {
        id: ++this.sequence,
        key,
        source,
        language,
        background,
        listeners: new Set(),
      };
      this.jobs.set(key, job);
    }
    if (!background) job.background = false;

    const request = job;

    const promise = new Promise<SourceColors | undefined>((resolve) => {
      const listener = {
        resolve,
        signal,
        abort: () => {
          request.listeners.delete(listener);
          signal?.removeEventListener("abort", listener.abort);
          resolve(undefined);
          if (!request.listeners.size && request !== this.active)
            this.jobs.delete(key);
        },
      };
      request.listeners.add(listener);
      signal?.addEventListener("abort", listener.abort, { once: true });
    });

    this.pump();
    return promise;
  }

  private pump() {
    if (this.active || this.unavailable) return;

    const job =
      [...this.jobs.values()].find((request) => !request.background) ??
      this.jobs.values().next().value;
    if (!job) return;

    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        this.worker.on(
          "message",
          ({ id, colors }: { id: number; colors?: SourceColors }) => {
            if (!this.active || this.active.id !== id) return;

            const request = this.active;
            // Revalidate the structured-clone boundary before touching rendered source.
            const validated =
              colors &&
              highlightSource(
                request.source,
                request.language,
                (_source, _language, theme) => colors[theme],
              );
            const bytes =
              (request.key.length + JSON.stringify(validated ?? null).length) *
              2;
            if (bytes <= this.maxBytes) {
              this.cache.set(request.key, { colors: validated, bytes });
              this.bytes += bytes;
              while (
                this.cache.size > this.maxEntries ||
                this.bytes > this.maxBytes
              ) {
                const key = this.cache.keys().next().value;
                if (key === undefined) break;

                this.bytes -= this.cache.get(key)?.bytes ?? 0;
                this.cache.delete(key);
              }
            }
            this.finish(request, validated);
            this.active = undefined;
            this.pump();
            if (!this.jobs.size) this.flushWaiters();
          },
        );
        this.worker.on("error", () => this.dispose());
        this.worker.on("exit", () => this.dispose());
      }
      this.active = job;
      this.worker.postMessage({
        id: job.id,
        source: job.source,
        language: job.language,
      });
    } catch {
      this.dispose();
    }
  }

  private finish(job: Job, colors: SourceColors | undefined) {
    this.jobs.delete(job.key);
    for (const listener of job.listeners) {
      listener.signal?.removeEventListener("abort", listener.abort);
      listener.resolve(colors);
    }
    job.listeners.clear();
  }

  async settled(): Promise<void> {
    if (this.jobs.size)
      await new Promise<void>((resolve) => this.waiters.add(resolve));

    // Let consumers apply colors, including aggregated diff fragment results.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  private flushWaiters() {
    for (const resolve of this.waiters) resolve();

    this.waiters.clear();
  }

  dispose() {
    if (this.unavailable) return;

    this.unavailable = true;
    for (const job of this.jobs.values()) this.finish(job, undefined);

    this.active = undefined;
    void this.worker?.terminate();
    this.worker = undefined;
    this.cache.clear();
    this.bytes = 0;
    this.flushWaiters();
  }
}

const sessions = new WeakMap<CliRenderer, HighlightService>();

export function sessionHighlights(renderer: CliRenderer): HighlightService {
  let service = sessions.get(renderer);
  if (!service) {
    service = new HighlightService();
    sessions.set(renderer, service);
    renderer.once("destroy", () => service?.dispose());
  }

  return service;
}
