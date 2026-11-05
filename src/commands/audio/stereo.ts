import { Flags } from "@oclif/core";
import type { Side, StereoSource } from "../../topics/audio/audio.js";
import type { Job, Skip } from "../../topics/audio/command.js";
import type { StreamInfo } from "../../topics/audio/ffmpeg.js";
import { Audio } from "../../topics/audio/audio.js";
import {
    AUDIO_FLAGS,
    AUDIO_HELP,
    AudioCommand,
} from "../../topics/audio/command.js";

export default class AudioStereo extends AudioCommand {
    static override description = `Make mono audio stereo, by copying it onto both sides.

song.wav becomes song-stereo.wav, in the same format and at the same quality. Each side is the source exactly, so it's no quieter than the original.

A file that's stereo but has sound on only one side, like a mono mic recorded on a stereo track, plays in one ear. These are found by comparing the sides' levels: when one is more than ${Audio.ONE_SIDED_DB} dB quieter than the other, the louder side is copied onto both. A stereo file with sound on both sides is skipped, unless --channel picks a side to copy.

${AUDIO_HELP}`;

    static override examples = [
        "<%= config.bin %> <%= command.id %> vocals.wav",
        {
            command:
                "<%= config.bin %> <%= command.id %> take.wav --channel left",
            description:
                "Copy the left side onto both, whatever's on the right",
        },
    ];

    static override flags = {
        ...AUDIO_FLAGS,
        channel: Flags.option({
            char: "c",
            description:
                "Side of a stereo file to copy onto both, rather than the one with sound on it",
            options: Audio.SIDES,
        })(),
    };

    // Takes any number of files.
    static override strict = false;

    static override usage = "<%= command.id %> FILE... [-c left|right] [-y]";

    #picked: Side | undefined;

    protected async plan(file: string, probe: StreamInfo): Promise<Job | Skip> {
        if (probe.channels !== 1 && probe.channels !== 2) {
            return {
                reason: `it has ${probe.channels} channels; only mono and stereo files can be made stereo`,
                status: "skipped",
            };
        }
        const source = await Audio.stereoSourceOf(
            file,
            { ...probe, channels: probe.channels },
            this.#picked
        );
        if (source.kind === "stereo") {
            return {
                reason: `it's already stereo, with its sides ${source.imbalance.toFixed(1)} dB apart; pick a side to copy with --channel`,
                status: "skipped",
            };
        }
        const output = Audio.outputPath(file, { suffix: "-stereo" });
        const channel =
            source.kind === "mono" ? 0 : Audio.SIDES.indexOf(source.live);
        return {
            args: Audio.stereoArgs(file, probe, channel, output),
            note: describe(source),
            outputs: [output],
        };
    }

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(AudioStereo);
        this.#picked = flags.channel;
        await this.process(argv, flags.yes);
    }
}

function describe(source: Exclude<StereoSource, { kind: "stereo" }>): string {
    switch (source.kind) {
        case "mono": {
            return "mono, copied onto both sides";
        }

        case "one-sided": {
            const silent = source.live === "left" ? "right" : "left";
            return `${silent} side was ${Math.round(source.imbalance)} dB quieter, so copied the ${source.live} onto both`;
        }

        case "picked": {
            return `copied the ${source.live} onto both`;
        }
    }
}
