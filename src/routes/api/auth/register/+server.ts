import { auth } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { user, vault } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { json, type RequestHandler } from "@sveltejs/kit";

interface RegisterBody {
  email: string;
  password: string;
  loginSalt: string;
  dataSalt: string;
  kdfIterations: number;
  encryptedBlob: string;
  encryptedDekByRecoveryKey: string;
}

export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json()) as RegisterBody;

  const {
    email,
    password,
    loginSalt,
    dataSalt,
    kdfIterations,
    encryptedBlob,
    encryptedDekByRecoveryKey,
  } = body;

  if (
    !email ||
    !password ||
    !loginSalt ||
    !dataSalt ||
    !kdfIterations ||
    !encryptedBlob ||
    !encryptedDekByRecoveryKey
  ) {
    return json({ error: "missing_fields" }, { status: 400 });
  }

  // Ensure email is strictly normalized on the server side as well
  const normalizedEmail = email.trim().toLowerCase();

  // Pre-check: if user already exists, return a clean error
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    return json({ error: "email_exists" }, { status: 409 });
  }

  let createdUserId: string | null = null;

  try {
    // 1. Register user via Better Auth (server-side, sets session cookie)
    const response = await auth.api.signUpEmail({
      body: {
        email: normalizedEmail,
        password, // This is the LAK (Login Authentication Key)
        name: normalizedEmail.split("@")[0],
        dataSalt,
        loginSalt,
        kdfIterations,
      },
      asResponse: true,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.message || `Sign-up failed: ${response.status}`);
    }

    // Extract the created user id from the response body
    const responseData = await response.clone().json();
    createdUserId = responseData?.user?.id ?? null;

    if (!createdUserId) {
      // Fallback: look up by email
      const created = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, normalizedEmail))
        .limit(1);
      createdUserId = created[0]?.id ?? null;
    }

    if (!createdUserId) {
      throw new Error("Could not determine created user ID");
    }

    // 2. Create the vault row in the same request while we have the user id
    await db.insert(vault).values({
      id: createdUserId, // FIXED: Use createdUserId to match user.id per schema requirements
      userId: createdUserId,
      encryptedBlob,
      encryptedDekByRecoveryKey,
      version: 1,
      updatedAt: new Date(),
    });

    // 3. Return the original Better Auth response (carries Set-Cookie header)
    return response;
  } catch (e: unknown) {
    console.error("Registration error:", e);

    // Clean up orphaned user row so the user can retry
    if (createdUserId) {
      try {
        await db.delete(user).where(eq(user.id, createdUserId));
      } catch (cleanupErr) {
        console.error(
          "Failed to clean up partial user registration:",
          cleanupErr,
        );
      }
    } else {
      try {
        await db.delete(user).where(eq(user.email, normalizedEmail));
      } catch (cleanupErr) {
        console.error(
          "Failed to clean up partial user registration:",
          cleanupErr,
        );
      }
    }

    return json({ error: "registration_failed" }, { status: 400 });
  }
};
