import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { vault } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  const session = locals.session;
  if (!session) {
    throw error(401, "Unauthorized");
  }

  const userId = session.userId;

  const result = await db.select().from(vault).where(eq(vault.userId, userId));

  if (result.length === 0) {
    // Return consistent structure with nulls for missing vault
    return json({
      encryptedBlob: null,
      version: 0,
      updatedAt: null,
      encryptedDekByRecoveryKey: null,
    });
  }

  const userVault = result[0];

  return json({
    encryptedBlob: userVault.encryptedBlob,
    version: Number(userVault.version), // Convert BigInt to Number for JSON
    updatedAt: userVault.updatedAt,
    encryptedDekByRecoveryKey: userVault.encryptedDekByRecoveryKey,
  });
};

interface VaultPutBody {
  encryptedBlob: string;
  version: number;
  encryptedDekByRecoveryKey?: string;
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) {
    throw error(401, "Unauthorized");
  }

  const userId = session.userId;
  const body = (await request.json()) as VaultPutBody;

  const { encryptedBlob, version, encryptedDekByRecoveryKey } = body;

  if (!encryptedBlob || version === undefined) {
    throw error(400, "Missing required fields");
  }

  try {
    const result = await db.transaction(async (tx) => {
      const current = await tx
        .select({ version: vault.version })
        .from(vault)
        .where(eq(vault.userId, userId));

      // Case 1: Creation (Initial Vault Setup)
      if (current.length === 0) {
        if (version !== 0) {
          throw error(400, "Invalid version for creation");
        }

        // Ensure we have the recovery key for new vaults
        if (!encryptedDekByRecoveryKey) {
          throw error(
            400,
            "Recovery key encryption is required for new vaults",
          );
        }

        const inserted = await tx
          .insert(vault)
          .values({
            id: userId, // 1:1 mapping with user
            userId,
            encryptedBlob,
            encryptedDekByRecoveryKey: encryptedDekByRecoveryKey,
            version: 1,
            updatedAt: new Date(),
          })
          .returning({ version: vault.version });

        return inserted[0];
      }

      // Case 2: Update (Existing Vault)
      const currentVersion = Number(current[0].version);

      if (currentVersion !== version) {
        // Conflict detected
        throw error(412, "Precondition Failed: Version mismatch");
      }

      const updated = await tx
        .update(vault)
        .set({
          encryptedBlob,
          // Schema uses mode: number, so we pass number.
          version: version + 1,
          updatedAt: new Date(),
          // Only update recovery key if provided (during key rotation)
          ...(encryptedDekByRecoveryKey && { encryptedDekByRecoveryKey }),
        })
        .where(eq(vault.userId, userId))
        .returning({ version: vault.version });

      return updated[0];
    });

    return json({ success: true, version: Number(result.version) });
  } catch (err: unknown) {
    // Check if it's our 412/400 error (SvelteKit HttpError)
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      (err.status === 412 || err.status === 400)
    ) {
      throw err;
    }
    console.error("Vault update error:", err);
    throw error(500, "Failed to update vault");
  }
};
