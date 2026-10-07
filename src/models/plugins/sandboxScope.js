import { currentSandbox } from '../../utils/sandboxContext.js';

/**
 * Sandbox scoping plugin for the business models (Customer, Conversation,
 * Message, Order, Ticket, AuditEvent).
 *
 * Requests authenticated with a generated sandbox key run with an
 * AsyncLocalStorage context carrying their `sandboxId` (see
 * src/utils/sandboxContext.js). This plugin makes every operation on a
 * scoped model obey that context:
 *
 * - reads, counts, distincts, updates and deletes get `{ sandbox: <id> }`
 *   merged into the filter - or `{ sandbox: null }` outside any sandbox
 *   (staff requests, webhook, tests, seeds);
 * - inserts (`save`, `insertMany`, upsert inserts) are tagged with the
 *   sandbox id, so live documents simply never carry the field;
 * - aggregation pipelines get a leading `$match` stage.
 *
 * `{ sandbox: null }` matches documents where the field is missing, so the
 * live queries keep their exact pre-sandbox semantics. Product is
 * deliberately NOT scoped: the catalogue is shared reference data, and
 * sandbox order flows read the same seeded products as live ones.
 */

/** Filter that a query must satisfy in the current context. */
const scopeFilter = () => ({ sandbox: currentSandbox()?.sandboxId ?? null });

/** Query middleware body shared by every scoped query operation. */
function applyScope() {
    // A caller that explicitly constrains `sandbox` (tests, maintenance
    // scripts inspecting one scope) owns the scope for that query; service
    // code never does, so it always inherits the request context.
    if (this.getFilter().sandbox === undefined) {
        this.where(scopeFilter());
    }

    // findOneAndUpdate upserts insert a new document without running the
    // `save` hook, so tag the insert here (customer upsert is the hot path).
    const context = currentSandbox();
    if (context && this.getOptions().upsert) {
        const update = this.getUpdate() ?? {};
        update.$setOnInsert = {
            ...(update.$setOnInsert ?? {}),
            sandbox: context.sandboxId,
            sandboxExpiresAt: context.expiresAt,
        };
        this.setUpdate(update);
    }
}

/** Document middleware body for freshly created documents. */
function tagDocument(doc) {
    const context = currentSandbox();
    if (!context) return;
    if (doc.sandbox == null) doc.sandbox = context.sandboxId;
    if (doc.sandboxExpiresAt == null) doc.sandboxExpiresAt = context.expiresAt;
}

export function sandboxScoped(schema) {
    schema.add({
        sandbox: { type: String },
        // TTL anchor for sandbox documents: Mongo purges them once past the
        // key's expiry (plus a grace period). Live documents leave it unset
        // and are never touched by the TTL monitor.
        sandboxExpiresAt: { type: Date },
    });

    schema.pre(/^find/, applyScope);
    schema.pre('countDocuments', applyScope);
    schema.pre('distinct', applyScope);
    schema.pre('updateOne', applyScope);
    schema.pre('updateMany', applyScope);
    schema.pre('replaceOne', applyScope);
    schema.pre('deleteOne', applyScope);
    schema.pre('deleteMany', applyScope);

    schema.pre('aggregate', function () {
        this.pipeline().unshift({ $match: scopeFilter() });
    });

    schema.pre('insertMany', function (next, docs) {
        for (const doc of docs) tagDocument(doc);
        next();
    });

    schema.pre('save', function () {
        if (this.isNew) tagDocument(this);
    });
}
