import mongoose from 'mongoose';

/**
 * Catalogue product.
 *
 * `aliases` holds the free-text names customers use on WhatsApp
 * (e.g. "bag of rice"), which the classifier matches against.
 */
const productSchema = new mongoose.Schema(
    {
        sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
        name: { type: String, required: true, trim: true },
        aliases: { type: [String], default: [] },
        category: { type: String, required: true, trim: true, index: true },
        priceNGN: { type: Number, required: true, min: 0 },
        stock: { type: Number, required: true, min: 0, default: 0 },
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
);

productSchema.index({ name: 'text', aliases: 'text' });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
