import { Flags } from "@oclif/core";
import type { NormalizeTarget } from "../../topics/audio/audio.js";
import type { Job, Skip } from "../../topics/audio/command.js";
import type { StreamInfo } from "../../topics/audio/ffmpeg.js";
import { Audio } from "../../topics/audio/audio.js";
import {
    AUDIO_FLAGS,
    AUDIO_HELP,
    AudioCommand,
} from "../../topics/audio/command.js";
import { Ffmpeg } from "../../topics/audio/ffmpeg.js";

const DEFAULT_TARGET = -14;
const DEFAULT_CEILING = -1;

// A level in dB, which is always 0 or below, so 14 means -14. That saves quoting a negative
// number after a flag.
const level = Flags.custom<number>({
    parse: async (input) => {
        const value = Number(input);
        if (input.trim() === "" || !Number.isFinite(value)) {
            throw new Error(
                `Expected a level in dB, like -14, but got ${input}`
            );
        }
        return -Math.abs(value);
    },
});

export default class AudioNormalize extends AudioCommand {
    static override description = `Make audio files a consistent loudness.

song.wav becomes song-normalized.wav, in the same format and at the same quality. By default each file is brought to ${DEFAULT_TARGET} LUFS, the loudness streaming services play music at, measured the way they do (EBU R128). Pick another target with --target, like -16 for podcasts or -23 for broadcast. --peak instead turns each file up or down until its loudest peak is at the ceiling, which suits samples and sound effects, where loudness over the whole file means less.

Each file only has its volume changed, by the same amount throughout, so nothing is compressed or limited. Its loudest true peak is kept at or below the ceiling, ${DEFAULT_CEILING} dBTP unless you pick one, which leaves room for MP3 encoding not to clip. A quiet file with loud peaks may stop short of the target because of that, and you're told how loud it got. Files already within 0.1 dB are skipped.

Levels are always 0 or below, so the minus sign is optional: --target 16 is -16 LUFS.

${AUDIO_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> song.wav",
        {
            command: "<%= config.bin %> <%= command.id %> *.mp3 --target -16",
            description: "Bring every MP3 here to -16 LUFS",
        },
        {
            command:
                "<%= config.bin %> <%= command.id %> kick.wav snare.wav --peak",
            description: "Turn samples up until their peaks are at -1 dBTP",
        },
    ];

    static override flags = {
        ...AUDIO_FLAGS,
        ceiling: level({
            char: "c",
            default: DEFAULT_CEILING,
            description:
                "Highest true peak to allow, in dBTP, and the level --peak brings peaks to",
        }),
        peak: Flags.boolean({
            char: "p",
            description:
                "Bring each file's loudest peak to the ceiling, instead of its loudness to the target",
            exclusive: ["target"],
        }),
        target: level({
            char: "t",
            default: DEFAULT_TARGET,
            description: "Loudness to bring each file to, in LUFS",
        }),
    };

    // Takes any number of files.
    static override strict = false;

    static override usage =
        "<%= command.id %> FILE... [-t LUFS | -p] [-c DBTP] [-y]";

    #target: NormalizeTarget | undefined;

    protected async plan(file: string, probe: StreamInfo): Promise<Job | Skip> {
        const target = this.#target!;
        const normalization = Audio.normalization(
            await Ffmpeg.loudness(file),
            target
        );
        if (normalization.status === "skipped") {
            return normalization;
        }
        const { gain, reached } = normalization;
        const output = Audio.outputPath(file, { suffix: "-normalized" });
        const short =
            reached == null
                ? ""
                : `, reaching ${Audio.formatDb(reached)} LUFS rather than ${Audio.formatDb(target.target)} to keep its peak at ${Audio.formatDb(target.ceiling)} dBTP`;
        return {
            args: Audio.gainArgs(file, probe, gain, output),
            note: `${Audio.formatDb(gain, true)} dB${short}`,
            outputs: [output],
        };
    }

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(AudioNormalize);
        this.#target = {
            ceiling: flags.ceiling,
            mode: flags.peak ? "peak" : "loudness",
            target: flags.target,
        };
        await this.process(argv, flags.yes);
    }
}
