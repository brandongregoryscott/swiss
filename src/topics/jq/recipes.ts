import { compact, countBy, isEmpty, last } from "lodash-es";
import { UserError } from "../../shared/errors.js";
import { JsonPaths } from "./json-paths.js";

class JqRecipeError extends UserError {}

type CsvOptions = {
    // Start with a row of the field names.
    header?: boolean;
    // Separate values with tabs (@tsv) instead of commas (@csv).
    tsv?: boolean;
};

// Builds the jq filters for the recipe commands. Each takes the path to an array, like .orders or
// . for the whole input, and fields of its elements: dotted names like customer.name, or jq paths
// starting with a dot, like .items[0].sku, which are used as they are.
class JqRecipes {
    static countBy(array: string, field: string): string {
        const key = keyFor(field);
        return pipe(
            array,
            `group_by(${path(field)}) | map({${key}: .[0]${path(field)}, count: length}) | sort_by(-.count)`
        );
    }

    static csv(
        array: string,
        fields: string[],
        options: CsvOptions = {}
    ): string {
        const format = options.tsv === true ? "@tsv" : "@csv";
        const row = `${elements(array)} | [${fields.map(path).join(", ")}] | ${format}`;
        if (options.header !== true) {
            return row;
        }
        const names = JSON.stringify(fields.map(displayName));
        return `(${names} | ${format}), (${row})`;
    }

    // Splits a comma-separated list of fields.
    static parseFields(input: string): string[] {
        const fields = compact(input.split(",").map((field) => field.trim()));
        if (isEmpty(fields)) {
            throw new JqRecipeError(
                "Give at least one field, like name or customer.email"
            );
        }
        return fields;
    }

    static pluck(array: string, fields: string[]): string {
        if (fields.length === 1) {
            return pipe(array, `map(${path(fields[0]!)})`);
        }
        // Fields that would get the same key, like a.name and b.name, are keyed by their whole path.
        const keys = fields.map(keyFor);
        const counts = countBy(keys);
        const entries = fields.map((field, index) => {
            const key =
                counts[keys[index]!]! > 1
                    ? JsonPaths.segment(displayName(field))
                    : keys[index]!;
            return `${key}: ${path(field)}`;
        });
        return pipe(array, `map({${entries.join(", ")}})`);
    }

    static sort(array: string, field: string, descending = false): string {
        return pipe(
            array,
            `sort_by(${path(field)})${descending ? " | reverse" : ""}`
        );
    }

    static sum(array: string, field: string): string {
        return pipe(array, `map(${path(field)}) | add`);
    }

    static uniq(array: string, field: string): string {
        return pipe(array, `map(${path(field)}) | unique`);
    }

    static where(array: string, condition: string): string {
        return pipe(array, `map(select(${condition}))`);
    }
}

// The array's path, with a dot added if it was left off.
function arrayPath(array: string): string {
    const trimmed = array.trim();
    return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

// Runs filter on the array, leaving out the array's path when it's the whole input.
function pipe(array: string, filter: string): string {
    const source = arrayPath(array);
    return source === "." ? filter : `${source} | ${filter}`;
}

function elements(array: string): string {
    const source = arrayPath(array);
    return source === "." ? ".[]" : `${source}[]`;
}

// A field's jq path, relative to an element.
function path(field: string): string {
    if (field.startsWith(".")) {
        return field;
    }
    return field
        .split(".")
        .map((segment) => `.${JsonPaths.segment(segment)}`)
        .join("");
}

// The field without its leading dot, for column headers and keys.
function displayName(field: string): string {
    return field.replace(/^\./, "");
}

// The object key a field's value goes under: its last name, like email for customer.email, or the
// last name in a jq path.
function keyFor(field: string): string {
    if (!field.startsWith(".")) {
        return JsonPaths.segment(last(field.split("."))!);
    }
    const names = field.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    return last(names) ?? "value";
}

export type { CsvOptions };
export { JqRecipeError, JqRecipes };
