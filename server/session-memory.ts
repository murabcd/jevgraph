import { createHash } from "node:crypto";
import type { ContextSummaries } from "../src/lib/context.ts";

const TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 16;
const MAX_SUMMARIES = 256;
const MAX_SUMMARY_CHARACTERS = 500000;
const MAX_PREFIXES = 128;

export function contentFingerprint(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export type SummaryStore = {
	get: (key: string) => Promise<ContextSummaries | null>;
	put: (key: string, value: ContextSummaries) => Promise<void>;
};

type CachedSummary = { value: ContextSummaries; expiresAt: number };
type PrefixObservation = { tokens: number; expiresAt: number };

/** Temporary session data. No conversation bodies or completed answers are stored. */
export class SessionMemory {
	private summaries = new Map<string, CachedSummary>();
	private pending = new Map<string, Promise<ContextSummaries>>();
	private prefixes = new Map<string, PrefixObservation>();
	private summaryCharacters = 0;

	private now: () => number;
	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	async summarize(
		key: string,
		create: () => Promise<ContextSummaries>,
		store?: SummaryStore,
	): Promise<{
		value: ContextSummaries;
		cache: "created" | "reused";
	}> {
		const cached = this.summaries.get(key);
		if (cached && cached.expiresAt > this.now()) {
			this.summaries.delete(key);
			this.summaries.set(key, cached);
			return { value: cached.value, cache: "reused" };
		}
		const pending = this.pending.get(key);
		if (pending) return { value: await pending, cache: "reused" };
		if (this.pending.size >= 16)
			throw new Error("Summary concurrency limit reached");
		let cache: "created" | "reused" = "created";
		const task = (async () => {
			const saved = store ? await store.get(key) : null;
			if (saved) {
				cache = "reused";
				return saved;
			}
			const value = await create();
			await store?.put(key, value);
			return value;
		})();
		this.pending.set(key, task);
		try {
			const value = await task;
			if (cached) this.removeSummary(key, cached);
			this.summaries.set(key, { value, expiresAt: this.now() + TTL_MS });
			this.summaryCharacters += value.short.length + value.detailed.length;
			while (
				this.summaries.size > MAX_SUMMARIES ||
				this.summaryCharacters > MAX_SUMMARY_CHARACTERS
			) {
				const oldest = this.summaries.entries().next().value;
				if (!oldest) break;
				this.removeSummary(...oldest);
			}
			return { value, cache };
		} finally {
			this.pending.delete(key);
		}
	}

	private removeSummary(key: string, cached: CachedSummary) {
		this.summaries.delete(key);
		this.summaryCharacters -=
			cached.value.short.length + cached.value.detailed.length;
	}

	cachedTokens(key: string): number {
		const observation = this.prefixes.get(key);
		if (!observation || observation.expiresAt <= this.now()) {
			this.prefixes.delete(key);
			return 0;
		}
		return observation.tokens;
	}

	observePrefix(key: string, tokens: number, ttlMs: number) {
		this.prefixes.delete(key);
		if (tokens > 0)
			this.prefixes.set(key, { tokens, expiresAt: this.now() + ttlMs });
		while (this.prefixes.size > MAX_PREFIXES) {
			const oldest = this.prefixes.keys().next().value;
			if (oldest === undefined) break;
			this.prefixes.delete(oldest);
		}
	}
}

export class SessionMemoryPool {
	private sessions = new Map<
		string,
		{ memory: SessionMemory; expiresAt: number }
	>();
	private now: () => number;
	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	get(scope: string): SessionMemory {
		for (const [key, session] of this.sessions) {
			if (session.expiresAt <= this.now()) this.sessions.delete(key);
		}
		const memory =
			this.sessions.get(scope)?.memory ?? new SessionMemory(this.now);
		this.sessions.delete(scope);
		this.sessions.set(scope, { memory, expiresAt: this.now() + TTL_MS });
		while (this.sessions.size > MAX_SESSIONS) {
			const oldest = this.sessions.keys().next().value;
			if (oldest === undefined) break;
			this.sessions.delete(oldest);
		}
		return memory;
	}
}
