import { AsyncLocalStorage } from "node:async_hooks";
import {
	evidenceCoverage,
	MAX_PROVIDER_EVIDENCE_BYTES,
	type ProviderExchange,
} from "../src/lib/provider-evidence.ts";
import type { ProviderFetch } from "./provider-access.ts";

/** Captures consumed provider bodies, without headers or URL query credentials. */
export class ProviderEvidence {
	private scope = new AsyncLocalStorage<string>();
	private exchanges: ProviderExchange[] = [];
	private remaining = MAX_PROVIDER_EVIDENCE_BYTES;
	private credentials: string[];

	constructor(credentials: string[] = []) {
		this.credentials = credentials.filter((value) => value.length > 0);
	}

	redact = (text: string) => {
		for (const credential of this.credentials)
			text = text.replaceAll(credential, "*");
		return text;
	};

	/** Holds only a possible credential prefix so split deltas cannot reveal a complete key. */
	streamRedactor() {
		let pending = "";
		return {
			write: (text: string) => {
				pending = this.redact(pending + text);
				let keep = 0;
				for (const credential of this.credentials) {
					for (
						let length = Math.min(credential.length - 1, pending.length);
						length > keep;
						length--
					) {
						if (pending.endsWith(credential.slice(0, length))) {
							keep = length;
							break;
						}
					}
				}
				const visible = pending.slice(0, pending.length - keep);
				pending = pending.slice(pending.length - keep);
				return visible;
			},
			finish: () => {
				const text = pending;
				pending = "";
				return text;
			},
		};
	}

	run<T>(callId: string, run: () => Promise<T>) {
		return this.scope.run(callId, run);
	}

	snapshot(): ProviderExchange[] {
		const body = (value: ProviderExchange["request"]) => {
			const text = this.redact(value.text);
			return {
				...value,
				text,
				complete: value.complete && text === value.text,
			};
		};
		return this.exchanges.map((exchange) => ({
			...exchange,
			request: body(exchange.request),
			response: body(exchange.response),
			error:
				exchange.error === undefined ? undefined : this.redact(exchange.error),
		}));
	}

	artifactEvidence(callIds: string[]) {
		const providerEvidence = this.snapshot();
		return {
			providerEvidence,
			coverage: evidenceCoverage(providerEvidence, callIds),
		};
	}

	private retain(
		body: ProviderExchange["request"],
		text: string,
		bytes: number,
	) {
		body.bytes += bytes;
		let end = text.length;
		const size = (end: number) =>
			new TextEncoder().encode(JSON.stringify(text.slice(0, end))).length - 2;
		if (size(end) > this.remaining) {
			let low = 0,
				high = end;
			while (low < high) {
				const middle = Math.ceil((low + high) / 2);
				if (size(middle) <= this.remaining) low = middle;
				else high = middle - 1;
			}
			end = low;
			if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
			body.complete = false;
		}
		body.text += text.slice(0, end);
		this.remaining -= size(end);
	}

	fetch(
		transport: NonNullable<ProviderFetch> = globalThis.fetch,
	): NonNullable<ProviderFetch> {
		return async (input, init) => {
			const callId = this.scope.getStore();
			if (!callId)
				throw new Error("Provider request has no ledger call identity");
			if (this.exchanges.length >= 200)
				throw new Error("Provider exchange budget exceeded");
			const request = new Request(input, init);
			const url = new URL(request.url);
			const exchange: ProviderExchange = {
				id: `exchange:${this.exchanges.length + 1}`,
				callId,
				endpoint: `${url.origin}${url.pathname}`,
				method: request.method,
				request: { text: "", bytes: 0, complete: true },
				response: { text: "", bytes: 0, complete: true },
				state: "running",
			};
			this.exchanges.push(exchange);
			try {
				const requestBytes = new Uint8Array(
					await request.clone().arrayBuffer(),
				);
				let requestText: string;
				try {
					requestText = new TextDecoder("utf-8", {
						fatal: true,
						ignoreBOM: true,
					}).decode(requestBytes);
				} catch {
					exchange.request.complete = false;
					requestText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
						requestBytes,
					);
				}
				this.retain(exchange.request, requestText, requestBytes.byteLength);
				const response = await transport(input, init);
				exchange.httpStatus = response.status;
				if (!response.body) {
					exchange.state = "completed";
					return response;
				}
				const reader = response.body.getReader();
				let decoder = new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: true,
				});
				const decode = (bytes?: Uint8Array) => {
					try {
						return decoder.decode(bytes, { stream: bytes !== undefined });
					} catch {
						exchange.response.complete = false;
						decoder = new TextDecoder("utf-8", { ignoreBOM: true });
						return decoder.decode(bytes, { stream: bytes !== undefined });
					}
				};
				const body = new ReadableStream<Uint8Array>({
					pull: async (controller) => {
						try {
							const part = await reader.read();
							if (part.done) {
								this.retain(exchange.response, decode(), 0);
								exchange.state = "completed";
								reader.releaseLock();
								controller.close();
							} else {
								this.retain(
									exchange.response,
									decode(part.value),
									part.value.byteLength,
								);
								controller.enqueue(part.value);
							}
						} catch (error) {
							exchange.state = "failed";
							exchange.response.complete = false;
							exchange.error =
								error instanceof Error
									? error.message
									: "Provider stream failed";
							reader.releaseLock();
							controller.error(error);
						}
					},
					cancel: async (reason) => {
						exchange.state = "interrupted";
						exchange.response.complete = false;
						try {
							await reader.cancel(reason);
						} finally {
							reader.releaseLock();
						}
					},
				});
				return new Response(body, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			} catch (error) {
				exchange.state = "failed";
				exchange.response.complete = false;
				exchange.error =
					error instanceof Error ? error.message : "Provider request failed";
				throw error;
			}
		};
	}
}
