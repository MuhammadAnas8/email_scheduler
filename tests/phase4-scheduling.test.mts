import assert from "node:assert/strict";
import { test } from "node:test";
import { batchActionSchema, resourceIdSchema, scheduleBatchRequestSchema } from "../lib/schemas.ts";
import { buildScheduleRequest, canConfirmSchedule, localDateTimeToIso } from "../lib/scheduling.ts";

test("converts a local datetime-local value to an explicit UTC ISO timestamp", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "Asia/Karachi";
  try {
    assert.equal(localDateTimeToIso("2026-01-02T12:30"), "2026-01-02T07:30:00.000Z");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("immediate mode is explicit and submits a null start", () => {
  assert.deepEqual(buildScheduleRequest({ mode: "immediate", localStartsAt: "", intervalSeconds: 5 }), {
    startsAt: null,
    intervalSeconds: 5,
  });
});

test("future mode requires a valid future local time and a five-to-ten second interval", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "Asia/Karachi";
  try {
    const now = new Date("2026-01-01T00:00:00.000Z");
    assert.deepEqual(buildScheduleRequest({ mode: "future", localStartsAt: "2026-01-02T00:00", intervalSeconds: 10, now }), {
      startsAt: "2026-01-01T19:00:00.000Z",
      intervalSeconds: 10,
    });
    assert.throws(() => buildScheduleRequest({ mode: "future", localStartsAt: "2025-12-31T23:00", intervalSeconds: 5, now }));
    assert.throws(() => buildScheduleRequest({ mode: "future", localStartsAt: "not-a-date", intervalSeconds: 5, now }));
    assert.throws(() => buildScheduleRequest({ mode: "immediate", localStartsAt: "", intervalSeconds: 4, now }));
    assert.throws(() => buildScheduleRequest({ mode: "immediate", localStartsAt: "", intervalSeconds: 11, now }));
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("confirmation requires valid rows, a saved draft, and no pending attachment upload", () => {
  assert.equal(canConfirmSchedule({ rowsValid: true, draftId: "batch-id", attachmentPending: false, busy: false }), true);
  assert.equal(canConfirmSchedule({ rowsValid: false, draftId: "batch-id", attachmentPending: false, busy: false }), false);
  assert.equal(canConfirmSchedule({ rowsValid: true, draftId: "", attachmentPending: false, busy: false }), false);
  assert.equal(canConfirmSchedule({ rowsValid: true, draftId: "batch-id", attachmentPending: true, busy: false }), false);
  assert.equal(canConfirmSchedule({ rowsValid: true, draftId: "batch-id", attachmentPending: false, busy: true }), false);
});

test("schedule and action schemas reject malformed inputs and require explicit immediate mode", () => {
  assert.equal(scheduleBatchRequestSchema.safeParse({ startsAt: null, intervalSeconds: 5 }).success, true);
  assert.equal(scheduleBatchRequestSchema.safeParse({ startsAt: "2026-01-02T12:30", intervalSeconds: 5 }).success, false);
  assert.equal(scheduleBatchRequestSchema.safeParse({ startsAt: "bad", intervalSeconds: 5 }).success, false);
  assert.equal(scheduleBatchRequestSchema.safeParse({ startsAt: null, intervalSeconds: 4 }).success, false);
  assert.equal(scheduleBatchRequestSchema.safeParse({ startsAt: null, intervalSeconds: 5.5 }).success, false);
  assert.equal(scheduleBatchRequestSchema.safeParse({ startsAt: null, intervalSeconds: 11 }).success, false);
  assert.equal(scheduleBatchRequestSchema.safeParse({ intervalSeconds: 5 }).success, false);
  assert.equal(batchActionSchema.safeParse({ action: "pause" }).success, true);
  assert.equal(batchActionSchema.safeParse({ action: "send" }).success, false);
  assert.equal(resourceIdSchema.safeParse("not-a-uuid").success, false);
});
