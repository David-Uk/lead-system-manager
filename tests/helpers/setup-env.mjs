/**
 * Test environment bootstrap. Must be the FIRST import in every test file so
 * these values are in place before any src/ module is evaluated (ESM evaluates
 * static imports in declaration order).
 *
 * These values win over the developer's .env file because dotenv never
 * overrides variables that already exist in process.env.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/placeholder';
process.env.STAFF_API_KEY = 'test-staff-key';
process.env.WHATSAPP_MODE = 'simulated';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_FORCE_SEND_FAILURE = 'false';
process.env.LLM_PROVIDER = 'none';
process.env.TICKET_SLA_MINUTES = '15';
process.env.STAFF_WHATSAPP_NUMBER = '+2348000000000';
