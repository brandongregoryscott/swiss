import { isArray, isEqual, isPlainObject } from "lodash-es";
import { JsonPaths } from "./json-paths.js";

type JsonChange =
    | { from: unknown; kind: "changed"; path: string; to: unknown }
    | { kind: "added" | "removed"; path: string; value: unknown };

class JsonDiff {
    // The differences between two JSON values, as jq paths in the order they appear. Key order
    // doesn't matter, arrays are compared element by element by index, and a value whose type
    // changed is reported as changed rather than looked inside.
    static compare(left: unknown, right: unknown): JsonChange[] {
        const changes: JsonChange[] = [];
        compare(left, right, "", changes);
        return changes;
    }
}

function compare(
    left: unknown,
    right: unknown,
    path: string,
    changes: JsonChange[]
) {
    if (isArray(left) && isArray(right)) {
        for (
            let index = 0;
            index < Math.max(left.length, right.length);
            index++
        ) {
            const childPath = `${path === "" ? "." : path}[${index}]`;
            if (index >= right.length) {
                changes.push({
                    kind: "removed",
                    path: childPath,
                    value: left[index],
                });
            } else if (index >= left.length) {
                changes.push({
                    kind: "added",
                    path: childPath,
                    value: right[index],
                });
            } else {
                compare(left[index], right[index], childPath, changes);
            }
        }
    } else if (isObject(left) && isObject(right)) {
        for (const key of new Set([
            ...Object.keys(left),
            ...Object.keys(right),
        ])) {
            const childPath = `${path}.${JsonPaths.segment(key)}`;
            if (!Object.hasOwn(right, key)) {
                changes.push({
                    kind: "removed",
                    path: childPath,
                    value: left[key],
                });
            } else if (!Object.hasOwn(left, key)) {
                changes.push({
                    kind: "added",
                    path: childPath,
                    value: right[key],
                });
            } else {
                compare(left[key], right[key], childPath, changes);
            }
        }
    } else if (!isEqual(left, right)) {
        changes.push({
            from: left,
            kind: "changed",
            path: path === "" ? "." : path,
            to: right,
        });
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return isPlainObject(value);
}

export type { JsonChange };
export { JsonDiff };
