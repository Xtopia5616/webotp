import type { Account } from "$lib/stores/vault.svelte";

/**
 * 3-Way Merge Engine
 * Implements "Trash Can Strategy": Soft delete has absolute priority.
 */
export function mergeVault(
  base: Account[],
  local: Account[],
  remote: Account[],
): Account[] {
  const baseMap = new Map<string, Account>();
  const localMap = new Map<string, Account>();
  const remoteMap = new Map<string, Account>();
  const allIds = new Set<string>();

  // Populate maps and ID set
  base.forEach((a) => {
    baseMap.set(a.id, a);
    allIds.add(a.id);
  });
  local.forEach((a) => {
    localMap.set(a.id, a);
    allIds.add(a.id);
  });
  remote.forEach((a) => {
    remoteMap.set(a.id, a);
    allIds.add(a.id);
  });

  const merged: Account[] = [];

  for (const id of allIds) {
    const baseAcc = baseMap.get(id);
    const localAcc = localMap.get(id);
    const remoteAcc = remoteMap.get(id);

    // 1. Creation: If new in local or remote (and not in base)
    if (!baseAcc) {
      if (localAcc && remoteAcc) {
        // Both created same ID offline (unlikely with UUIDs).
        // Take the one with later updatedAt.
        const latest =
          localAcc.updatedAt > remoteAcc.updatedAt ? localAcc : remoteAcc;
        if (!latest.deletedAt) merged.push(latest);
      } else if (localAcc) {
        if (!localAcc.deletedAt) merged.push(localAcc);
      } else if (remoteAcc) {
        if (!remoteAcc.deletedAt) merged.push(remoteAcc);
      }
      continue;
    }

    // 2. Deletion (Trash Can Strategy)
    // If deleted in either local or remote, it stays deleted.
    const localDeleted = localAcc?.deletedAt;
    const remoteDeleted = remoteAcc?.deletedAt;

    if (localDeleted || remoteDeleted) {
      // Determine which deletion record to keep (latest)
      // We need to preserve the record so the deletion syncs,
      // but usually we filter out deleted items from the active list.
      // However, the spec says "soft delete... absolute priority".
      // We should probably keep the tombstone in the DB, but filter from UI.
      // For the merge result, we include the tombstone.

      let deletedAcc: Account;
      if (localDeleted && remoteDeleted) {
        deletedAcc = localDeleted > remoteDeleted ? localAcc : remoteAcc;
      } else {
        deletedAcc = localDeleted ? localAcc : remoteAcc!;
      }

      // We push the tombstone to preserve the deletion state
      merged.push(deletedAcc);
      continue;
    }

    // 3. Modification
    // If not deleted, check for updates.
    // If only one side changed, take that.
    // If both changed, take the latest updatedAt.

    const baseTime = baseAcc.updatedAt;
    const localTime = localAcc?.updatedAt || baseTime;
    const remoteTime = remoteAcc?.updatedAt || baseTime;

    // If local is missing (shouldn't happen if base exists, but safety check)
    if (!localAcc) {
      if (remoteAcc) merged.push(remoteAcc);
      continue;
    }
    // If remote is missing (implies deleted? No, deletion handled above. Implies not synced yet?)
    // Actually, if base exists, remote should exist unless deleted (handled above).
    // If remote is missing in remoteMap but base existed, it implies it was deleted remotely?
    // Wait, if remoteMap doesn't have it, but base did, it's a remote deletion.
    // The deletion block above checks `remoteAcc?.deletedAt`.
    // We need to handle "missing key means deleted" vs "explicit deletedAt".
    // Our schema usually keeps the record with deletedAt.
    // But if the record is missing from the array entirely, it's a hard delete?
    // Architecture says "soft delete". So it should be present.
    // We will assume if it's in remote, it's in the array.

    if (localTime > baseTime && remoteTime > baseTime) {
      // Conflict: Both modified. Last Write Wins.
      merged.push(localTime > remoteTime ? localAcc : remoteAcc!);
    } else if (localTime > baseTime) {
      merged.push(localAcc);
    } else if (remoteTime > baseTime) {
      merged.push(remoteAcc!);
    } else {
      // Neither changed
      merged.push(baseAcc);
    }
  }

  return merged;
}
