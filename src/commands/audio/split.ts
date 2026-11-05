import type { Job, Skip } from "../../topics/audio/command.js";
import type { StreamInfo } from "../../topics/audio/ffmpeg.js";
import { Audio } from "../../topics/audio/audio.js";
import {
    AUDIO_FLAGS,
    AUDIO_HELP,
    AudioCommand,
} from "../../topics/audio/command.js";

export default class AudioSplit extends AudioCommand {
    static override description = `Split stereo audio files into a mono file for each side.

song.wav becomes song-left.wav and song-right.wav, in the same format and at the same quality: WAV and AIFF keep their bit depth, and MP3s are re-encoded at LAME's best VBR setting. Files that aren't stereo are skipped.

${AUDIO_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> song.wav",
        {
            command: "<%= config.bin %> <%= command.id %> *.mp3 --yes",
            description: "Split every MP3 here, replacing earlier splits",
        },
    ];

    static override flags = AUDIO_FLAGS;

    // Takes any number of files.
    static override strict = false;

    static override usage = "<%= command.id %> FILE... [-y]";

    protected async plan(file: string, probe: StreamInfo): Promise<Job | Skip> {
        if (probe.channels !== 2) {
            return {
                reason: `it has ${channels(probe.channels)}, not 2`,
                status: "skipped",
            };
        }
        const outputs: [string, string] = [
            Audio.outputPath(file, { suffix: "-left" }),
            Audio.outputPath(file, { suffix: "-right" }),
        ];
        return { args: Audio.splitArgs(file, probe, outputs), outputs };
    }

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(AudioSplit);
        await this.process(argv, flags.yes);
    }
}

function channels(count: number): string {
    return count === 1 ? "1 channel" : `${count} channels`;
}
