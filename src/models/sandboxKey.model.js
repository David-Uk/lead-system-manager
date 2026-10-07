import mongoose from 'mongoose';

/**
 * Generated sandbox access key (simulation, workplan 8.3 + T-021).
 *
 * Demo visitors mint one through POST /simulate/keys and use it as
 * `x-api-key`. Only the SHA-256 hash is stored: the plaintext key exists
 * exactly once, in the creation response. The TTL index retires keys at
 * `expiresAt`; `resolveSandboxKey` also checks the date explicitly because
 * Mongo's TTL sweep is not immediate.
 */
const sandboxKeySchema = new mongoose.Schema(
    {
        keyHash: { type: String, required: true, unique: true },
        // Display-only prefix, e.g. "lfm_sim_Ab12Cd34".
        keyPrefix: { type: String, required: true },
        // Isolation scope: every document a request creates is tagged with it.
        sandboxId: { type: String, required: true, index: true },
        createdByIp: { type: String, default: null },
        lastUsedAt: { type: Date, default: null },
        uses: { type: Number, default: 0, min: 0 },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

// Keys disappear on their own; sandbox documents expire a day later (see
// the sandbox scoping plugin) so an in-flight demo never loses its data.
sandboxKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const SandboxKey =
    mongoose.models.SandboxKey || mongoose.model('SandboxKey', sandboxKeySchema);
