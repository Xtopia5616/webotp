import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { BETTER_AUTH_URL, BETTER_AUTH_SECRET } from "$env/static/private";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
  }),

  emailAndPassword: {
    enabled: true,
    password: {
      // Override default bcrypt with our custom scrypt implementation
      // This ensures consistency with rotate-key and recovery-reset endpoints
      hash: async (password) => {
        return await hashPassword(password);
      },
      verify: async (arg1: unknown, arg2?: unknown) => {
        // Better Auth has a known quirk where it passes an object { password, hash }
        // to the verify function instead of two separate string arguments.
        if (
          typeof arg1 === "object" &&
          arg1 !== null &&
          "password" in arg1 &&
          "hash" in arg1
        ) {
          const obj = arg1 as { password: unknown; hash: unknown };
          return await verifyPassword(
            typeof obj.password === "string" ? obj.password : "",
            typeof obj.hash === "string" ? obj.hash : "",
          );
        }
        // Fallback for standard (password, hash) signature
        return await verifyPassword(
          typeof arg1 === "string" ? arg1 : "",
          typeof arg2 === "string" ? arg2 : "",
        );
      },
    },
  },

  trustedOrigins: [BETTER_AUTH_URL],

  user: {
    additionalFields: {
      dataSalt: {
        type: "string",
        required: true,
        input: true, // Allow this field to be set during sign-up
      },
      loginSalt: {
        type: "string",
        required: true,
        input: true, // Allow this field to be set during sign-up
      },
      kdfIterations: {
        type: "number",
        required: true,
        input: true, // Allow this field to be set during sign-up
      },
    },
  },
});

export type Auth = typeof auth;
