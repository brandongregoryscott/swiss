import type { Job, Skip } from "../../topics/audio/command.js";
import type { StreamInfo } from "../../topics/audio/ffmpeg.js";
import { Audio } from "../../topics/audio/audio.js";
import {
    AUDIO_FLAGS,
    AUDIO_HELP,
    AudioCommand,
} from "../../topics/audio/command.js";

export default class AudioWav extends AudioCommand {
    static override description = `Convert audio files, like MP3s, to WAV.

song.mp3 becomes song.wav. Lossy files like MP3s become 16-bit WAVs, and lossless ones, like FLAC and AIFF, keep their bit depth: 24-bit when they're that or more. Files that are already WAVs are skipped.

${AUDIO_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> song.mp3",
        "<%= config.bin %> <%= command.id %> *.mp3",
    ];

    static override flags = AUDIO_FLAGS;

    // Takes any number of files.
    static override strict = false;

    static override usage = "<%= command.id %> FILE... [-y]";

    protected async plan(file: string, probe: StreamInfo): Promise<Job | Skip> {
        const output = Audio.outputPath(file, { extension: ".wav" });
        if (output === file) {
            return { reason: "it's already a WAV", status: "skipped" };
        }
        return {
            args: Audio.convertArgs(file, probe, output),
            outputs: [output],
        };
    }

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(AudioWav);
        await this.process(argv, flags.yes);
    }
}
