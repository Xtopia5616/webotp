/**
 * Utility for Clock Drift Detection (Architecture Doc 8.1)
 */

export interface ClockDriftResult {
  isDrifted: boolean;
  driftMs: number;
  localTime: Date;
  serverTime: Date;
}

/**
 * Checks for significant clock drift by comparing local time with a server response.
 * Ideally called during app initialization or sync.
 *
 * @param serverDateHeader - The 'Date' header from a server response.
 * @param thresholdMs - The allowed deviation in milliseconds (default 15000ms / 15s).
 */
export function checkClockDrift(
  serverDateHeader: string,
  thresholdMs: number = 15000,
): ClockDriftResult {
  const serverTime = new Date(serverDateHeader).getTime();
  const localTime = Date.now();
  const driftMs = localTime - serverTime;

  return {
    isDrifted: Math.abs(driftMs) > thresholdMs,
    driftMs,
    localTime: new Date(localTime),
    serverTime: new Date(serverTime),
  };
}
