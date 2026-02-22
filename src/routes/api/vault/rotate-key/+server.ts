import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import {
  user,
  vault,
  account,
  session as sessionTable,
} from "$lib/server/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { hashPassword, verifyPassword } from "$lib/server/password";
import type { RequestHandler } from "./$types";

interface RotateKeyBody {
  oldLak: string;
  newLak: string;
  newLoginSalt: string;
  newDataSalt: string;
  newEncryptedBlob: string;
  newEncryptedDekByRecoveryKey: string;
  version: number;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) {
    throw error(401, "Unauthorized");
  }

  const userId = session.userId;
  const body = (await request.json()) as RotateKeyBody;

  const {
    oldLak,
    newLak,
    newLoginSalt,
    newDataSalt,
    newEncryptedBlob,
    newEncryptedDekByRecoveryKey,
    version,
  } = body;

  if (
    !oldLak ||
    !newLak ||
    !newLoginSalt ||
    !newDataSalt ||
    !newEncryptedBlob ||
    !newEncryptedDekByRecoveryKey ||
    version === undefined
  ) {
    throw error(400, "Missing required fields");
  }

  try {
    await db.transaction(async (tx) => {
      // 1. Verify Old LAK (Security Critical Step)
      const accountRes = await tx
        .select()
        .from(account)
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "credential")),
        )
        .limit(1);

      if (accountRes.length === 0) throw error(500, "Account not found");

      const storedHash = accountRes[0].password;
      if (!storedHash) {
        throw error(500, "Invalid account state");
      }

      const isValid = await verifyPassword(oldLak, storedHash);
      if (!isValid) {
        throw error(403, "Invalid old password provided");
      }

      // 2. Update User Salts
      await tx
        .update(user)
        .set({
          loginSalt: newLoginSalt,
          dataSalt: newDataSalt,
        })
        .where(eq(user.id, userId));

      // 3. Update Password Hash in Account table
      // Use scrypt for consistency with our ZK architecture
      const newHash = await hashPassword(newLak);
      await tx
        .update(account)
        .set({
          password: newHash,
        })
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "credential")),
        );

      // 4. Update Vault
      const currentVault = await tx
        .select({ version: vault.version })
        .from(vault)
        .where(eq(vault.userId, userId));

      if (currentVault.length === 0) {
        throw error(404, "Vault not found");
      }

      if (currentVault[0].version !== version) {
        throw error(412, "Version mismatch");
      }

      await tx
        .update(vault)
        .set({
          encryptedBlob: newEncryptedBlob,
          encryptedDekByRecoveryKey: newEncryptedDekByRecoveryKey,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(eq(vault.userId, userId));

      // 5. Revoke other sessions
      // Delete all sessions except the current one
      await tx
        .delete(sessionTable)
        .where(
          and(eq(sessionTable.userId, userId), ne(sessionTable.id, session.id)),
        );
    });

    return json({ success: true });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      (err.status === 412 ||
        err.status === 404 ||
        err.status === 403 ||
        err.status === 401)
    ) {
      throw err;
    }
    console.error("Key rotation error:", err);
    throw error(500, "Failed to rotate key");
  }
};
