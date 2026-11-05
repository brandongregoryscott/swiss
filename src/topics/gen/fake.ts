import { faker } from "@faker-js/faker";
import { functions, isEmpty, isObjectLike, isString, sortBy } from "lodash-es";
import { UserError } from "../../shared/errors.js";

type FakeModule = {
    methods: string[];
    name: string;
};

type Method = (...args: unknown[]) => unknown;

// Internals rather than modules of fake data.
const IGNORED_MODULES = new Set(["fakerCore"]);

class FakeError extends UserError {}

class Fake {
    // Calls a faker method by its path, like person.fullName, and formats what it returns as
    // text. Each argument is parsed as JSON when it can be, like 10 or {"min":1}, and passed as a
    // string otherwise.
    static call(path: string, args: string[] = []): string {
        const [moduleName, methodName, ...rest] = path.split(".");
        const module = Fake.modules().find(({ name }) => name === moduleName);
        if (module == null) {
            throw new FakeError(
                `faker has no ${moduleName} module; it has ${Fake.modules()
                    .map(({ name }) => name)
                    .join(", ")}`
            );
        }
        if (methodName == null || !isEmpty(rest)) {
            throw new FakeError(
                `Name a method of ${moduleName}, like ${moduleName}.${module.methods[0]}`
            );
        }
        if (!module.methods.includes(methodName)) {
            throw new FakeError(
                `faker's ${moduleName} module has no ${methodName} method; it has ${module.methods.join(", ")}`
            );
        }

        const method = (
            faker as unknown as Record<string, Record<string, Method>>
        )[moduleName!]![methodName]!;
        let value: unknown;
        try {
            value = method(...args.map(parseArg));
        } catch (error) {
            if (error instanceof Error) {
                throw new FakeError(`${path} failed: ${error.message}`);
            }
            throw error;
        }
        return format(value);
    }

    // faker's modules and their methods, in alphabetical order.
    static modules(): FakeModule[] {
        return Object.entries(faker as unknown as Record<string, unknown>)
            .filter(
                ([name, module]) =>
                    !IGNORED_MODULES.has(name) && isObjectLike(module)
            )
            .map(([name, module]) => ({
                methods: sortBy(functions(module)),
                name,
            }))
            .filter(({ methods }) => !isEmpty(methods))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
}

function format(value: unknown): string {
    if (isString(value)) {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object" && value != null) {
        return JSON.stringify(value);
    }
    return String(value);
}

function parseArg(arg: string): unknown {
    try {
        return JSON.parse(arg);
    } catch {
        return arg;
    }
}

export type { FakeModule };
export { Fake, FakeError };
