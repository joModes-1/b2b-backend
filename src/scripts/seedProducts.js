require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const Product = require('../models/Product');
const User = require('../models/User');

const seedDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected for seeding...');

        // 1. Read the JSON file
        const jsonPath = path.resolve(__dirname, '../../demo_products.json');
        const jsonData = await fs.readFile(jsonPath, 'utf-8');
        const demoProducts = JSON.parse(jsonData);
        console.log(`Found ${demoProducts.length} products in demo_products.json`);

        // 2. Find all sellers from the DB to create a map
        const sellers = await User.find({ role: 'seller' });
        const sellerMap = sellers.reduce((map, seller) => {
            // Use email as the key, which corresponds to 'seller' in the JSON
            if (seller.email) {
                map[seller.email] = seller._id;
            }
            return map;
        }, {});
        console.log('Found sellers in DB:', Object.keys(sellerMap).join(', '));

        // 3. Prepare products for insertion
        const productsToInsert = [];
        for (const productData of demoProducts) {
            const sellerId = sellerMap[productData.seller];
            if (sellerId) {
                productsToInsert.push({
                    ...productData,
                    seller: sellerId, // Replace company name with ObjectId
                    images: [{ url: productData.image, public_id: `demo_${Date.now()}` }] // Adapt image field
                });
            } else {
                console.warn(`WARNING: Seller with email "${productData.seller}" not found for product "${productData.name}". Skipping.`);
            }
        }

        // 4. Insert new products without deleting old ones
        if (productsToInsert.length > 0) {
            await Product.insertMany(productsToInsert);
            console.log(`Successfully inserted ${productsToInsert.length} new products.`);
        } else {
            console.log('No new products were inserted.');
        }

    } catch (err) {
        console.error('Error seeding database:', err);
    } finally {
        mongoose.disconnect();
        console.log('MongoDB disconnected.');
    }
};

seedDB();
