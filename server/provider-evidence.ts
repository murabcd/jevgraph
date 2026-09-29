import { AsyncLocalStorage } from "node:async_hooks";
import {
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

	redact(text: string) {
		for (const credential of this.credentials)
			text = text.replaceAll(credential, "*");
		return text;
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

	private retain(body: ProviderExchange["request"], text: string) {
		body.bytes += new TextEncoder().encode(text).length;
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
				this.retain(exchange.request, await request.clone().text());
				const response = await transport(input, init);
				exchange.httpStatus = response.status;
				if (!response.body) {
					exchange.state = "completed";
					return response;
				}
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				const body = new ReadableStream<Uint8Array>({
					pull: async (controller) => {
						try {
							const part = await reader.read();
							if (part.done) {
								this.retain(exchange.response, decoder.decode());
								exchange.state = "completed";
								reader.releaseLock();
								controller.close();
							} else {
								this.retain(
									exchange.response,
									decoder.decode(part.value, { stream: true }),
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
