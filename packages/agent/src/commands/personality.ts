import {
  findPackagedPersonality,
  formatPersonalityList,
  unknownPersonalityMessage,
} from "../personality-spec.js";

type CliOutput = NodeJS.WritableStream & { isTTY?: boolean };

export interface PersonalityListCommandOptions {
  stdout?: CliOutput;
}

export function personalityListCommand(
  options: PersonalityListCommandOptions = {},
): void {
  const stdout = options.stdout ?? process.stdout;
  stdout.write(formatPersonalityList());
}

export interface PersonalityShowCommandOptions {
  name: string;
  stdout?: CliOutput;
}

export function personalityShowCommand(
  options: PersonalityShowCommandOptions,
): void {
  const stdout = options.stdout ?? process.stdout;
  const preset = findPackagedPersonality(options.name);
  if (!preset) {
    throw new Error(unknownPersonalityMessage(options.name));
  }
  stdout.write(`${preset.id}\n${preset.body}\n`);
}
