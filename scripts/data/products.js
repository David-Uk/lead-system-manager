/**
 * Synthetic catalogue for Lagos Fresh Mart.
 *
 * All prices are in NGN and all data is fictional (assessment requirement:
 * synthetic data only). The seed script upserts this list by SKU.
 */
export const products = [
    // Grains & staples
    { sku: 'RICE-5KG', name: 'Rice 5kg', aliases: ['rice', 'bag of rice', 'local rice', 'ofada rice'], category: 'Grains', priceNGN: 8500, stock: 40 },
    { sku: 'RICE-10KG', name: 'Rice 10kg', aliases: ['rice 10kg', 'big bag of rice'], category: 'Grains', priceNGN: 16000, stock: 25 },
    { sku: 'RICE-25KG', name: 'Rice 25kg', aliases: ['rice 25kg', 'whole bag of rice'], category: 'Grains', priceNGN: 38500, stock: 12 },
    { sku: 'BEANS-1KG', name: 'Beans 1kg', aliases: ['beans', 'black eyed beans', 'honey beans'], category: 'Grains', priceNGN: 1200, stock: 60 },
    { sku: 'BEANS-5KG', name: 'Beans 5kg', aliases: ['bag of beans', 'beans 5kg'], category: 'Grains', priceNGN: 5600, stock: 30 },
    { sku: 'GARRI-5KG', name: 'Garri 5kg', aliases: ['garri', 'cassava flakes', 'eba'], category: 'Grains', priceNGN: 2500, stock: 55 },
    { sku: 'SEMO-1KG', name: 'Semolina 1kg', aliases: ['semo', 'semolina'], category: 'Grains', priceNGN: 1400, stock: 45 },
    { sku: 'SPAGHETTI-5PACK', name: 'Spaghetti (pack of 5)', aliases: ['spaghetti', 'pasta', 'noodles'], category: 'Grains', priceNGN: 2800, stock: 70 },

    // Proteins
    { sku: 'EGGS-CRATE', name: 'Eggs (crate of 30)', aliases: ['eggs', 'egg crate', 'crate of eggs'], category: 'Proteins', priceNGN: 3200, stock: 35 },
    { sku: 'CHICKEN-1KG', name: 'Chicken 1kg', aliases: ['chicken', 'frozen chicken'], category: 'Proteins', priceNGN: 4500, stock: 20 },
    { sku: 'TITUS-FISH-1KG', name: 'Titus Fish 1kg', aliases: ['fish', 'titus fish', 'frozen fish'], category: 'Proteins', priceNGN: 5200, stock: 18 },
    { sku: 'TURKEY-WINGS-1KG', name: 'Turkey Wings 1kg', aliases: ['turkey', 'turkey wings'], category: 'Proteins', priceNGN: 6000, stock: 10 },

    // Tubers & fresh produce
    { sku: 'YAM-TUBER', name: 'Yam (per tuber)', aliases: ['yam', 'tuber of yam', 'iyan'], category: 'Tubers', priceNGN: 3000, stock: 50 },
    { sku: 'POTATO-1KG', name: 'Irish Potatoes 1kg', aliases: ['potatoes', 'irish potatoes'], category: 'Tubers', priceNGN: 1800, stock: 40 },
    { sku: 'TOMATO-BASKET', name: 'Tomatoes (basket)', aliases: ['tomatoes', 'tomato basket'], category: 'Fresh', priceNGN: 12000, stock: 8 },
    { sku: 'PEPPER-BASKET', name: 'Pepper (basket)', aliases: ['pepper', 'atarodo', 'shombo'], category: 'Fresh', priceNGN: 9000, stock: 10 },
    { sku: 'ONIONS-1KG', name: 'Onions 1kg', aliases: ['onions', 'alubosa'], category: 'Fresh', priceNGN: 1500, stock: 45 },

    // Oils & condiments
    { sku: 'PALMOIL-1L', name: 'Palm Oil 1L', aliases: ['palm oil', 'red oil'], category: 'Oils', priceNGN: 2800, stock: 42 },
    { sku: 'VEGOIL-2L', name: 'Vegetable Oil 2L', aliases: ['vegetable oil', 'groundnut oil', 'cooking oil'], category: 'Oils', priceNGN: 6500, stock: 30 },
    { sku: 'MAGGI-CARTON', name: 'Maggi Cubes (carton)', aliases: ['maggi', 'stock cubes', 'seasoning'], category: 'Condiments', priceNGN: 7800, stock: 15 },
    { sku: 'SALT-1KG', name: 'Salt 1kg', aliases: ['salt'], category: 'Condiments', priceNGN: 700, stock: 80 },
    { sku: 'CURRY-PACK', name: 'Curry Powder (pack)', aliases: ['curry'], category: 'Condiments', priceNGN: 900, stock: 65 },
    { sku: 'TOMATOPASTE-PACK', name: 'Tomato Paste (pack)', aliases: ['tomato paste', 'tinned tomato'], category: 'Condiments', priceNGN: 800, stock: 75 },

    // Beverages
    { sku: 'PEAK-MILK-TIN', name: 'Peak Milk (tin)', aliases: ['milk', 'peak milk', 'peak'], category: 'Beverages', priceNGN: 2500, stock: 40 },
    { sku: 'BOURNVITA-500G', name: 'Bournvita 500g', aliases: ['bournvita', 'chocolate drink'], category: 'Beverages', priceNGN: 3200, stock: 28 },
    { sku: 'COKE-CRATE', name: 'Coca-Cola (crate of 12)', aliases: ['coke', 'coca cola', 'soft drink', 'minerals'], category: 'Beverages', priceNGN: 4800, stock: 22 },
    { sku: 'WATER-PACK', name: 'Bottled Water (pack of 12)', aliases: ['water', 'bottled water'], category: 'Beverages', priceNGN: 1800, stock: 60 },

    // Household
    { sku: 'DETERGENT-1KG', name: 'Washing Powder 1kg', aliases: ['detergent', 'washing powder', 'omo'], category: 'Household', priceNGN: 1700, stock: 50 },
    { sku: 'BARSOAP-4PACK', name: 'Bar Soap (pack of 4)', aliases: ['soap', 'bar soap'], category: 'Household', priceNGN: 2200, stock: 44 },
    { sku: 'TISSUE-10PACK', name: 'Tissue Paper (pack of 10)', aliases: ['tissue', 'toilet roll', 'toilet paper'], category: 'Household', priceNGN: 2600, stock: 38 },

    // Demo picks - branded or prepared items with colloquial aliases. These
    // exist so demo messages (and the /simulate workbench scenarios) always
    // hit catalogue-backed answers: the rules classifier matches the aliases
    // and the price/enquiry/order handlers resolve them to a SKU.
    { sku: 'SARDINE-TIN', name: 'Sardine (tin)', aliases: ['sardine', 'tinned sardine', 'geisha'], category: 'Proteins', priceNGN: 1900, stock: 48 },
    { sku: 'STOCKFISH-1KG', name: 'Stockfish 1kg', aliases: ['stockfish', 'okporoko'], category: 'Proteins', priceNGN: 7400, stock: 14 },
    { sku: 'CRAYFISH-500G', name: 'Crayfish 500g', aliases: ['crayfish', 'ground crayfish'], category: 'Condiments', priceNGN: 3600, stock: 35 },
    { sku: 'EGUSI-1KG', name: 'Egusi Seeds 1kg', aliases: ['egusi', 'melon seeds'], category: 'Condiments', priceNGN: 4200, stock: 25 },
    { sku: 'HONEY-500ML', name: 'Pure Honey 500ml', aliases: ['honey', 'pure honey'], category: 'Condiments', priceNGN: 4500, stock: 30 },
    { sku: 'SUGAR-2KG', name: 'Sugar 2kg', aliases: ['sugar', 'granulated sugar'], category: 'Condiments', priceNGN: 3200, stock: 40 },
    { sku: 'MARGARINE-250G', name: 'Blue Band Margarine 250g', aliases: ['margarine', 'blue band', 'butter'], category: 'Condiments', priceNGN: 2100, stock: 44 },
    { sku: 'MILO-500G', name: 'Milo 500g', aliases: ['milo', 'milo tin'], category: 'Beverages', priceNGN: 3800, stock: 26 },
    { sku: 'GOLDENMORN-1KG', name: 'Golden Morn 1kg', aliases: ['golden morn', 'goldenmorn'], category: 'Beverages', priceNGN: 4600, stock: 20 },
    { sku: 'LIPTON-50BAGS', name: 'Lipton Tea (50 bags)', aliases: ['lipton', 'tea bags', 'green tea'], category: 'Beverages', priceNGN: 2900, stock: 32 },
    { sku: 'FLOUR-2KG', name: 'Wheat Flour 2kg', aliases: ['flour', 'wheat flour', 'baking flour'], category: 'Grains', priceNGN: 3500, stock: 36 },
    { sku: 'INDOMIE-CARTON', name: 'Indomie Noodles (carton of 40)', aliases: ['indomie', 'instant noodles', 'noodles carton'], category: 'Grains', priceNGN: 6800, stock: 18 },
];
