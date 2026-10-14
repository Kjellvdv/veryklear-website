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
  DATA_DIR: z.string().min(1).default("data"),
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
  // Set once the custom domain is verified. Every other Host header then 301s there.
  CANONICAL_HOST: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^[a-z0-9.-]+$/)
      .optional(),
  ),
});

export type Config = z.infer<typeof schema>;

/** Parses the environment. On failure it names the bad keys, never their values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new Error(`Invalid environment, check: ${keys.join(", ")}`);
  }
  return parsed.data;
}
