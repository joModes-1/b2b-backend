const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Product = require('./src/models/Product');
const User = require('./src/models/User');

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
