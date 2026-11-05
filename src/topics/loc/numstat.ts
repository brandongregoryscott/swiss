import { compact, sumBy } from "lodash-es";
import { Git } from "../../shared/git/git.js";

type NumstatCommit = {
    // Lines added and removed across the commit's text files; binary files aren't counted.
    added: number;
    // The fields of the commit's format, after its hash.
    fields: string[];
    files: NumstatFile[];
    removed: number;
    sha: string;
};

// A file the commit changed, with null counts when either side of the change is binary.
type NumstatFile = {
    added: null | number;
    // Relative to the root of the repo.
    path: string;
    removed: null | number;
};

// Separate commits, and the fields within one, since neither can appear in a name or a path.
const COMMIT_SEPARATOR = "\x1e";
const FIELD_SEPARATOR = "\x1f";

class Numstat {
    // Commits with their line changes, newest first unless args say otherwise. fields are git
    // log placeholders like %aN, and pathspecs limit the files whose changes are counted.
    static async log(
        dir: string,
        fields: string[],
        args: string[],
        pathspecs: string[]
    ): Promise<NumstatCommit[]> {
        const format = [`${COMMIT_SEPARATOR}%H`, ...fields].join(
            FIELD_SEPARATOR
        );
        const output = await Git.run(
            dir,
            "log",
            "--no-renames",
            "--numstat",
            "-z",
            `--format=${format}`,
            ...args,
            "--",
            ...pathspecs
        );
        return Numstat.parse(output);
    }

    static parse(output: string): NumstatCommit[] {
        return compact(output.split(COMMIT_SEPARATOR)).map((record) => {
            const [header = "", ...entries] = record.split("\0");
            const [sha = "", ...fields] = header.split(FIELD_SEPARATOR);
            const files: NumstatFile[] = [];
            for (const entry of entries) {
                // The first entry follows a newline. Binary files show - for both counts.
                const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(
                    entry.trimStart()
                );
                if (match == null) {
                    continue;
                }
                const [, addedText, removedText, file] = match;
                files.push({
                    added: addedText === "-" ? null : Number(addedText),
                    path: file!,
                    removed: removedText === "-" ? null : Number(removedText),
                });
            }
            return {
                added: sumBy(files, (file) => file.added ?? 0),
                fields,
                files,
                removed: sumBy(files, (file) => file.removed ?? 0),
                sha,
            };
        });
    }
}

export type { NumstatCommit, NumstatFile };
export { Numstat };
