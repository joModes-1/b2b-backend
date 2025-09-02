const mongoose = require('mongoose');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Product = require('./src/models/Product');
const User = require('./src/models/User');
const Category = require('./src/models/Category');

// --- Database Connection ---
const dbURI = process.env.MONGODB_URI;

if (!dbURI) {
  console.error('FATAL ERROR: MONGODB_URI is not defined in environment variables.');
  process.exit(1);
}

mongoose.connect(dbURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected successfully.'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit if cannot connect
  });

// --- Data Seeding Logic ---
async function seedDatabase() {
  try {
    // 0. Seed Categories and Subcategories (idempotent upsert)
    const categoriesData = [
      {
        _id: 'cat1',
        name: 'Food & Beverages (Grains & Cereals Focus)',
        subcategories: [
          { _id: 'sub1-1', name: 'Grains & Cereals' },
          { _id: 'sub1-2', name: 'Sugar & Sweeteners' },
          { _id: 'sub1-3', name: 'Cooking Oils & Fats' },
        ],
      },
      {
        _id: 'cat2',
        name: 'Health & Personal Care',
        subcategories: [
          { _id: 'sub2-1', name: 'Personal Hygiene' },
          { _id: 'sub2-2', name: 'Beauty & Skincare' },
          { _id: 'sub2-3', name: 'Hair Care' },
          { _id: 'sub2-4', name: 'Health & Wellness' },
        ],
      },
      {
        _id: 'cat3',
        name: 'Baby & Kids Products',
        subcategories: [
          { _id: 'sub3-1', name: 'Baby Food & Formula' },
          { _id: 'sub3-2', name: 'Baby Diapers & Wipes' },
          { _id: 'sub3-3', name: 'Baby Toiletries' },
          { _id: 'sub3-4', name: 'Baby Clothing & Footwear' },
          { _id: 'sub3-5', name: 'Baby Accessories' },
        ],
      },
    ];

    console.log('Upserting categories...');
    await Category.bulkWrite(
      categoriesData.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { name: c.name, subcategories: c.subcategories } },
          upsert: true,
        },
      }))
    );
    console.log(`Categories upserted: ${categoriesData.length}`);

    // 1. Find a default seller
    const defaultSeller = await User.findOne({ role: 'seller' });
    if (!defaultSeller) {
      console.error('Error: No seller found in the database.');
      console.log('Please create a seller user before running the seed script.');
      return;
    }
    console.log(`Found default seller: ${defaultSeller.name}`);

    // 2. Read and parse the demo products JSON file
    const jsonPath = path.join(__dirname, '..', 'demo_products.json');
    if (!fs.existsSync(jsonPath)) {
        console.error(`Error: demo_products.json not found at ${jsonPath}`);
        console.log('Please make sure the demo_products.json file is in the root directory of the project.');
        return;
    }
    const demoProducts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    // 3. Transform demo data to match the Product schema
    const transformedProducts = demoProducts.map((p, index) => ({
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category,
      district: p.district,
      seller: defaultSeller._id, // Assign the found seller's ID
      stock: 100, // Assign a default stock value
      images: p.image ? [{ url: p.image, public_id: `demo_${index}` }] : [],
      specifications: { 'Demo Spec': 'Value' }, // Add placeholder specs
      features: ['Demo Feature'], // Add placeholder features
      status: 'active',
    }));

    // 4. Clear existing products and insert new data
    console.log('Clearing existing products...');
    await Product.deleteMany({});
    console.log('Inserting new demo products...');
    await Product.insertMany(transformedProducts);

    console.log(`✅ Success! Inserted ${transformedProducts.length} demo products.`);

  } catch (error) {
    console.error('An error occurred during the seeding process:', error);
  } finally {
    // 5. Close the database connection
    mongoose.connection.close();
    console.log('MongoDB connection closed.');
  }
}

seedDatabase();
