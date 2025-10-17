require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');

// Names of demo products seeded earlier
const DEMO_PRODUCT_NAMES = [
  'Samsung Galaxy S24 Ultra',
  'MacBook Pro M3',
  'iPad Air 5th Gen',
  'Premium Cotton T-Shirt',
  'Designer Jeans',
  'Running Sneakers',
  'Modern Sofa Set',
  'Kitchen Blender',
  'Car Dashboard Camera',
  'Premium Car Tires',
  'Vitamin C Serum',
  'Multivitamin Supplements',
  'Yoga Mat Premium',
  'Camping Tent 4-Person',
  'Programming Fundamentals',
  'Business Strategy Book',
  'Educational Building Blocks',
  'Strategy Board Game',
];

// Categories created by seeder (case-sensitive names)
const DEMO_CATEGORY_NAMES = [
  'Electronics',
  'Fashion & Clothing',
  'Home & Garden',
  'Automotive',
  'Health & Beauty',
  'Sports & Outdoors',
  'Books & Education',
  'Toys & Games',
];

// Helper: Optional seller filter; if you want to restrict deletions to one seller
const SELLER_EMAIL = 'modes13@gmail.com'; // Adjust if needed

async function run() {
  const REMOVE_CATEGORIES = process.argv.includes('--remove-categories');
  const APPLY = process.argv.includes('--apply');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected...');

    let sellerFilter = {};
    try {
      const seller = await User.findOne({ email: SELLER_EMAIL });
      if (seller) {
        sellerFilter = { seller: seller._id };
        console.log(`Restricting deletion to seller: ${SELLER_EMAIL}`);
      } else {
        console.log(`Seller with email ${SELLER_EMAIL} not found. Proceeding without seller restriction.`);
      }
    } catch (e) {
      console.log('Could not resolve seller filter, proceeding without it.');
    }

    // Build a conservative filter to target demo data
    const productFilter = {
      $and: [
        sellerFilter,
        {
          $or: [
            { name: { $in: DEMO_PRODUCT_NAMES } },
            { 'images.public_id': { $in: ['preset', 'placeholder'] } },
            { 'images.url': /placeholder-image\.svg$/ },
          ],
        },
      ].filter(Boolean),
    };

    const demoProducts = await Product.find(productFilter).lean();
    console.log(`Found ${demoProducts.length} demo products to delete.`);

    if (demoProducts.length > 0) {
      const ids = demoProducts.map((p) => p._id);
      if (APPLY) {
        await Product.deleteMany({ _id: { $in: ids } });
        console.log(`Deleted ${ids.length} demo products.`);
      } else {
        console.log('Dry run (no deletions). Re-run with --apply to delete.');
      }
    }

    if (REMOVE_CATEGORIES) {
      // Remove demo categories that now have zero products
      const categories = await Category.find({ name: { $in: DEMO_CATEGORY_NAMES } });
      let removed = 0;
      for (const cat of categories) {
        const count = await Product.countDocuments({ category: cat.name });
        if (count === 0) {
          if (APPLY) {
            await Category.deleteOne({ _id: cat._id });
            removed += 1;
            console.log(`Removed empty category: ${cat.name}`);
          } else {
            console.log(`[Dry run] Would remove empty category: ${cat.name}`);
          }
        } else {
          console.log(`Category ${cat.name} has ${count} products. Keeping.`);
        }
      }
      if (APPLY) console.log(`Removed ${removed} categories.`);
    }

    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Error during cleanup:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

run();
