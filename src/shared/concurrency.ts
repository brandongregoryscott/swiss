class Concurrency {
    // Runs worker over items, at most limit at a time, and calls report with each result in the
    // items' order as soon as it and the ones before it are done, so output streams in order.
    // Returns the results. A worker that throws stops the reporting there and passes the error
    // on, so a bug still reaches the command.
    static async inOrder<T, R>(
        items: T[],
        limit: number,
        worker: (item: T) => Promise<R>,
        report: (result: R, item: T, index: number) => void
    ): Promise<R[]> {
        const pending = Concurrency.map(items, limit, worker);
        const results: R[] = [];
        for (const [index, item] of items.entries()) {
            const result = await pending[index]!;
            results.push(result);
            report(result, item, index);
        }
        return results;
    }

    // Runs worker over items, at most limit at a time. A failure still rejects its promise when
    // it's awaited, but doesn't count as unhandled while earlier ones are awaited first.
    static map<T, R>(
        items: T[],
        limit: number,
        worker: (item: T) => Promise<R>
    ): Promise<R>[] {
        let active = 0;
        const waiting: Array<() => void> = [];

        const acquire = async (): Promise<void> => {
            if (active < limit) {
                active++;
                return;
            }

            await new Promise<void>((resolve) => {
                waiting.push(resolve);
            });
        };

        const release = (): void => {
            const next = waiting.shift();
            if (next != null) {
                next();
            } else {
                active--;
            }
        };

        const promises = items.map(async (item) => {
            await acquire();
            try {
                return await worker(item);
            } finally {
                release();
            }
        });
        for (const promise of promises) {
            promise.catch(() => {});
        }
        return promises;
    }
}

export { Concurrency };
