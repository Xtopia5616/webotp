import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { createHmac } from "crypto";
import { json, type RequestHandler } from "@sveltejs/kit";
import { BETTER_AUTH_SECRET } from "$env/static/private";

export const GET: RequestHandler = async ({ url }) => {
  const rawEmail = url.searchParams.get("email");

  if (!rawEmail) {
    return json({ error: "Email is required" }, { status: 400 });
  }

  // Enforce strict normalization on the server side
  const email = rawEmail.trim().toLowerCase();

  try {
    // Try to find the user
    const result = await db
      .select({
        loginSalt: user.loginSalt,
        dataSalt: user.dataSalt,
        kdfIterations: user.kdfIterations,
      })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (result.length > 0 && result[0].loginSalt && result[0].dataSalt) {
      // User exists: return real salts
      return json({
        loginSalt: result[0].loginSalt,
        dataSalt: result[0].dataSalt,
        kdfIterations: result[0].kdfIterations,
      });
    } else {
      // User does not exist: return deterministic fake salts to prevent enumeration
      const secret = BETTER_AUTH_SECRET;
      if (!secret) {
        // Should not happen in production, but fallback
        return json({ error: "Server configuration error" }, { status: 500 });
      }

      const fakeLoginSalt = createHmac("sha256", secret)
        .update(email + "login_salt")
        .digest("hex");
      const fakeDataSalt = createHmac("sha256", secret)
        .update(email + "data_salt")
        .digest("hex");

      return json({
        loginSalt: fakeLoginSalt,
        dataSalt: fakeDataSalt,
        kdfIterations: 600000, // Default fake iteration count
      });
    }
  } catch (e) {
    console.error("Error fetching auth params:", e);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};
