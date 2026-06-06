import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";

describe("localEncryptedProvider legacy key-path fallback", () => {
  const previousHome = process.env.HOME;
  const previousPaperclipHome = process.env.PAPERCLIP_HOME;
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const previousMasterKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  const tmpDirs: string[] = [];

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = previousPaperclipHome;
    if (previousKeyFile === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    if (previousMasterKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY = previousMasterKey;
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers the legacy $HOME/instances key when PAPERCLIP_HOME is unset", async () => {
    const homeDir = path.join(os.tmpdir(), `paperclip-legacy-key-${randomBytes(6).toString("hex")}`);
    tmpDirs.push(homeDir);
    process.env.HOME = homeDir;
    delete process.env.PAPERCLIP_HOME;
    delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;

    const legacyKeyPath = path.join(homeDir, "instances", "default", "secrets", "master.key");
    const modernKeyPath = path.join(homeDir, ".paperclip", "instances", "default", "secrets", "master.key");
    mkdirSync(path.dirname(legacyKeyPath), { recursive: true });
    mkdirSync(path.dirname(modernKeyPath), { recursive: true });
    writeFileSync(legacyKeyPath, randomBytes(32).toString("base64"), "utf8");
    writeFileSync(modernKeyPath, randomBytes(32).toString("base64"), "utf8");

    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = legacyKeyPath;
    const prepared = await localEncryptedProvider.createSecret({ value: "forgejo-token" });

    delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    await expect(
      localEncryptedProvider.resolveVersion({
        material: prepared.material,
        externalRef: prepared.externalRef,
        providerConfig: null,
        context: {
          companyId: "company-1",
          secretId: "secret-1",
          version: 1,
        },
      }),
    ).resolves.toBe("forgejo-token");

    await expect(localEncryptedProvider.healthCheck()).resolves.toMatchObject({
      provider: "local_encrypted",
      details: {
        keyFilePath: legacyKeyPath,
      },
    });
  });
});
