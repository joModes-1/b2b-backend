require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const sellers = [
  {
    firebaseUid: 'firebase_vendor_a_uid',
    email: 'vendora@example.com',
    name: 'Vendor A Representative',
    role: 'seller',
    verified: true
  },
  {
    firebaseUid: 'firebase_vendor_b_uid',
    email: 'vendorb@example.com',
    name: 'Vendor B Representative',
    role: 'seller',
    verified: true
  },
  {
    firebaseUid: 'firebase_vendor_c_uid',
    email: 'vendorc@example.com',
    name: 'Vendor C Representative',
    role: 'seller',
    verified: true
  },
  {
    firebaseUid: 'firebase_vendor_d_uid',
    email: 'vendord@example.com',
    name: 'Vendor D Representative',
    role: 'seller',
    verified: true
  },
  {
    firebaseUid: 'firebase_vendor_e_uid',
    email: 'vendore@example.com',
    name: 'Vendor E Representative',
    role: 'seller',
    verified: true
  }
];

const seedSellers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected for seller seeding...');

    for (const sellerData of sellers) {
      // Use updateOne with upsert to avoid creating duplicates
      await User.updateOne(
        { email: sellerData.email },
        { $set: sellerData },
        { upsert: true }
      );
      console.log(`Upserted seller: ${sellerData.name}`);
    }

    console.log('Seller seeding complete.');

  } catch (err) {
    console.error('Error seeding sellers:', err);
  } finally {
    mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
};

seedSellers();
