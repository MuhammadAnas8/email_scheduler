import type { ScheduleBatchRequest } from "./types.ts";

export type ScheduleMode = "immediate" | "future";

export function localDateTimeToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
    throw new RangeError("Choose a valid local start date and time.");
  }

  const date = new Date(value);
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  const [hour, minute, secondText = "0"] = (timePart ?? "").split(":");
  const second = Number(secondText.split(".")[0]);
  if (!Number.isFinite(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== Number(hour)
    || date.getMinutes() !== Number(minute)
    || date.getSeconds() !== second) {
    throw new RangeError("Choose a valid local start date and time.");
  }

  return date.toISOString();
}

export function buildScheduleRequest(input: {
  mode: ScheduleMode;
  localStartsAt: string;
  intervalSeconds: number;
  now?: Date;
}): ScheduleBatchRequest {
  if (!Number.isInteger(input.intervalSeconds) || input.intervalSeconds < 5 || input.intervalSeconds > 10) {
    throw new RangeError("Choose an interval from 5 to 10 seconds.");
  }

  if (input.mode === "immediate") {
    return { startsAt: null, intervalSeconds: input.intervalSeconds };
  }

  const startsAt = localDateTimeToIso(input.localStartsAt);
  if (Date.parse(startsAt) <= (input.now ?? new Date()).getTime()) {
    throw new RangeError("Choose a start time in the future.");
  }
  return { startsAt, intervalSeconds: input.intervalSeconds };
}

export function canConfirmSchedule(input: {
  rowsValid: boolean;
  draftId: string;
  attachmentPending: boolean;
  busy: boolean;
}): boolean {
  return input.rowsValid && input.draftId.trim().length > 0 && !input.attachmentPending && !input.busy;
}
