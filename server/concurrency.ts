export async function mapConcurrent<TInput, TResult>(
	items: TInput[],
	limit: number,
	run: (item: TInput) => Promise<TResult>,
): Promise<TResult[]> {
	const values = new Array<TResult>(items.length);
	let nextIndex = 0;
	let failed = false;
	let failure: unknown;
	const worker = async (): Promise<void> => {
		while (nextIndex < items.length && !failed) {
			const index = nextIndex++;
			try {
				values[index] = await run(items[index]);
			} catch (error) {
				failed = true;
				failure = error;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	if (failed) throw failure;
	return values;
}
