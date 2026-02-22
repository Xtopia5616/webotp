import { db } from "$lib/server/db";
import { user, vault } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { json, error } from "@sveltejs/kit";
import { createHmac } from "crypto";
import { BETTER_AUTH_SECRET } from "$env/static/private";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const rawEmail = url.searchParams.get("email");

  if (!rawEmail) {
    throw error(400, "Email is required");
  }

  // Enforce strict normalization on the server side
  const email = rawEmail.trim().toLowerCase();

  try {
    // 1. Find User by Email
    const users = await db.select().from(user).where(eq(user.email, email));

    if (users.length > 0) {
      const u = users[0];

      // 2. Fetch Vault Data
      const vaults = await db
        .select()
        .from(vault)
        .where(eq(vault.userId, u.id));

      if (vaults.length === 0) {
        throw error(404, "Vault not found");
      }

      const v = vaults[0];

      // 3. Return necessary data for client-side recovery
      return json({
        encryptedBlob: v.encryptedBlob,
        encryptedDekByRecoveryKey: v.encryptedDekByRecoveryKey,
        dataSalt: u.dataSalt,
        kdfIterations: u.kdfIterations,
      });
    } else {
      // Anti-Enumeration: Return deterministic fake data
      // This prevents attackers from knowing if an email exists.
      // The client will try to decrypt fake data and fail, same as wrong key.
      const secret = BETTER_AUTH_SECRET;
      if (!secret) {
        throw error(500, "Server configuration error");
      }

      const fakeDataSalt = createHmac("sha256", secret)
        .update(email + "data_salt")
        .digest("hex");

      // Generate deterministic fake blobs based on email
      // (Client expects format v=1;iv=...;ct=... with Base64-encoded values)
      const fakeIv = createHmac("sha256", secret)
        .update(email + "fake_iv")
        .digest("base64")
        .slice(0, 16); // 16 Base64 chars (12 bytes of IV)
      const fakeCt = createHmac("sha256", secret)
        .update(email + "fake_ct")
        .digest("base64");

      const fakeBlob = `v=1;iv=${fakeIv};ct=${fakeCt}`;
      const fakeDekBlob = `v=1;iv=${fakeIv};ct=${fakeCt}`;

      return json({
        encryptedBlob: fakeBlob,
        encryptedDekByRecoveryKey: fakeDekBlob,
        dataSalt: fakeDataSalt,
        kdfIterations: 600000,
      });
    }
  } catch (e) {
    // Re-throw SvelteKit errors
    if (e && typeof e === "object" && "status" in e) throw e;
    console.error("Recovery fetch error:", e);
    throw error(500, "Failed to fetch recovery data");
  }
};
