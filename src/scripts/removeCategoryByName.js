require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Category = require('../models/Category');

async function run() {
  const name = process.argv.slice(2).join(' ').trim();
  if (!name) {
    console.error('Usage: node src/scripts/removeCategoryByName.js <Category Name>');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected...');

    const cat = await Category.findOne({ name });
    if (!cat) {
      console.log(`Category "${name}" not found.`);
      return;
    }

    await Category.deleteOne({ _id: cat._id });
    console.log(`Deleted category: ${name}`);
  } catch (err) {
    console.error('Error deleting category:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

run();
