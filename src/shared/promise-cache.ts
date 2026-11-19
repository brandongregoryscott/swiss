class PromiseCache<T> {
    readonly #promises = new Map<string, Promise<T>>();

    get(key: string, load: () => Promise<T>): Promise<T> {
        let promise = this.#promises.get(key);
        if (promise == null) {
            promise = load();
            this.#promises.set(key, promise);
            promise.catch(() => this.#promises.delete(key));
        }
        return promise;
    }

    has(key: string): boolean {
        return this.#promises.has(key);
    }
}

export { PromiseCache };
