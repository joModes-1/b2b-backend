const mongoose = require('mongoose');
require('dotenv').config();

async function fixIndexes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/b2b-platform');
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // Drop all existing indexes except _id
    console.log('Dropping existing indexes...');
    try {
      await collection.dropIndexes();
      console.log('Dropped all indexes except _id');
    } catch (error) {
      console.log('Error dropping indexes (may not exist):', error.message);
    }

    // Create new sparse indexes
    console.log('Creating new sparse indexes...');
    
    // Phone number unique sparse index
    await collection.createIndex(
      { phoneNumber: 1 },
      { unique: true, sparse: true }
    );
    console.log('Created phoneNumber index');

    // Email unique index
    await collection.createIndex(
      { email: 1 },
      { unique: true }
    );
    console.log('Created email index');

    // Firebase UID unique sparse index (to allow nulls)
    await collection.createIndex(
      { firebaseUid: 1 },
      { unique: true, sparse: true }
    );
    console.log('Created firebaseUid index');

    // Geospatial indexes with sparse option
    try {
      await collection.createIndex(
        { 'businessLocation.coordinates': '2dsphere' },
        { sparse: true }
      );
      console.log('Created businessLocation geospatial index');
    } catch (error) {
      console.log('Could not create businessLocation index:', error.message);
    }

    try {
      await collection.createIndex(
        { 'deliveryAddress.coordinates': '2dsphere' },
        { sparse: true }
      );
      console.log('Created deliveryAddress geospatial index');
    } catch (error) {
      console.log('Could not create deliveryAddress index:', error.message);
    }

    try {
      await collection.createIndex(
        { 'additionalAddresses.coordinates': '2dsphere' },
        { sparse: true }
      );
      console.log('Created additionalAddresses geospatial index');
    } catch (error) {
      console.log('Could not create additionalAddresses index:', error.message);
    }

    console.log('\nAll indexes fixed successfully!');
    
    // List all indexes
    const indexes = await collection.indexes();
    console.log('\nCurrent indexes:');
    indexes.forEach(index => {
      console.log(`- ${index.name}: ${JSON.stringify(index.key)}`);
    });

    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixIndexes();
