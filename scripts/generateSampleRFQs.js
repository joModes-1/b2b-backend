const mongoose = require('mongoose');
const RFQ = require('../models/RFQ');
const User = require('../models/User');
require('dotenv').config();

const categories = ['Electronics', 'Industrial', 'Office Supplies', 'Raw Materials'];
const statuses = ['pending', 'approved', 'rejected', 'fulfilled'];

const sampleSpecs = {
  Electronics: {
    'Processor': ['Intel i7', 'AMD Ryzen 9', 'Intel i5'],
    'RAM': ['16GB', '32GB', '64GB'],
    'Storage': ['512GB SSD', '1TB SSD', '2TB HDD'],
    'Display': ['15.6" 4K', '14" FHD', '13.3" Retina']
  },
  Industrial: {
    'Power Rating': ['1000W', '2000W', '5000W'],
    'Material': ['Stainless Steel', 'Aluminum', 'Carbon Steel'],
    'Safety Rating': ['IP65', 'IP67', 'IP68'],
    'Certification': ['ISO 9001', 'CE', 'UL']
  },
  'Office Supplies': {
    'Paper Size': ['A4', 'Letter', 'Legal'],
    'Paper Weight': ['20lb', '24lb', '28lb'],
    'Color': ['White', 'Ivory', 'Recycled'],
    'Quantity per Pack': ['500', '1000', '2000']
  },
  'Raw Materials': {
    'Grade': ['A', 'B', 'C'],
    'Purity': ['99.9%', '99.99%', '99.999%'],
    'Form': ['Powder', 'Liquid', 'Solid'],
    'Packaging': ['25kg', '50kg', '100kg']
  }
};

const generateRandomSpecs = (category) => {
  const specs = {};
  const categorySpecs = sampleSpecs[category];
  
  Object.keys(categorySpecs).forEach(key => {
    if (Math.random() > 0.3) { // 70% chance to include each spec
      specs[key] = categorySpecs[key][Math.floor(Math.random() * categorySpecs[key].length)];
    }
  });
  
  return specs;
};

const generateSampleRFQs = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all buyer users
    const buyers = await User.find({ role: 'buyer' });
    if (buyers.length === 0) {
      console.log('No buyer users found. Please create some buyer accounts first.');
      return;
    }

    // Generate 20 sample RFQs
    const rfqs = [];
    for (let i = 0; i < 20; i++) {
      const category = categories[Math.floor(Math.random() * categories.length)];
      const buyer = buyers[Math.floor(Math.random() * buyers.length)];
      
      rfqs.push({
        buyerId: buyer._id,
        title: `${category} RFQ #${i + 1}`,
        description: `Looking for high-quality ${category.toLowerCase()} products. Need them within 2 weeks. Please provide detailed specifications and pricing.`,
        category,
        productSpecs: generateRandomSpecs(category),
        quantity: Math.floor(Math.random() * 1000) + 1,
        budget: Math.floor(Math.random() * 10000) + 1000,
        status: statuses[Math.floor(Math.random() * statuses.length)],
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000) // Random date within last 30 days
      });
    }

    // Insert RFQs
    await RFQ.insertMany(rfqs);
    console.log('Successfully generated 20 sample RFQs');

  } catch (error) {
    console.error('Error generating sample RFQs:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

generateSampleRFQs(); 