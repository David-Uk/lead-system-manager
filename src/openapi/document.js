import { AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from '../models/auditEvent.model.js';
import { ORDER_STATUSES } from '../models/order.model.js';
import {
    TICKET_NOTIFICATION_STATUSES,
    TICKET_PRIORITIES,
    TICKET_REASONS,
    TICKET_STATUSES,
} from '../models/ticket.model.js';
import { LLM_INTENTS } from '../services/classifier/llm.js';

/**
 * OpenAPI 3.0 document for the Lead System Manager API (workplan 8, T-016).
 *
 * Hand-authored rather than generated so every operation documents the
 * actual controller output, including the shared error envelope and the
 * keyset cursor on /api/audit. Enum values are imported from the models, so
 * schema changes cannot silently drift from the documentation.
 *
 * Served raw at GET /openapi.json and rendered by RapiDoc at GET /docs.
 */

const jsonBody = (schema) => ({ content: { 'application/json': { schema } } });

const errorResponse = (description) => ({
    description,
    ...jsonBody({ $ref: '#/components/schemas/Error' }),
});

const staffErrorResponses = {
    400: errorResponse('Validation error (VALIDATION_ERROR)'),
    401: errorResponse('Missing or invalid x-api-key (UNAUTHORIZED)'),
    429: errorResponse('Too many requests (RATE_LIMITED)'),
};

const limitParam = {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
};

const pageParam = {
    name: 'page',
    in: 'query',
    schema: { type: 'integer', minimum: 1, default: 1 },
};

const dateTime = { type: 'string', format: 'date-time' };

const document = {
    openapi: '3.0.3',
    info: {
        title: 'Lead System Manager API',
        version: '1.0.0',
        description: [
            'WhatsApp retail automation backend for Lagos Fresh Mart.',
            '',
            'The message pipeline is hybrid-classified (rules first, LLM fallback), enforces',
            'exactly-once processing per provider message id, fills order slots conversationally,',
            'and escalates to human tickets when it cannot answer safely.',
            '',
            'Staff endpoints sit behind the shared `x-api-key` header; every response carries a',
            '`correlationId` that ties it to the audit trail (`GET /api/audit`). Browser entry',
            'points: the home GUI at `/`, the simulation workbench at `/simulate` and the',
            'operator dashboard at `/dashboard`.',
            '',
            'The WhatsApp channel is simulated: outbound messages are logged (stdout plus',
            '`logs/whatsapp-outbound.log`) instead of being sent to Meta.',
        ].join('\n'),
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: [
        { name: 'Service', description: 'Service index and discovery' },
        { name: 'Health', description: 'Liveness and dependency status' },
        { name: 'Webhook', description: 'WhatsApp Cloud API entry points (Meta payload shape)' },
        { name: 'Simulation', description: 'Demo/test harness that feeds the live pipeline' },
        { name: 'Orders', description: 'Staff order API' },
        { name: 'Tickets', description: 'Staff escalation queue' },
        { name: 'Audit', description: 'Read-only audit trail' },
        { name: 'Metrics', description: 'Dashboard aggregations' },
    ],
    paths: {
        '/': {
            get: {
                tags: ['Service'],
                summary: 'Service index',
                description:
                    'Small signpost for browsers and probes: service name, version and the main ' +
                    'entry points (documentation, dashboard, simulation, health, OpenAPI document).',
                responses: {
                    200: {
                        description: 'Service signpost',
                        ...jsonBody({
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                version: { type: 'string' },
                                documentation: { type: 'string' },
                                dashboard: { type: 'string' },
                                simulation: { type: 'string' },
                                health: { type: 'string' },
                                openapi: { type: 'string' },
                            },
                        }),
                    },
                },
            },
        },
        '/health': {
            get: {
                tags: ['Health'],
                summary: 'Liveness and dependency status',
                description:
                    'Returns 200 for `ok` or `degraded` (AI or notifier down but core works) ' +
                    'and 503 when MongoDB is down.',
                responses: {
                    200: {
                        description: 'Service healthy or degraded',
                        ...jsonBody({ $ref: '#/components/schemas/Health' }),
                    },
                    503: {
                        description: 'MongoDB down',
                        ...jsonBody({ $ref: '#/components/schemas/Health' }),
                    },
                },
            },
        },
        '/webhook': {
            get: {
                tags: ['Webhook'],
                summary: 'Meta verification handshake',
                description:
                    'Echoes back `hub.challenge` when `hub.verify_token` matches the ' +
                    'configured `WHATSAPP_VERIFY_TOKEN`; rejects with 403 otherwise.',
                parameters: [
                    { name: 'hub.mode', in: 'query', schema: { type: 'string', enum: ['subscribe'] } },
                    { name: 'hub.verify_token', in: 'query', schema: { type: 'string' } },
                    { name: 'hub.challenge', in: 'query', schema: { type: 'string' } },
                ],
                responses: {
                    200: {
                        description: 'Challenge echoed back',
                        content: { 'text/plain': { schema: { type: 'string' } } },
                    },
                    403: errorResponse('Verify token mismatch (UNAUTHORIZED)'),
                },
            },
            post: {
                tags: ['Webhook'],
                summary: 'Incoming WhatsApp messages',
                description:
                    'Accepts the Meta Cloud API payload shape, verified with the ' +
                    '`x-hub-signature-256` HMAC over the raw body. Returns 200 immediately and ' +
                    'processes asynchronously; repeat deliveries of the same provider message id ' +
                    'are ignored (failure 2).',
                security: [{ WebhookSignature: [] }],
                requestBody: {
                    required: true,
                    ...jsonBody({ $ref: '#/components/schemas/WebhookPayload' }),
                },
                responses: {
                    200: {
                        description: 'Acknowledged (processing continues in the background)',
                        ...jsonBody({
                            type: 'object',
                            properties: {
                                status: { type: 'string', example: 'received' },
                            },
                        }),
                    },
                    400: errorResponse('Payload validation failed (VALIDATION_ERROR)'),
                    401: errorResponse('Missing or invalid signature (UNAUTHORIZED)'),
                },
            },
        },
        '/simulate/keys': {
            post: {
                tags: ['Simulation'],
                summary: 'Generate a sandbox key for the demo',
                description:
                    'Public and rate-limited (`SANDBOX_KEY_MAX_PER_HOUR` per IP). Returns a new ' +
                    'sandbox key exactly once; use it as `x-api-key`. Requests with it run the ' +
                    'full API against an isolated dataset - live data is never read or written. ' +
                    'Keys (and their data a day later) expire after `SANDBOX_KEY_TTL_HOURS`.',
                responses: {
                    201: {
                        description: 'The new sandbox key (the plaintext `apiKey` is shown once)',
                        ...jsonBody({ $ref: '#/components/schemas/SandboxKey' }),
                    },
                    429: errorResponse('Too many keys requested (RATE_LIMITED)'),
                },
            },
        },
        '/simulate/message': {
            post: {
                tags: ['Simulation'],
                summary: 'Feed a message through the full pipeline',
                description:
                    'Demo and manual-test entry point: awaits processing and returns the ' +
                    'outcome (intent, replies, ticket/order ids). In production the live ' +
                    'staff key gets a 404 (workplan 8.3); generated sandbox keys may always ' +
                    'run it, scoped to their own data (T-021).',
                security: [{ ApiKeyAuth: [] }],
                requestBody: {
                    required: true,
                    ...jsonBody({
                        type: 'object',
                        required: ['from', 'text'],
                        additionalProperties: false,
                        properties: {
                            from: {
                                type: 'string',
                                description: 'Nigerian phone number',
                                example: '+2348012345678',
                            },
                            name: { type: 'string', maxLength: 100 },
                            text: { type: 'string', minLength: 1, maxLength: 1000 },
                            messageId: {
                                type: 'string',
                                description: 'Optional; reuse it to exercise the duplicate path (T6)',
                            },
                            forceLlmFailure: {
                                type: 'boolean',
                                default: false,
                                description:
                                    'Test hook: simulate the LLM being down so the pipeline ' +
                                    'escalates with reason ai_unavailable (failure 1, T8)',
                            },
                        },
                    }),
                },
                responses: {
                    200: {
                        description: 'Processing outcome',
                        ...jsonBody({ $ref: '#/components/schemas/SimulateResponse' }),
                    },
                    400: errorResponse('Validation error (VALIDATION_ERROR)'),
                    401: errorResponse('Missing or invalid x-api-key (UNAUTHORIZED)'),
                    404: errorResponse('Not found (live-key simulation is disabled in production)'),
                    429: errorResponse('Too many requests (RATE_LIMITED)'),
                },
            },
        },
        '/api/orders': {
            get: {
                tags: ['Orders'],
                summary: 'List orders',
                description: 'Newest first, filterable and paginated (workplan 8.6).',
                security: [{ ApiKeyAuth: [] }],
                parameters: [
                    { name: 'status', in: 'query', schema: { type: 'string', enum: ORDER_STATUSES } },
                    { name: 'phone', in: 'query', schema: { type: 'string', maxLength: 20 } },
                    { name: 'from', in: 'query', schema: dateTime },
                    { name: 'to', in: 'query', schema: dateTime },
                    limitParam,
                    pageParam,
                ],
                responses: {
                    200: {
                        description: 'Order page',
                        ...jsonBody({ $ref: '#/components/schemas/OrdersPage' }),
                    },
                    ...staffErrorResponses,
                },
            },
        },
        '/api/orders/{orderId}': {
            parameters: [
                {
                    name: 'orderId',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', example: 'ORD-20261007-0001' },
                },
            ],
            get: {
                tags: ['Orders'],
                summary: 'Order detail',
                security: [{ ApiKeyAuth: [] }],
                responses: {
                    200: { description: 'Order', ...jsonBody({ $ref: '#/components/schemas/Order' }) },
                    404: errorResponse('Unknown order (NOT_FOUND)'),
                    ...staffErrorResponses,
                },
            },
            patch: {
                tags: ['Orders'],
                summary: 'Update order status',
                description:
                    'Enforces the transition table (workplan 8.8); an illegal jump is a 400 ' +
                    'and writes an ORDER_UPDATED audit event.',
                security: [{ ApiKeyAuth: [] }],
                requestBody: {
                    required: true,
                    ...jsonBody({
                        type: 'object',
                        required: ['status'],
                        additionalProperties: false,
                        properties: {
                            status: { type: 'string', enum: ORDER_STATUSES },
                            note: { type: 'string', maxLength: 500 },
                        },
                    }),
                },
                responses: {
                    200: {
                        description: 'Updated order',
                        ...jsonBody({ $ref: '#/components/schemas/Order' }),
                    },
                    400: errorResponse('Illegal status transition (VALIDATION_ERROR)'),
                    404: errorResponse('Unknown order (NOT_FOUND)'),
                    ...staffErrorResponses,
                },
            },
        },
        '/api/tickets': {
            get: {
                tags: ['Tickets'],
                summary: 'List tickets',
                description:
                    'Newest first. `overdue` filters on the derived SLA flag: `true` = only ' +
                    'tickets still `open` past TICKET_SLA_MINUTES, `false` = everything else ' +
                    '(workplan 8.9).',
                security: [{ ApiKeyAuth: [] }],
                parameters: [
                    { name: 'status', in: 'query', schema: { type: 'string', enum: TICKET_STATUSES } },
                    {
                        name: 'priority',
                        in: 'query',
                        schema: { type: 'string', enum: TICKET_PRIORITIES },
                    },
                    { name: 'assignee', in: 'query', schema: { type: 'string', maxLength: 100 } },
                    { name: 'overdue', in: 'query', schema: { type: 'boolean' } },
                    limitParam,
                    pageParam,
                ],
                responses: {
                    200: {
                        description: 'Ticket page',
                        ...jsonBody({ $ref: '#/components/schemas/TicketsPage' }),
                    },
                    ...staffErrorResponses,
                },
            },
        },
        '/api/tickets/{ticketId}': {
            parameters: [
                {
                    name: 'ticketId',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', example: 'TKT-0001' },
                },
            ],
            get: {
                tags: ['Tickets'],
                summary: 'Ticket detail with conversation context',
                description:
                    'The ticket plus the last 20 conversation messages (oldest first) and a ' +
                    '`customer` convenience object for call-backs (workplan 8.10).',
                security: [{ ApiKeyAuth: [] }],
                responses: {
                    200: {
                        description: 'Ticket detail',
                        ...jsonBody({ $ref: '#/components/schemas/TicketDetail' }),
                    },
                    404: errorResponse('Unknown ticket (NOT_FOUND)'),
                    ...staffErrorResponses,
                },
            },
            patch: {
                tags: ['Tickets'],
                summary: 'Update ticket status, assignee or resolution',
                description:
                    'Enforces the transition table (workplan 5.3): open -> assigned -> ' +
                    'in_progress -> resolved, anything -> closed. A repeated status is an ' +
                    'idempotent no-op; `resolutionNote` is required when resolving. Sets ' +
                    '`firstResponseAt` on first assignment and `resolvedAt` on resolve, and ' +
                    'writes a TICKET_UPDATED audit event (workplan 8.11).',
                security: [{ ApiKeyAuth: [] }],
                requestBody: {
                    required: true,
                    ...jsonBody({
                        type: 'object',
                        additionalProperties: false,
                        minProperties: 1,
                        properties: {
                            status: {
                                type: 'string',
                                enum: TICKET_STATUSES.filter((status) => status !== 'open'),
                            },
                            assignee: { type: 'string', maxLength: 100 },
                            resolutionNote: {
                                type: 'string',
                                maxLength: 1000,
                                description: 'Required when status is `resolved`',
                            },
                        },
                    }),
                },
                responses: {
                    200: {
                        description: 'Updated ticket',
                        ...jsonBody({ $ref: '#/components/schemas/Ticket' }),
                    },
                    400: errorResponse('Illegal transition or invalid body (VALIDATION_ERROR)'),
                    404: errorResponse('Unknown ticket (NOT_FOUND)'),
                    ...staffErrorResponses,
                },
            },
        },
        '/api/audit': {
            get: {
                tags: ['Audit'],
                summary: 'Read the audit trail',
                description:
                    'Append-only trail, newest first, cursor-paginated (workplan 8.14). Pass ' +
                    'the returned `nextCursor` back verbatim to fetch the following page. ' +
                    'There are no update or delete routes by design.',
                security: [{ ApiKeyAuth: [] }],
                parameters: [
                    {
                        name: 'type',
                        in: 'query',
                        schema: { type: 'string', enum: AUDIT_EVENT_TYPES },
                    },
                    {
                        name: 'entityType',
                        in: 'query',
                        schema: { type: 'string', enum: AUDIT_ENTITY_TYPES },
                    },
                    { name: 'entityId', in: 'query', schema: { type: 'string', maxLength: 120 } },
                    {
                        name: 'correlationId',
                        in: 'query',
                        schema: { type: 'string', maxLength: 120 },
                    },
                    { name: 'from', in: 'query', schema: dateTime },
                    { name: 'to', in: 'query', schema: dateTime },
                    {
                        name: 'limit',
                        in: 'query',
                        schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
                    },
                    {
                        name: 'cursor',
                        in: 'query',
                        schema: { type: 'string' },
                        description: 'Opaque token from the previous page `nextCursor`',
                    },
                ],
                responses: {
                    200: {
                        description: 'Audit page',
                        ...jsonBody({ $ref: '#/components/schemas/AuditPage' }),
                    },
                    400: errorResponse('Invalid filter or cursor (VALIDATION_ERROR)'),
                    401: errorResponse('Missing or invalid x-api-key (UNAUTHORIZED)'),
                    429: errorResponse('Too many requests (RATE_LIMITED)'),
                },
            },
        },
        '/api/metrics': {
            get: {
                tags: ['Metrics'],
                summary: 'Dashboard aggregations',
                description:
                    'Period figures default to the last 24 hours; `tickets` and ' +
                    '`unresolvedConversations` are live snapshots (workplan 8.15).',
                security: [{ ApiKeyAuth: [] }],
                parameters: [
                    { name: 'from', in: 'query', schema: dateTime },
                    { name: 'to', in: 'query', schema: dateTime },
                ],
                responses: {
                    200: {
                        description: 'Metrics payload',
                        ...jsonBody({ $ref: '#/components/schemas/Metrics' }),
                    },
                    ...staffErrorResponses,
                },
            },
        },
    },
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'x-api-key',
                description: 'Shared staff API key (STAFF_API_KEY) or a generated sandbox key (POST /simulate/keys)',
            },
            WebhookSignature: {
                type: 'apiKey',
                in: 'header',
                name: 'x-hub-signature-256',
                description: 'HMAC-SHA256 of the raw body, keyed with the app secret',
            },
        },
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    error: {
                        type: 'object',
                        properties: {
                            code: {
                                type: 'string',
                                example: 'VALIDATION_ERROR',
                                enum: [
                                    'VALIDATION_ERROR',
                                    'UNAUTHORIZED',
                                    'NOT_FOUND',
                                    'RATE_LIMITED',
                                    'INTERNAL_ERROR',
                                    'DEPENDENCY_UNAVAILABLE',
                                ],
                            },
                            message: { type: 'string' },
                            details: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        path: { type: 'string' },
                                        message: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    correlationId: { type: 'string' },
                },
            },
            Health: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
                    uptimeSec: { type: 'integer', example: 3600 },
                    checks: {
                        type: 'object',
                        properties: {
                            mongo: { type: 'string', enum: ['up', 'down'] },
                            llm: { type: 'string', enum: ['up', 'down', 'disabled'] },
                            notifier: { type: 'string', enum: ['up', 'down', 'disabled'] },
                        },
                    },
                    version: { type: 'string', example: '1.0.0' },
                },
            },
            WebhookPayload: {
                type: 'object',
                description:
                    'Meta WhatsApp Cloud API webhook payload; messages are read from ' +
                    '`entry[].changes[].value.messages[]`',
                properties: {
                    object: { type: 'string', example: 'whatsapp_business_account' },
                    entry: { type: 'array', items: { type: 'object' } },
                },
            },
            SimulateResponse: {
                type: 'object',
                properties: {
                    correlationId: { type: 'string' },
                    duplicate: {
                        type: 'boolean',
                        description: 'True when the messageId had already been processed',
                    },
                    intent: { type: 'string', nullable: true, enum: LLM_INTENTS },
                    confidence: { type: 'number', nullable: true, minimum: 0, maximum: 1 },
                    classifierSource: {
                        type: 'string',
                        nullable: true,
                        enum: ['rules', 'llm', 'fallback'],
                    },
                    replies: { type: 'array', items: { type: 'string' } },
                    conversation: {
                        type: 'object',
                        nullable: true,
                        description: 'Conversation state snapshot returned by the pipeline',
                    },
                    ticketId: {
                        type: 'string',
                        nullable: true,
                        description: 'Set when the message escalated to a ticket',
                        example: 'TKT-0001',
                    },
                    orderId: {
                        type: 'string',
                        nullable: true,
                        description: 'Set when the message completed an order',
                        example: 'ORD-20261007-0001',
                    },
                },
            },
            SandboxKey: {
                type: 'object',
                description: 'A generated sandbox key; the same schema is accepted as x-api-key',
                properties: {
                    apiKey: {
                        type: 'string',
                        description:
                            'The plaintext key - shown only in this response; only its hash is stored',
                        example: 'lfm_sim_ExampleKeyMaterial',
                    },
                    keyPrefix: {
                        type: 'string',
                        description: 'Display-only prefix for logs and support',
                        example: 'lfm_sim_Example',
                    },
                    sandboxId: {
                        type: 'string',
                        description: 'Scope stamped on every document the key creates',
                    },
                    expiresAt: { type: 'string', format: 'date-time' },
                    note: { type: 'string' },
                },
            },
            Order: {
                type: 'object',
                properties: {
                    orderId: { type: 'string', example: 'ORD-20261007-0001' },
                    status: { type: 'string', enum: ORDER_STATUSES },
                    totalNGN: { type: 'number', example: 12500 },
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                sku: { type: 'string', example: 'RICE-5KG' },
                                name: { type: 'string', example: 'Rice 5kg' },
                                quantity: { type: 'integer', example: 2 },
                                unitPriceNGN: { type: 'number', example: 6250 },
                            },
                        },
                    },
                    deliveryAddress: { type: 'string', example: '12 Adeola Odeku St, Victoria Island' },
                    contactPhone: { type: 'string', example: '+2348012345678' },
                    conversationId: { type: 'string', nullable: true },
                    createdAt: dateTime,
                    updatedAt: dateTime,
                },
            },
            OrdersPage: {
                type: 'object',
                properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 20 },
                    total: { type: 'integer', example: 7 },
                },
            },
            Ticket: {
                type: 'object',
                properties: {
                    ticketId: { type: 'string', example: 'TKT-0001' },
                    reason: { type: 'string', enum: TICKET_REASONS },
                    priority: { type: 'string', enum: TICKET_PRIORITIES },
                    status: { type: 'string', enum: TICKET_STATUSES },
                    assignee: { type: 'string', nullable: true, example: null },
                    summary: {
                        type: 'string',
                        example: 'My item came damaged, I want a refund',
                    },
                    notificationStatus: {
                        type: 'string',
                        enum: TICKET_NOTIFICATION_STATUSES,
                        description: 'Outcome of the WhatsApp staff alert (failure 4)',
                    },
                    overdue: {
                        type: 'boolean',
                        description: 'Derived: still open past TICKET_SLA_MINUTES (workplan 5.3)',
                    },
                    resolutionNote: { type: 'string', nullable: true },
                    firstResponseAt: { ...dateTime, nullable: true },
                    resolvedAt: { ...dateTime, nullable: true },
                    conversationId: { type: 'string', nullable: true },
                    customerId: { type: 'string', nullable: true },
                    createdAt: dateTime,
                },
            },
            TicketsPage: {
                type: 'object',
                properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 20 },
                    total: { type: 'integer', example: 1 },
                },
            },
            TicketDetail: {
                allOf: [
                    { $ref: '#/components/schemas/Ticket' },
                    {
                        type: 'object',
                        properties: {
                            customer: {
                                type: 'object',
                                nullable: true,
                                description: 'Additive convenience field for call-backs',
                                properties: {
                                    phone: { type: 'string', example: '+2348012345678' },
                                    name: { type: 'string', nullable: true },
                                },
                            },
                            conversation: {
                                type: 'array',
                                description: 'Last 20 conversation messages, oldest first',
                                items: { $ref: '#/components/schemas/Message' },
                            },
                        },
                    },
                ],
            },
            Message: {
                type: 'object',
                properties: {
                    direction: { type: 'string', enum: ['inbound', 'outbound'] },
                    text: { type: 'string' },
                    intent: { type: 'string', nullable: true, enum: LLM_INTENTS },
                    confidence: { type: 'number', nullable: true, minimum: 0, maximum: 1 },
                    classifierSource: {
                        type: 'string',
                        nullable: true,
                        enum: ['rules', 'llm', 'fallback'],
                    },
                    createdAt: dateTime,
                },
            },
            AuditEvent: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: AUDIT_EVENT_TYPES },
                    correlationId: { type: 'string' },
                    entityType: { type: 'string', enum: AUDIT_ENTITY_TYPES },
                    entityId: { type: 'string', nullable: true },
                    actor: { type: 'string', enum: ['system', 'customer'] },
                    detail: { type: 'object' },
                    createdAt: dateTime,
                },
            },
            AuditPage: {
                type: 'object',
                properties: {
                    data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/AuditEvent' },
                    },
                    nextCursor: {
                        type: 'string',
                        nullable: true,
                        description: 'Pass back as `?cursor=` for the next page; null on the last page',
                    },
                },
            },
            Metrics: {
                type: 'object',
                properties: {
                    period: {
                        type: 'object',
                        properties: { from: dateTime, to: dateTime },
                    },
                    totalMessages: { type: 'integer', example: 120 },
                    totalConversations: { type: 'integer', example: 48 },
                    intentBreakdown: {
                        type: 'object',
                        description: 'Inbound messages classified in the window, per intent',
                        additionalProperties: { type: 'integer' },
                        example: {
                            product_enquiry: 14,
                            price_check: 18,
                            place_order: 9,
                            order_status: 5,
                            complaint_or_refund: 2,
                            unknown: 0,
                        },
                    },
                    classifier: {
                        type: 'object',
                        properties: {
                            rules: { type: 'integer' },
                            llm: { type: 'integer' },
                            fallback: {
                                type: 'integer',
                                description: 'CLASSIFIER_FALLBACK events (failure 1)',
                            },
                        },
                    },
                    ordersCreated: { type: 'integer', example: 7 },
                    escalationRate: {
                        type: 'number',
                        example: 0.1,
                        description: 'Tickets created / conversations with activity in the window',
                    },
                    tickets: {
                        type: 'object',
                        description: 'Live snapshot, not period-scoped',
                        properties: {
                            open: { type: 'integer' },
                            assigned: { type: 'integer' },
                            in_progress: { type: 'integer' },
                            resolved: { type: 'integer' },
                            closed: { type: 'integer' },
                            overdue: {
                                type: 'integer',
                                description: 'Open past TICKET_SLA_MINUTES (failure 4 flag)',
                            },
                        },
                    },
                    unresolvedConversations: {
                        type: 'integer',
                        description: 'Live snapshot of active, non-terminal conversations',
                    },
                    avgAutoResponseMs: { type: 'integer', example: 640 },
                    avgFirstHumanResponseMin: { type: 'number', example: 9.5 },
                    failures: {
                        type: 'object',
                        properties: {
                            duplicatesIgnored: { type: 'integer' },
                            llmFailures: { type: 'integer' },
                            notificationFailures: { type: 'integer' },
                            validationRetries: { type: 'integer' },
                        },
                    },
                },
            },
        },
    },
};

export default document;
