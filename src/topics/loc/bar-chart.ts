// Partial blocks, in eighths of a character, for the end of a bar.
const PARTIAL_BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const FULL_BLOCK = "█";

class BarChart {
    // A horizontal bar for value, scaled so max fills width characters.
    static bar(value: number, max: number, width: number): string {
        if (max <= 0 || value <= 0 || width <= 0) {
            return "";
        }
        const eighths = Math.round((Math.min(value, max) / max) * width * 8);
        return (
            FULL_BLOCK.repeat(Math.floor(eighths / 8)) +
            PARTIAL_BLOCKS[eighths % 8]
        );
    }
}

export { BarChart };
