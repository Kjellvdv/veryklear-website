import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

// Something on this machine pre-sets some env keys, and dotenv won't overwrite
// them unless told to (dev-standards, "Environment and secrets"). Railway has no
// .env file, so this is a no-op there.
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true, quiet: true });

const emptyAsUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3011),
  // Where the SQLite file lives. On Railway it must be on the volume: see loadConfig.
  DATA_DIR: z.preprocess(emptyAsUndefined, z.string().trim().min(1).optional()),
  DIST_DIR: z.string().min(1).default("dist"),
  REPORT_PASSWORD: z.string().min(12),
  // The numbers page. Not in robots.txt, so keep it out of the repo's public copy too.
  REPORT_PATH: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^\/[a-z0-9-]{3,40}$/)
      .default("/numeros"),
  ),
  RETENTION_DAYS: z.coerce.number().int().min(30).max(800).default(400),
  // Leave visits from cloud and hosting networks out of the count. Off until
  // /numeros/whoami has shown the address the server really gets from the proxy.
  DATACENTER_FILTER: z.preprocess(emptyAsUndefined, z.enum(["on", "off"]).default("off")),
  // Set once the custom domain is verified. Every other Host header then 301s there.
  CANONICAL_HOST: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^[a-z0-9.-]+$/)
      .optional(),
  ),
});

export type Config = Omit<z.infer<typeof schema>, "DATA_DIR"> & { DATA_DIR: string };

/**
 * Parses the environment. On failure it names the bad keys, never their values.
 *
 * Railway sets RAILWAY_VOLUME_MOUNT_PATH when a volume is attached. The data
 * folder defaults to it, and a DATA_DIR that points anywhere else is refused:
 * a database on the container's own disk looks fine until the next deploy
 * throws it away (a trailing comma in the variable did exactly that once).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new Error(`Invalid environment, check: ${keys.join(", ")}`);
  }
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || undefined;
  const dataDir = parsed.data.DATA_DIR ?? mount ?? "data";
  if (mount) {
    const root = path.resolve(mount);
    const dir = path.resolve(dataDir);
    if (dir !== root && !dir.startsWith(root + path.sep)) {
      throw new Error(
        `DATA_DIR is "${dataDir}" but the volume is mounted at "${mount}": the database would vanish on the next deploy`,
      );
    }
  }
  return { ...parsed.data, DATA_DIR: dataDir };
}
