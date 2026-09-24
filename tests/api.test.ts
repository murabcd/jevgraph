import { describe, expect, test } from "bun:test";
import { handleApi } from "../server/api";
import { defaultConfig, type RouteStreamEvent } from "../src/lib/routing";

describe("route API", () => {
	test("sends a direct route without requiring Jev", async () => {
		const response = await handleApi(
			new Request("http://localhost/api/route", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: [{ role: "user", content: "Hello" }],
					requestPrompt: "",
					config: defaultConfig,
					routes: {
						kind: "direct",
						target: {
							nodeId: "selected-model",
							provider: "openai",
							model: "gpt-4.1",
						},
					},
				}),
			}),
			{},
		);
		const events = (await response.text())
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as RouteStreamEvent);
		expect(response.status).toBe(200);
		expect(events[0]).toMatchObject({
			type: "route",
			route: {
				mode: "direct",
				model: "gpt-4.1",
				nodeId: "selected-model",
				branch: "direct",
			},
		});
		expect(events[1]).toMatchObject({
			type: "error",
			error: "OPENAI_API_KEY is not configured",
		});
	});
});
