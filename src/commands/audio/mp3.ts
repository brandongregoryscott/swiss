import { Flags } from "@oclif/core";
import type { Job, Skip } from "../../topics/audio/command.js";
import type { StreamInfo } from "../../topics/audio/ffmpeg.js";
import { Audio } from "../../topics/audio/audio.js";
import {
    AUDIO_FLAGS,
    AUDIO_HELP,
    AudioCommand,
} from "../../topics/audio/command.js";

export default class AudioMp3 extends AudioCommand {
    static override description = `Convert audio files, like WAVs, to MP3.

song.wav becomes song.mp3, at LAME's best variable bitrate setting (V0, around 245 kbps) unless you pick a bitrate. Files that are already MP3s are skipped.

${AUDIO_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> song.wav",
        {
            command: "<%= config.bin %> <%= command.id %> *.wav --bitrate 320k",
            description: "Convert every WAV here at a constant 320 kbps",
        },
    ];

    static override flags = {
        ...AUDIO_FLAGS,
        bitrate: Flags.string({
            char: "b",
            description: "Constant bitrate, like 320k, instead of V0 VBR",
            parse: async (input) => {
                if (!/^\d+k$/.test(input)) {
                    throw new Error(
                        `Expected a bitrate in kbps, like 320k, but got ${input}`
                    );
                }
                return input;
            },
        }),
    };

    // Takes any number of files.
    static override strict = false;

    static override usage = "<%= command.id %> FILE... [-b BITRATE] [-y]";

    #bitrate: string | undefined;

    protected async plan(file: string, probe: StreamInfo): Promise<Job | Skip> {
        const output = Audio.outputPath(file, { extension: ".mp3" });
        if (output === file) {
            return { reason: "it's already an MP3", status: "skipped" };
        }
        return {
            args: Audio.convertArgs(file, probe, output, this.#bitrate),
            outputs: [output],
        };
    }

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(AudioMp3);
        this.#bitrate = flags.bitrate;
        await this.process(argv, flags.yes);
    }
}
