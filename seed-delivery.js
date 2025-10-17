const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const User = require('./src/models/User');

// Load environment variables
dotenv.config();

async function seedDeliveryPersonnel() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if delivery person already exists
    const existingDelivery = await User.findOne({ 
      email: 'delivery@test.com',
      role: 'delivery' 
    });

    if (existingDelivery) {
      console.log('Delivery personnel already exists:', existingDelivery.email);
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create delivery personnel account
    const deliveryUser = new User({
      name: 'Test Delivery Driver',
      email: 'delivery@test.com',
      password: hashedPassword,
      role: 'delivery',
      phoneNumber: '+256700123456',
      emailVerified: true,
      verified: true,
      phoneVerified: true
    });

    await deliveryUser.save();
    console.log('✅ Delivery personnel account created successfully!');
    console.log('Email:', deliveryUser.email);
    console.log('Password: password123');
    console.log('Role:', deliveryUser.role);
    
  } catch (error) {
    console.error('Error seeding delivery personnel:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the seed function
seedDeliveryPersonnel();
