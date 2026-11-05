// An error whose message is meant for the person running the command, like a bad argument or a
// missing tool, rather than a bug. Commands print its message instead of a stack trace.
class UserError extends Error {}

// Whether error is something outside swiss going wrong, like a command that failed or a file it
// couldn't read, rather than a bug in swiss. For code that reports failures per item, like per
// repo, and should still crash on a bug.
function isExternalFailure(error: unknown): error is Error {
    return (
        error instanceof UserError ||
        (error instanceof Error && "syscall" in error && "code" in error)
    );
}

// For .catch() on a file operation: null when the file doesn't exist, and the error otherwise, so
// something like a permission error isn't mistaken for a missing file.
function nullIfMissing(error: unknown): null {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
    }
    throw error;
}

// A step that failed for a reason outside swiss, recorded for its item, like one repo of many.
type Failure = {
    reason: string;
    status: "error";
};

// Runs work, turning an external failure into a Failure, so one item failing doesn't stop the
// rest. Bugs still throw.
async function settle<R>(work: () => Promise<R>): Promise<Failure | R> {
    try {
        return await work();
    } catch (error) {
        if (!isExternalFailure(error)) {
            throw error;
        }
        return { reason: error.message, status: "error" };
    }
}

export type { Failure };
export { isExternalFailure, nullIfMissing, settle, UserError };
