import { isArray, sortBy } from "lodash-es";
import { UserError } from "../../shared/errors.js";

class JsonPathsError extends UserError {}

type JsonType = "array" | "boolean" | "null" | "number" | "object" | "string";

type JsonPath = {
    // The first scalar seen at this path, as JSON, or null for arrays, objects and nulls.
    example: null | string;
    // A jq path, like .items[].name.
    path: string;
    types: JsonType[];
};

type PathInfo = { example: null | string; types: Set<JsonType> };

// Elements of each array to look at, so huge arrays don't take long to go through.
const MAX_ARRAY_ELEMENTS = 50;
const MAX_EXAMPLE_LENGTH = 40;

class JsonPaths {
    // Every path in JSON text, as jq paths in the order they're first seen. Arrays are merged, so
    // every element's keys show up under [], and newline-delimited JSON is read as a stream of
    // values at the root.
    static list(text: string): JsonPath[] {
        const paths = new Map<string, PathInfo>();
        for (const value of JsonPaths.parse(text)) {
            walk(value, "", paths);
        }
        return [...paths].map(([path, info]) => ({
            example: info.example,
            path: path === "" ? "." : path,
            types: sortBy([...info.types]),
        }));
    }

    // Parses JSON text, or newline-delimited JSON, into its values.
    static parse(text: string): unknown[] {
        try {
            return [JSON.parse(text)];
        } catch {
            // Fall through to newline-delimited JSON.
        }
        const lines = text.split("\n").filter((line) => line.trim() !== "");
        try {
            return lines.map((line) => JSON.parse(line) as unknown);
        } catch {
            throw new JsonPathsError(
                "The input isn't JSON or newline-delimited JSON"
            );
        }
    }

    // A path segment for key, quoted when it isn't an identifier, like name or "my-key".
    static segment(key: string): string {
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
    }
}

function walk(value: unknown, path: string, paths: Map<string, PathInfo>) {
    const type = typeOf(value);
    let info = paths.get(path);
    if (info == null) {
        info = { example: null, types: new Set() };
        paths.set(path, info);
    }
    info.types.add(type);

    if (isArray(value)) {
        const elementPath = path === "" ? ".[]" : `${path}[]`;
        for (const element of value.slice(0, MAX_ARRAY_ELEMENTS)) {
            walk(element, elementPath, paths);
        }
    } else if (type === "object") {
        for (const [key, child] of Object.entries(
            value as Record<string, unknown>
        )) {
            const segment = JsonPaths.segment(key);
            walk(
                child,
                path === "" ? `.${segment}` : `${path}.${segment}`,
                paths
            );
        }
    } else if (info.example == null && type !== "null") {
        const json = JSON.stringify(value);
        info.example =
            json.length > MAX_EXAMPLE_LENGTH
                ? `${json.slice(0, MAX_EXAMPLE_LENGTH - 1)}…`
                : json;
    }
}

function typeOf(value: unknown): JsonType {
    if (value === null) {
        return "null";
    }
    if (isArray(value)) {
        return "array";
    }
    return typeof value as JsonType;
}

export type { JsonPath, JsonType };
export { JsonPaths, JsonPathsError };
