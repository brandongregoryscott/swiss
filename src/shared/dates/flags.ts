import { Flags } from "@oclif/core";
import { Dates } from "./dates.js";

// Flags shared by the date commands.
const DATE_FLAGS = {
    tz: Flags.string({
        description:
            "IANA time zone to show local times in and read inputs without an offset in, like Europe/London or UTC [default: the system zone]",
    }),
    unit: Flags.option({
        description:
            "Unit of an epoch number, instead of guessing from its digit count (up to 11 is s, 12-14 ms, 15-17 us, 18-19 ns)",
        options: Dates.EPOCH_UNITS,
    })(),
};

export { DATE_FLAGS };
