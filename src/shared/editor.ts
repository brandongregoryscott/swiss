import { Browser } from "./browser.js";

class Editor {
    // Opens a file in VS Code, at line when there is one, or a directory as a VS Code window.
    static open(file: string, line?: number): Promise<void> {
        return Browser.open(
            `vscode://file${encodeURI(file)}${line == null ? "" : `:${line}`}`
        );
    }
}

export { Editor };
