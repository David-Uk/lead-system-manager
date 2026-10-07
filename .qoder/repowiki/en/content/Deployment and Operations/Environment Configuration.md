# Environment Configuration

<cite>
**Referenced Files in This Document**
- [env.js](file://src/config/env.js)
- [db.js](file://src/config/db.js)
- [logger.js](file://src/utils/logger.js)
- [server.js](file://src/server.js)
- [app.js](file://src/app.js)
- [health.controller.js](file://src/controllers/health.controller.js)
- [webhook.controller.js](file://src/controllers/webhook.controller.js)
- [auth.middleware.js](file://src/middleware/auth.js)
- [signature.middleware.js](file://src/middleware/signature.js)
- [simulate.routes.js](file://src/routes/simulate.routes.js)
- [package.json](file://package.json)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains how environment configuration is loaded, validated, and consumed across the application. It covers supported environment variables, their purposes, defaults, validation rules, environment-specific behavior, secret management patterns, database connection configuration, logging levels, feature flags, and examples for development, staging, and production environments. It also provides guidance on handling configuration validation errors and debugging configuration issues.

## Project Structure
Configuration-related code lives under `src/config`, with shared utilities such as logging under `src/utils`. The server bootstraps the Express app, starts listening, connects to MongoDB, and wires graceful shutdown. Feature flags and secrets are read from a single validated configuration object exported by the configuration module.

```mermaid
graph TB
A["src/server.js"] --> B["src/app.js"]
A --> C["src/config/db.js"]
A --> D["src/config/env.js"]
B --> E["src/utils/logger.js"]
B --> F["src/middleware/*"]
C --> D
E --> D
```

**Diagram sources**
- [server.js:1-26](file://src/server.js#L1-L26)
- [app.js:1-10](file://src/app.js#L1-L10)
- [db.js:1-3](file://src/config/db.js#L1-L3)
- [logger.js:1-3](file://src/utils/logger.js#L1-L3)

**Section sources**
- [server.js:1-26](file://src/server.js#L1-L26)
- [app.js:1-10](file://src/app.js#L1-L10)
- [db.js:1-3](file://src/config/db.js#L1-L3)
- [logger.js:1-3](file://src/utils/logger.js#L1-L3)

## Core Components
- Configuration loader and validator: loads `.env`, validates all variables using a schema, and exports a frozen configuration object.
- Database connector: uses the validated configuration to connect to MongoDB with retry logic.
- Logger: structured logger configured with the selected log level and redaction rules.
- Application bootstrap: starts HTTP server, logs startup context, and manages graceful shutdown.

Key responsibilities:
- Centralize environment access via a single import.
- Fail fast on invalid configuration at process start.
- Provide safe defaults for local development while enforcing stricter rules in production.
- Keep secrets out of logs and enforce strong values in production.

**Section sources**
- [env.js:1-144](file://src/config/env.js#L1-L144)
- [db.js:1-77](file://src/config/db.js#L1-L77)
- [logger.js:1-34](file://src/utils/logger.js#L1-L34)
- [server.js:1-50](file://src/server.js#L1-L50)

## Architecture Overview
The configuration system follows a strict loading and validation pipeline before any runtime component consumes settings.

```mermaid
sequenceDiagram
participant Proc as "Process"
participant DotEnv as "dotenv"
participant Zod as "Zod Schema"
participant EnvMod as "config/env.js"
participant Server as "server.js"
participant DB as "config/db.js"
participant Logger as "utils/logger.js"
Proc->>EnvMod : Import config/env.js
EnvMod->>DotEnv : Load .env from project root
EnvMod->>Zod : Validate process.env against schema
alt Validation fails
Zod-->>EnvMod : Issues
EnvMod->>Proc : Log errors and exit(1)
else Validation succeeds
Zod-->>EnvMod : Frozen env object
Proc->>Server : Start server
Server->>Logger : Initialize logger with LOG_LEVEL
Server->>DB : Connect to MongoDB (retry if needed)
end
```

**Diagram sources**
- [env.js:6-11](file://src/config/env.js#L6-L11)
- [env.js:25-123](file://src/config/env.js#L25-L123)
- [env.js:125-141](file://src/config/env.js#L125-L141)
- [server.js:1-26](file://src/server.js#L1-L26)
- [db.js:37-47](file://src/config/db.js#L37-L47)
- [logger.js:11-26](file://src/utils/logger.js#L11-L26)

## Detailed Component Analysis

### Configuration Loader and Validator
The configuration module performs the following:
- Loads `.env` relative to the project root so it works regardless of the current working directory.
- Normalizes boolean-like strings to actual booleans.
- Validates every required variable with explicit types, ranges, enums, and custom cross-field rules.
- Exits early with clear error messages when validation fails.
- Exports a frozen configuration object to prevent accidental mutation.

Supported environment variables, purposes, defaults, and validation rules:

- Runtime
  - NODE_ENV
    - Purpose: Environment mode controlling behavior and security posture.
    - Default: development
    - Rules: Must be one of development, test, or production.
  - PORT
    - Purpose: HTTP server port.
    - Default: 3000
    - Rules: Integer between 1 and 65535.
  - LOG_LEVEL
    - Purpose: Logging verbosity.
    - Default: info
    - Rules: One of fatal, error, warn, info, debug, trace, silent.

- Database
  - MONGODB_URI
    - Purpose: MongoDB connection string.
    - Default: mongodb://localhost:27017/freshmart
    - Rules: Non-empty string.

- Staff API authentication
  - STAFF_API_KEY
    - Purpose: Shared secret for staff endpoints protected by x-api-key.
    - Default: change-me
    - Rules: Non-empty string; must not equal the default value in production.

- WhatsApp channel
  - WHATSAPP_MODE
    - Purpose: Channel mode; simulated for local testing, cloud for production.
    - Default: simulated
    - Rules: One of simulated, cloud.
  - WHATSAPP_VERIFY_TOKEN
    - Purpose: Webhook verification token.
    - Default: change-me
    - Rules: Non-empty string; must not equal the default value in production.
  - WHATSAPP_APP_SECRET
    - Purpose: HMAC secret for webhook signature verification.
    - Default: change-me
    - Rules: Non-empty string; must not equal the default value in production.
  - WHATSAPP_PHONE_NUMBER_ID
    - Purpose: WhatsApp phone number identifier used in cloud mode.
    - Default: empty
    - Rules: Required when WHATSAPP_MODE=cloud.
  - WHATSAPP_ACCESS_TOKEN
    - Purpose: WhatsApp Cloud API access token.
    - Default: empty
    - Rules: Required when WHATSAPP_MODE=cloud.
  - WHATSAPP_API_VERSION
    - Purpose: WhatsApp Cloud API version string.
    - Default: v19.0
    - Rules: Must match pattern like vX.Y.
  - WHATSAPP_FORCE_SEND_FAILURE
    - Purpose: Boolean flag to force send failures for testing.
    - Default: false
    - Rules: Parsed from true/false strings.
  - STAFF_WHATSAPP_NUMBER
    - Purpose: Staff-facing WhatsApp number.
    - Default: empty
    - Rules: String.

- Hybrid classifier (LLM integration)
  - LLM_PROVIDER
    - Purpose: LLM provider selection; none keeps the system fully functional with rules-only classification.
    - Default: none
    - Rules: One of none, gemini, groq, ollama.
  - LLM_API_KEY
    - Purpose: API key for gemini or groq providers.
    - Default: empty
    - Rules: Required when LLM_PROVIDER is gemini or groq.
  - LLM_MODEL
    - Purpose: Model name for the selected LLM provider.
    - Default: empty
    - Rules: String.
  - LLM_TIMEOUT_MS
    - Purpose: Timeout for LLM requests in milliseconds.
    - Default: 5000
    - Rules: Integer between 500 and 60000.
  - OLLAMA_BASE_URL
    - Purpose: Base URL for Ollama Cloud API.
    - Default: https://ollama.com
    - Rules: Valid URL.
  - OLLAMA_API_KEY
    - Purpose: API key for Ollama Cloud.
    - Default: empty
    - Rules: Required when LLM_PROVIDER=ollama.
  - CONFIDENCE_THRESHOLD
    - Purpose: Threshold below which LLM decisions are treated as unclear.
    - Default: 0.6
    - Rules: Number between 0 and 1.
  - RULES_CONFIDENCE_THRESHOLD
    - Purpose: Threshold above which rules-based decisions skip the LLM entirely.
    - Default: 0.7
    - Rules: Number between 0 and 1.

- Tickets
  - TICKET_SLA_MINUTES
    - Purpose: SLA window in minutes for tickets.
    - Default: 15
    - Rules: Positive integer.

Environment-specific validations:
- Production checks:
  - STAFF_API_KEY must not be the default value.
  - WHATSAPP_APP_SECRET must not be the default value.
  - WHATSAPP_VERIFY_TOKEN must not be the default value.
- Mode-dependent requirements:
  - WHATSPHONE_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are required when WHATSAPP_MODE=cloud.
- Provider-dependent requirements:
  - LLM_API_KEY is required when LLM_PROVIDER is gemini or groq.
  - OLLAMA_API_KEY is required when LLM_PROVIDER=ollama.

Error handling:
- On validation failure, the module prints each issue with its path and message, instructs users to check against an example file, and exits with status code 1.

Secret management patterns:
- Secrets are loaded from environment variables only.
- Defaults exist for local development but are enforced to be replaced in production.
- Sensitive headers are redacted from logs automatically.

Feature flags:
- WHATSAPP_MODE toggles between simulated and cloud behavior.
- LLM_PROVIDER enables or disables LLM features and selects the provider.
- WHATSAPP_FORCE_SEND_FAILURE forces failure paths for testing.

**Section sources**
- [env.js:6-11](file://src/config/env.js#L6-L11)
- [env.js:16-23](file://src/config/env.js#L16-L23)
- [env.js:25-70](file://src/config/env.js#L25-L70)
- [env.js:71-123](file://src/config/env.js#L71-L123)
- [env.js:125-141](file://src/config/env.js#L125-L141)

### Database Connection Configuration
The database module:
- Uses the validated MONGODB_URI from the configuration.
- Emits connection events and logs them through the shared logger.
- Provides a health state function indicating whether the driver reports an established connection.
- Implements a resilient connection strategy:
  - In server mode, failed initial connections do not crash the process; instead, background retries with exponential backoff occur.
  - In CLI seed mode, failures throw immediately.
- Supports graceful shutdown by stopping retries and disconnecting the driver.

Retry behavior:
- Initial delay base and maximum delay are defined.
- Retries use exponential backoff capped at a maximum delay.
- Timers are unrefed so they do not keep the event loop alive unnecessarily.

Operational notes:
- The server starts listening first and then attempts to connect to MongoDB. If unavailable, /health will report degraded until recovery.
- Health checks can inspect both database connectivity and optional LLM/WhatsApp readiness based on configuration.

**Section sources**
- [db.js:1-18](file://src/config/db.js#L1-L18)
- [db.js:27-47](file://src/config/db.js#L27-L47)
- [db.js:50-67](file://src/config/db.js#L50-L67)
- [db.js:69-77](file://src/config/db.js#L69-L77)
- [server.js:20-26](file://src/server.js#L20-L26)
- [health.controller.js:23-35](file://src/controllers/health.controller.js#L23-L35)

### Logging Levels and Redaction
The logger:
- Is initialized with the configured LOG_LEVEL.
- Includes service and environment metadata in every log entry.
- Uses ISO timestamps.
- Redacts sensitive request headers such as API keys, authorization tokens, and webhook signatures.
- Supports child loggers bound to contextual bindings like correlation IDs.

Integration points:
- HTTP request/response logging is handled by pino-http with custom log levels based on response status codes.
- Correlation IDs are attached per request and included in serialized request objects.

**Section sources**
- [logger.js:1-34](file://src/utils/logger.js#L1-L34)
- [app.js:21-37](file://src/app.js#L21-L37)

### Environment-Specific Settings and Feature Flags
- NODE_ENV controls rate limiting behavior and error detail exposure.
- WHATSAPP_MODE determines webhook verification and sending behavior.
- LLM_PROVIDER gates LLM functionality and related configuration requirements.
- Production enforces stronger defaults and requires replacing placeholder secrets.

Usage examples across the codebase:
- Rate limiter skips in test mode.
- Simulate routes restrict usage in production.
- Webhook controller verifies subscription tokens.
- Signature middleware verifies webhook payloads using the app secret.
- Auth middleware compares incoming staff API keys against the configured secret.

**Section sources**
- [app.js:54-67](file://src/app.js#L54-L67)
- [simulate.routes.js:12](file://src/routes/simulate.routes.js#L12)
- [webhook.controller.js:15](file://src/controllers/webhook.controller.js#L15)
- [signature.middleware.js:40](file://src/middleware/signature.js#L40)
- [auth.middleware.js:18](file://src/middleware/auth.js#L18)

### Examples of Configuration Files
Below are example configurations for different environments. Replace placeholders with real values and ensure production constraints are met.

- Development (.env.development)
  - NODE_ENV=development
  - PORT=3000
  - LOG_LEVEL=debug
  - MONGODB_URI=mongodb://localhost:27017/freshmart
  - STAFF_API_KEY=change-me
  - WHATSAPP_MODE=simulated
  - WHATSAPP_VERIFY_TOKEN=change-me
  - WHATSAPP_APP_SECRET=change-me
  - WHATSAPP_API_VERSION=v19.0
  - WHATSAPP_FORCE_SEND_FAILURE=false
  - LLM_PROVIDER=none
  - LLM_TIMEOUT_MS=5000
  - CONFIDENCE_THRESHOLD=0.6
  - RULES_CONFIDENCE_THRESHOLD=0.7
  - TICKET_SLA_MINUTES=15

- Staging (.env.staging)
  - NODE_ENV=production
  - PORT=3000
  - LOG_LEVEL=info
  - MONGODB_URI=mongodb+srv://user:password@cluster.example/staging
  - STAFF_API_KEY=<strong-random-secret>
  - WHATSAPP_MODE=cloud
  - WHATSAPP_VERIFY_TOKEN=<webhook-verify-token>
  - WHATSAPP_APP_SECRET=<webhook-app-secret>
  - WHATSAPP_PHONE_NUMBER_ID=<phone-number-id>
  - WHATSAPP_ACCESS_TOKEN=<access-token>
  - WHATSAPP_API_VERSION=v19.0
  - WHATSAPP_FORCE_SEND_FAILURE=false
  - LLM_PROVIDER=none
  - LLM_TIMEOUT_MS=5000
  - CONFIDENCE_THRESHOLD=0.6
  - RULES_CONFIDENCE_THRESHOLD=0.7
  - TICKET_SLA_MINUTES=15

- Production (.env.production)
  - NODE_ENV=production
  - PORT=8080
  - LOG_LEVEL=warn
  - MONGODB_URI=mongodb+srv://user:password@cluster.example/prod
  - STAFF_API_KEY=<strong-random-secret>
  - WHATSAPP_MODE=cloud
  - WHATSAPP_VERIFY_TOKEN=<webhook-verify-token>
  - WHATSAPP_APP_SECRET=<webhook-app-secret>
  - WHATSAPP_PHONE_NUMBER_ID=<phone-number-id>
  - WHATSAPP_ACCESS_TOKEN=<access-token>
  - WHATSAPP_API_VERSION=v19.0
  - WHATSAPP_FORCE_SEND_FAILURE=false
  - LLM_PROVIDER=gemini
  - LLM_API_KEY=<provider-api-key>
  - LLM_MODEL=<model-name>
  - LLM_TIMEOUT_MS=5000
  - CONFIDENCE_THRESHOLD=0.6
  - RULES_CONFIDENCE_THRESHOLD=0.7
  - TICKET_SLA_MINUTES=15

Notes:
- For LLM_PROVIDER=ollama, set OLLAMA_BASE_URL and OLLAMA_API_KEY instead of gemini/groq keys.
- Ensure production secrets are injected via secure secret managers or container orchestration rather than committed files.

[No sources needed since this section provides conceptual examples]

## Dependency Analysis
The configuration module is imported by multiple components, centralizing environment access and ensuring consistent validation.

```mermaid
graph LR
ENV["config/env.js"] --> APP["app.js"]
ENV --> SERVER["server.js"]
ENV --> DB["config/db.js"]
ENV --> LOGGER["utils/logger.js"]
ENV --> HEALTH["controllers/health.controller.js"]
ENV --> WEBHOOK["controllers/webhook.controller.js"]
ENV --> AUTH["middleware/auth.js"]
ENV --> SIGNATURE["middleware/signature.js"]
ENV --> SIMULATE["routes/simulate.routes.js"]
```

**Diagram sources**
- [env.js:141-144](file://src/config/env.js#L141-L144)
- [app.js:5-9](file://src/app.js#L5-L9)
- [server.js:1-4](file://src/server.js#L1-L4)
- [db.js:1-3](file://src/config/db.js#L1-L3)
- [logger.js:1-3](file://src/utils/logger.js#L1-L3)
- [health.controller.js:2-35](file://src/controllers/health.controller.js#L2-L35)
- [webhook.controller.js:1-15](file://src/controllers/webhook.controller.js#L1-L15)
- [auth.middleware.js:1-18](file://src/middleware/auth.js#L1-L18)
- [signature.middleware.js:1-40](file://src/middleware/signature.js#L1-L40)
- [simulate.routes.js:1-12](file://src/routes/simulate.routes.js#L1-L12)

**Section sources**
- [env.js:141-144](file://src/config/env.js#L141-L144)
- [app.js:5-9](file://src/app.js#L5-L9)
- [server.js:1-4](file://src/server.js#L1-L4)
- [db.js:1-3](file://src/config/db.js#L1-L3)
- [logger.js:1-3](file://src/utils/logger.js#L1-L3)
- [health.controller.js:2-35](file://src/controllers/health.controller.js#L2-L35)
- [webhook.controller.js:1-15](file://src/controllers/webhook.controller.js#L1-L15)
- [auth.middleware.js:1-18](file://src/middleware/auth.js#L1-L18)
- [signature.middleware.js:1-40](file://src/middleware/signature.js#L1-L40)
- [simulate.routes.js:1-12](file://src/routes/simulate.routes.js#L1-L12)

## Performance Considerations
- Configuration validation runs once at startup; avoid heavy computation in validators.
- Use appropriate LOG_LEVEL to balance observability and overhead; higher verbosity increases I/O.
- MongoDB connection retries use exponential backoff to reduce load during transient failures.
- Rate limiting protects against abuse; tune limits according to expected traffic patterns.
- LLM timeouts should reflect provider latency characteristics; too low may cause unnecessary retries.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common configuration issues and resolutions:

- Invalid environment variables
  - Symptom: Process exits immediately with a list of validation issues.
  - Action: Review the printed issues, correct values in your environment, and ensure required fields are present.
  - Reference: Validation and exit behavior.

- Missing or incorrect secrets in production
  - Symptom: Validation errors indicating that STAFF_API_KEY, WHATSAPP_APP_SECRET, or WHATSAPP_VERIFY_TOKEN must be replaced.
  - Action: Set strong, unique values for these secrets in production.

- WhatsApp cloud mode misconfiguration
  - Symptom: Validation errors stating WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN are required when WHATSAPP_MODE=cloud.
  - Action: Provide both fields when using cloud mode.

- LLM provider missing API key
  - Symptom: Validation errors requiring LLM_API_KEY for gemini or groq, or OLLAMA_API_KEY for ollama.
  - Action: Set the appropriate API key for the selected provider.

- MongoDB connection failures
  - Symptom: Server starts but /health reports down; logs show connection warnings.
  - Action: Verify MONGODB_URI, network access, credentials, and cluster availability. The server will retry in the background.

- Debugging tips
  - Increase LOG_LEVEL to debug temporarily to capture more details.
  - Check that sensitive headers are redacted in logs; never commit secrets.
  - Use the health endpoint to verify runtime state including LLM and WhatsApp readiness.

**Section sources**
- [env.js:125-141](file://src/config/env.js#L125-L141)
- [db.js:37-67](file://src/config/db.js#L37-L67)
- [server.js:20-26](file://src/server.js#L20-L26)
- [logger.js:11-26](file://src/utils/logger.js#L11-L26)

## Conclusion
The environment configuration system centralizes and validates all runtime settings, ensuring safe defaults for development and strict enforcement in production. By importing the frozen configuration object, components avoid direct process.env access and benefit from consistent validation. The design supports environment-specific behavior, robust secret management, resilient database connectivity, and configurable logging. Following the provided examples and troubleshooting steps will help you configure the application reliably across development, staging, and production environments.

[No sources needed since this section summarizes without analyzing specific files]