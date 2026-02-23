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
    return json({ error: "unauthorized" }, { status: 401 });
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
    return json({ error: "missing_fields" }, { status: 400 });
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

      if (accountRes.length === 0) throw error(500, "server_error");

      const storedHash = accountRes[0].password;
      if (!storedHash) {
        throw error(500, "server_error");
      }

      const isValid = await verifyPassword(oldLak, storedHash);
      if (!isValid) {
        throw error(403, "invalid_old_password");
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
        throw error(404, "vault_not_found");
      }

      if (currentVault[0].version !== version) {
        throw error(412, "version_mismatch");
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
      "body" in err &&
      typeof (err as any).body === "object" &&
      (err as any).body !== null &&
      "message" in (err as any).body
    ) {
      const httpError = err as { status: number; body: { message: string } };
      return json({ error: httpError.body.message }, { status: httpError.status });
    }
    console.error("Key rotation error:", err);
    return json({ error: "server_error" }, { status: 500 });
  }
};
