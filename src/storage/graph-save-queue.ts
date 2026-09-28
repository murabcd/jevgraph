/** Serializes and coalesces graph writes while retaining the last acknowledged revision. */
export class GraphSaveQueue {
	private revision: number;
	private acknowledged: string;
	private pending: string | null = null;
	private flushing: Promise<void> | null = null;
	private failure: Error | null = null;
	private observed: { graph: string; revision: number } | null = null;
	private listeners = new Set<() => void>();
	private snapshot: {
		remote: { graph: string; revision: number };
		error: string;
	};
	constructor(
		revision: number,
		graph: string,
		privateWrite: (graph: string, revision: number) => Promise<number>,
	) {
		this.revision = revision;
		this.acknowledged = graph;
		this.write = privateWrite;
		this.snapshot = { remote: { graph, revision }, error: "" };
	}
	getSnapshot = () => this.snapshot;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish() {
		for (const listener of this.listeners) listener();
	}
	private write: (graph: string, revision: number) => Promise<number>;
	get busy() {
		return this.pending !== null || this.flushing !== null;
	}
	get failed() {
		return this.failure !== null;
	}
	observe(revision: number, graph: string) {
		if (this.busy) {
			this.observed = { graph, revision };
			return;
		}
		if (this.failed || revision <= this.revision) return;
		this.revision = revision;
		this.acknowledged = graph;
		this.snapshot = { remote: { graph, revision }, error: "" };
		this.publish();
	}
	enqueue(graph: string) {
		if (this.failed || (graph === this.acknowledged && this.pending === null))
			return;
		this.pending = graph;
	}
	async flush(): Promise<void> {
		if (this.failure) throw this.failure;
		if (this.flushing) return this.flushing;
		this.flushing = this.drain();
		try {
			await this.flushing;
		} finally {
			this.flushing = null;
			if (this.observed) {
				const { graph, revision } = this.observed;
				this.observed = null;
				this.observe(revision, graph);
			}
		}
	}
	private async drain() {
		try {
			while (this.pending !== null) {
				const graph = this.pending;
				this.pending = null;
				if (graph === this.acknowledged) continue;
				this.revision = await this.write(graph, this.revision);
				this.acknowledged = graph;
			}
		} catch (error) {
			this.failure =
				error instanceof Error ? error : new Error("Graph could not be saved");
			this.snapshot = { ...this.snapshot, error: this.failure.message };
			this.publish();
			throw this.failure;
		}
	}
}
