import { defineConfig } from "eslint/config";
import tsEslint from "typescript-eslint";
import collationPlugin from "eslint-plugin-collation";
import importPlugin from "eslint-plugin-import";
import stylisticPlugin from "@stylistic/eslint-plugin";
import perfectionistPlugin from "eslint-plugin-perfectionist";
import { readdirSync } from "node:fs";
import path from "node:path";

// Topics a command topic may use besides its own, for commands that sit outside the topic whose
// code they drive.
const EXTRA_TOPICS = {
    autocomplete: ["zsh"],
};

function directories(dir) {
    return readdirSync(path.join(import.meta.dirname, dir), {
        withFileTypes: true,
    })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
}

// src/topics/<topic> holds code for the commands in src/commands/<topic> only, and src/shared holds
// code used by more than one topic. So shared code can't use a topic's, a topic can't use another
// topic's, and commands can only use their own topic's. Code a second topic needs moves to shared.
function importZones() {
    const topics = directories("src/topics");
    return [
        {
            from: ["./src/commands", "./src/topics"],
            message:
                "Shared code can't depend on commands or topics; move what it needs into src/shared",
            target: "./src/shared",
        },
        {
            from: "./src/commands",
            message: "Topics can't depend on commands",
            target: "./src/topics",
        },
        ...topics.map((topic) => ({
            except: [`./${topic}`],
            from: "./src/topics",
            message: `src/topics/${topic} can only use its own topic; move code more than one topic needs into src/shared`,
            target: `./src/topics/${topic}`,
        })),
        ...directories("src/commands").map((command) => ({
            except: [command, ...(EXTRA_TOPICS[command] ?? [])]
                .filter((topic) => topics.includes(topic))
                .map((topic) => `./${topic}`),
            from: "./src/topics",
            message: `Commands in src/commands/${command} can only use src/topics/${command}; move code more than one topic needs into src/shared`,
            target: `./src/commands/${command}`,
        })),
    ];
}

// Mirrors ~/noisehaus/packages/eslint-config-custom, minus the React rules.
const config = defineConfig([
    { files: ["**/*.ts"] },
    {
        rules: {
            curly: ["error", "all"],
            eqeqeq: [
                "error",
                "always",
                {
                    null: "ignore",
                },
            ],
            "no-console": "error",
            "no-useless-rename": "error",
            "no-var": "error",
        },
    },
    {
        plugins: {
            "@typescript-eslint": tsEslint.plugin,
        },
        languageOptions: {
            parser: tsEslint.parser,
            parserOptions: {
                project: ["tsconfig.json"],
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-definitions": ["error", "type"],
            "@typescript-eslint/consistent-type-exports": "error",
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/explicit-member-accessibility": [
                "error",
                {
                    accessibility: "no-public",
                },
            ],
            "@typescript-eslint/strict-boolean-expressions": [
                "error",
                {
                    allowNullableObject: false,
                    allowNumber: false,
                    allowString: false,
                },
            ],
        },
    },
    {
        plugins: {
            collation: collationPlugin,
        },
        rules: {
            "collation/group-exports": "error",
            "collation/no-default-export": "error",
            "collation/no-inline-export": "error",
            "collation/no-inline-object-type": "error",
            "collation/prefer-native-private-syntax": "error",
            "collation/sort-dependency-list": "error",
            "collation/sort-exports": "error",
        },
    },
    {
        // oclif only discovers commands that are default exports.
        files: ["src/commands/**/*.ts"],
        rules: {
            "collation/no-default-export": "off",
        },
    },
    {
        // So every command prints user errors as messages, which SwissCommand does, and talks to
        // the terminal through it.
        files: ["src/commands/**/*.ts", "src/topics/**/*.ts"],
        ignores: ["src/topics/table/prompt.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            importNames: ["Command"],
                            message:
                                "Extend SwissCommand from src/shared/command.ts instead",
                            name: "@oclif/core",
                        },
                        {
                            message:
                                "Use this.terminal, so prompts draw on stderr and Escape is handled the same way everywhere",
                            name: "@clack/prompts",
                        },
                    ],
                },
            ],
        },
    },
    {
        // Flags and base commands live in flags.ts and command.ts files, so the rest of shared and
        // topics code doesn't depend on oclif. This replaces the rule above for these files, and
        // also covers Command.
        files: ["src/shared/**/*.ts", "src/topics/**/*.ts"],
        ignores: ["**/command.ts", "**/flags.ts", "**/*.test.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            message:
                                "Keep oclif in src/commands, or in a topic's flags.ts or command.ts",
                            name: "@oclif/core",
                        },
                    ],
                },
            ],
        },
    },
    {
        plugins: {
            "@stylistic": stylisticPlugin,
        },
        rules: {
            "@stylistic/padding-line-between-statements": [
                "error",
                {
                    blankLine: "always",
                    next: "export",
                    prev: "*",
                },
                {
                    blankLine: "never",
                    next: "export",
                    prev: "export",
                },
                {
                    blankLine: "always",
                    next: "*",
                    prev: "import",
                },
                {
                    blankLine: "never",
                    next: "import",
                    prev: "import",
                },
            ],
        },
    },
    {
        plugins: {
            perfectionist: perfectionistPlugin,
        },
        rules: {
            "perfectionist/sort-classes": [
                "error",
                {
                    fallbackSort: { type: "unsorted" },
                    groups: [
                        "readonly-property",
                        "property",
                        "private-property",
                        "constructor",
                        "abstract-method",
                        "static-method",
                        ["get-method", "set-method"],
                        "method",
                        "private-static-method",
                        "private-method",
                    ],
                    ignoreCase: true,
                    newlinesBetween: "ignore",
                    newlinesInside: "ignore",
                    order: "asc",
                    partitionByComment: false,
                    partitionByNewLine: false,
                    specialCharacters: "keep",
                    type: "alphabetical",
                },
            ],
            "perfectionist/sort-exports": "error",
            "perfectionist/sort-imports": ["error", { newlinesBetween: 0 }],
            "perfectionist/sort-interfaces": "error",
            "perfectionist/sort-intersection-types": "error",
            "perfectionist/sort-object-types": "error",
            "perfectionist/sort-objects": "error",
            "perfectionist/sort-switch-case": "error",
            "perfectionist/sort-union-types": "error",
        },
    },
    {
        plugins: {
            import: importPlugin,
        },
        rules: {
            "import/consistent-type-specifier-style": [
                "error",
                "prefer-top-level",
            ],
            "import/no-duplicates": "error",
            "import/no-restricted-paths": [
                "error",
                { basePath: import.meta.dirname, zones: importZones() },
            ],
        },
        // So imports of ./foo.js resolve to foo.ts; no-restricted-paths skips ones that don't
        // resolve.
        settings: {
            "import/resolver": {
                typescript: { project: "tsconfig.json" },
            },
        },
    },
    {
        ignores: ["bin", "dist", "eslint.config.mjs"],
    },
]);

export default config;
