import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface WebOTPDB extends DBSchema {
  authParams: {
    key: string;
    value: {
      key: string;
      loginSalt: string;
      dataSalt: string;
      kdfIterations: number;
      email: string;
    };
  };
  vault: {
    key: string;
    value: {
      key: string;
      encryptedBlob: string | null;
      version: number;
      updatedAt: string | null;
      encryptedDekByRecoveryKey: string | null;
    };
  };
  prf: {
    key: string;
    value: {
      key: string;
      credentialId: string;
      salt: string;
      iv: string;
      ct: string;
    };
  };
}

const DB_NAME = "webotp-zk-db";
// Bumped to 6 to add PRF store
const DB_VERSION = 6;

export async function getDB(): Promise<IDBPDatabase<WebOTPDB>> {
  return openDB<WebOTPDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (db.objectStoreNames.contains("authParams")) {
        db.deleteObjectStore("authParams");
      }
      if (db.objectStoreNames.contains("vault")) {
        db.deleteObjectStore("vault");
      }
      if (db.objectStoreNames.contains("prf")) {
        db.deleteObjectStore("prf");
      }

      // Use inline keys via keyPath so db.put(store, value) works correctly
      db.createObjectStore("authParams", { keyPath: "key" });
      db.createObjectStore("vault", { keyPath: "key" });
      db.createObjectStore("prf", { keyPath: "key" });
    },
  });
}

export async function getLocalAuthParams() {
  const db = await getDB();
  return db.get("authParams", "current");
}

export async function setLocalAuthParams(
  params: Omit<WebOTPDB["authParams"]["value"], "key">,
) {
  const db = await getDB();
  await db.put("authParams", { key: "current", ...params });
}

export async function clearLocalAuthParams() {
  const db = await getDB();
  await db.delete("authParams", "current");
}

export async function getLocalVault() {
  const db = await getDB();
  return db.get("vault", "current");
}

export async function setLocalVault(
  data: Omit<WebOTPDB["vault"]["value"], "key">,
) {
  const db = await getDB();
  await db.put("vault", { key: "current", ...data });
}

export async function clearLocalVault() {
  const db = await getDB();
  await db.delete("vault", "current");
}

export async function getLocalPRF() {
  const db = await getDB();
  return db.get("prf", "current");
}

export async function setLocalPRF(data: Omit<WebOTPDB["prf"]["value"], "key">) {
  const db = await getDB();
  await db.put("prf", { key: "current", ...data });
}

export async function clearLocalPRF() {
  const db = await getDB();
  await db.delete("prf", "current");
}
