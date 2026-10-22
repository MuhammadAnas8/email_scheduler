export type ManualSendOutcome = {
  status: "sent" | "failed" | "uncertain";
  providerMessageId?: string | null;
  errorCode?: string | null;
};

export function hasSelectedAttachment(file: { name: string; size: number } | null): boolean {
  return file !== null && !(file.name === "" && file.size === 0);
}

export async function executeClaimedTestSend(
  requestId: string,
  dependencies: {
    claim: (requestId: string) => Promise<{ claimed: boolean; status: string; providerMessageId?: string | null; errorCode?: string | null }>;
    send: () => Promise<ManualSendOutcome>;
    finish: (requestId: string, outcome: ManualSendOutcome) => Promise<void>;
  },
) {
  const claim = await dependencies.claim(requestId);
  if (!claim.claimed) return { claimed: false, status: claim.status, providerMessageId: claim.providerMessageId ?? null, errorCode: claim.errorCode ?? null };
  let outcome: ManualSendOutcome;
  try {
    outcome = await dependencies.send();
  } catch {
    outcome = { status: "uncertain", errorCode: "outcome_uncertain" };
  }
  try {
    await dependencies.finish(requestId, outcome);
    return { claimed: true, ...outcome };
  } catch {
    // A provider call may have succeeded while persistence failed. Do not imply a retry is safe.
    return { claimed: true, status: "uncertain" as const, providerMessageId: null, errorCode: "outcome_uncertain" };
  }
}
