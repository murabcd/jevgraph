import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { handleApi } from "./server/api.ts";

async function serveApi(
	req: IncomingMessage,
	res: ServerResponse,
	mode: string,
	next: () => void,
) {
	if (!req.url?.startsWith("/api/")) return next();
	try {
		const env = loadEnv(mode, process.cwd(), "");
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		for await (const chunk of req) {
			bytes += chunk.length;
			if (bytes > 65536) {
				res.statusCode = 413;
				res.end(JSON.stringify({ error: "Request is too large" }));
				return;
			}
			chunks.push(chunk);
		}
		const headers = new Headers();
		for (const [key, value] of Object.entries(req.headers)) {
			if (typeof value === "string") headers.set(key, value);
			else if (Array.isArray(value))
				value.forEach((item) => {
					headers.append(key, item);
				});
		}
		const request = new Request(`http://localhost${req.url}`, {
			method: req.method,
			headers,
			body: req.method === "GET" ? undefined : Buffer.concat(chunks),
		});
		const response = await handleApi(request, env);
		res.statusCode = response.status;
		response.headers.forEach((value, key) => {
			res.setHeader(key, value);
		});
		if (!response.body) {
			res.end();
			return;
		}
		res.flushHeaders();
		for await (const chunk of response.body) res.write(chunk);
		res.end();
	} catch {
		if (!res.headersSent) res.statusCode = 500;
		res.end(JSON.stringify({ error: "Local API request failed" }));
	}
}

function localApi(): Plugin {
	return {
		name: "router-local-api",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				void serveApi(req, res, server.config.mode, next);
			});
		},
		configurePreviewServer(server) {
			server.middlewares.use((req, res, next) => {
				void serveApi(req, res, server.config.mode, next);
			});
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), localApi()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
});
