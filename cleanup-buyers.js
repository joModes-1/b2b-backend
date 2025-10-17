const mongoose = require('mongoose');
require('dotenv').config();

async function cleanupBuyers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/b2b-platform');
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // Remove businessLocation from ALL buyers
    console.log('Removing businessLocation from all buyers...');
    const result = await collection.updateMany(
      { role: 'buyer' },
      { $unset: { businessLocation: 1 } }
    );
    console.log(`Updated ${result.modifiedCount} buyers`);

    await mongoose.connection.close();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

cleanupBuyers();
