import { ConvexPersistence } from "../server/convex-persistence";
import { createConvexFixture } from "./convex-fixture";

const TEST_TOKEN = "test-owner-token";

export async function createApiFixture(
	database?: Parameters<typeof createConvexFixture>[0],
) {
	const fixture = await createConvexFixture(database);
	const persistence = new ConvexPersistence(fixture.owner);
	return {
		...fixture,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${TEST_TOKEN}`,
		},
		requestFields: () => ({
			conversationId: fixture.workspace.conversationId,
			requestId: crypto.randomUUID(),
		}),
		connect: (token: string) => {
			if (token !== TEST_TOKEN) throw new Error("Invalid test session");
			return persistence;
		},
	};
}
