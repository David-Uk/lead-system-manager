import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env relative to the project root, regardless of the current working
// directory. Existing process.env values always win, which is what lets
// docker-compose override MONGODB_URI inside the api container.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

/**
 * Parses "true"/"false" strings from the environment into booleans.
 * z.coerce.boolean() is deliberately not used: Boolean("false") === true.
 */
const booleanFromEnv = (defaultValue) =>
    z.preprocess((value) => {
        if (value === undefined || value === '') return undefined;
        const normalised = String(value).toLowerCase();
        if (normalised === 'true') return true;
        if (normalised === 'false') return false;
        return value; // anything else fails the boolean check below
    }, z.boolean().default(defaultValue));

const envSchema = z
    .object({
        // Runtime
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: z.coerce.number().int().min(1).max(65535).default(3000),
        LOG_LEVEL: z
            .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
            .default('info'),

        // Database
        MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/freshmart'),

        // Staff endpoints (x-api-key)
        STAFF_API_KEY: z.string().min(1).default('change-me'),

        // WhatsApp channel (Cloud API in production, simulated by default)
        WHATSAPP_MODE: z.enum(['simulated', 'cloud']).default('simulated'),
        WHATSAPP_VERIFY_TOKEN: z.string().min(1).default('change-me'),
        WHATSAPP_APP_SECRET: z.string().min(1).default('change-me'),
        WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
        WHATSAPP_ACCESS_TOKEN: z.string().default(''),
        WHATSAPP_API_VERSION: z
            .string()
            .regex(/^v\d+\.\d+$/, 'must look like v19.0 (leading "v" included)')
            .default('v19.0'),
        WHATSAPP_FORCE_SEND_FAILURE: booleanFromEnv(false),
        STAFF_WHATSAPP_NUMBER: z.string().default(''),

        // Hybrid classifier (workplan 4). "none" keeps the system fully
        // functional with rules-only classification and escalation.
        LLM_PROVIDER: z.enum(['none', 'gemini', 'groq', 'ollama']).default('none'),
        LLM_API_KEY: z.string().default(''),
        LLM_MODEL: z.string().default(''),
        LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(5000),
        // Ollama Cloud API base (https://ollama.com). There is no local
        // Ollama path: the cloud service requires an API key.
        OLLAMA_BASE_URL: z.string().url().default('https://ollama.com'),
        OLLAMA_API_KEY: z.string().default(''),
        // LLM decisions below this confidence are treated as unclear.
        CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
        // Rules decisions at or above this confidence skip the LLM entirely.
        RULES_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),

        // Tickets
        TICKET_SLA_MINUTES: z.coerce.number().int().min(1).default(15),

        // Sandbox simulation (POST /simulate/keys): how long a generated key
        // stays valid, and the per-IP hourly cap on key creation.
        SANDBOX_KEY_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
        SANDBOX_KEY_MAX_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(10),
    })
    .superRefine((value, ctx) => {
        if (value.NODE_ENV === 'production') {
            if (value.STAFF_API_KEY === 'change-me') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['STAFF_API_KEY'],
                    message: 'must be replaced with a strong secret in production',
                });
            }
            if (value.WHATSAPP_APP_SECRET === 'change-me') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['WHATSAPP_APP_SECRET'],
                    message: 'must be set in production to verify webhook signatures',
                });
            }
            if (value.WHATSAPP_VERIFY_TOKEN === 'change-me') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['WHATSAPP_VERIFY_TOKEN'],
                    message: 'must be set in production to complete the webhook handshake',
                });
            }
        }

        if (value.WHATSAPP_MODE === 'cloud') {
            for (const key of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN']) {
                if (!value[key]) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [key],
                        message: `is required when WHATSAPP_MODE=cloud`,
                    });
                }
            }
        }

        if (['gemini', 'groq'].includes(value.LLM_PROVIDER) && !value.LLM_API_KEY) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['LLM_API_KEY'],
                message: `is required when LLM_PROVIDER=${value.LLM_PROVIDER}`,
            });
        }

        if (value.LLM_PROVIDER === 'ollama' && !value.OLLAMA_API_KEY) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['OLLAMA_API_KEY'],
                message: 'is required when LLM_PROVIDER=ollama (Ollama Cloud uses API keys)',
            });
        }
    });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const lines = parsed.error.issues.map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    // The logger is not available yet, so plain stderr is correct here.
    console.error(`Invalid environment variables:\n${lines.join('\n')}`);
    console.error('Check your .env file against .env.example.');
    process.exit(1);
}

/**
 * Validated, frozen environment configuration.
 * Import this module everywhere instead of reading process.env directly.
 */
export const env = Object.freeze(parsed.data);

export { projectRoot };
