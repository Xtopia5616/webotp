import { db } from "$lib/server/db";
import {
  user,
  vault,
  account,
  session as sessionTable,
} from "$lib/server/db/schema";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "$lib/server/password";
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

interface RecoveryResetBody {
  email: string;
  newLak: string;
  newLoginSalt: string;
  newDataSalt: string;
  newEncryptedBlob: string;
  newEncryptedDekByRecoveryKey: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as RecoveryResetBody;

  const {
    email: rawEmail,
    newLak,
    newLoginSalt,
    newDataSalt,
    newEncryptedBlob,
    newEncryptedDekByRecoveryKey,
  } = body;

  if (
    !rawEmail ||
    !newLak ||
    !newLoginSalt ||
    !newDataSalt ||
    !newEncryptedBlob ||
    !newEncryptedDekByRecoveryKey
  ) {
    return json({ error: "missing_fields" }, { status: 400 });
  }

  // Enforce strict normalization on the server side
  const email = rawEmail.trim().toLowerCase();

  try {
    await db.transaction(async (tx) => {
      // 1. Find User
      const users = await tx.select().from(user).where(eq(user.email, email));

      if (users.length === 0) {
        throw error(404, "invalid_recovery_key");
      }
      const u = users[0];
      const userId = u.id;

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
      // Note: This replaces any existing hash (including bcrypt from better-auth)
      const newHash = await hashPassword(newLak);
      await tx
        .update(account)
        .set({
          password: newHash,
        })
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "credential")),
        );

      // 4. Update Vault (increment version to invalidate other devices' OCC)
      const currentVault = await tx
        .select({ version: vault.version })
        .from(vault)
        .where(eq(vault.userId, userId));

      const currentVersion =
        currentVault.length > 0 ? currentVault[0].version : 0;

      await tx
        .update(vault)
        .set({
          encryptedBlob: newEncryptedBlob,
          encryptedDekByRecoveryKey: newEncryptedDekByRecoveryKey,
          version: currentVersion + 1,
          updatedAt: new Date(),
        })
        .where(eq(vault.userId, userId));

      // 5. Revoke ALL sessions (Force Re-login)
      await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));
    });

    return json({ success: true });
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) {
      const httpError = e as { status: number; body: { message: string } };
      return json(
        { error: httpError.body.message },
        { status: httpError.status },
      );
    }
    console.error("Recovery reset error:", e);
    return json({ error: "server_error" }, { status: 500 });
  }
};
