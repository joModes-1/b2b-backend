const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./src/models/User');

async function cleanupLocations() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/b2b-platform');
    console.log('Connected to MongoDB');

    // Find all users to check their location data
    const users = await User.find({});

    console.log(`Found ${users.length} users to check`);

    let fixed = 0;
    for (const user of users) {
      let needsUpdate = false;
      const updates = {};

      // Check businessLocation
      if (user.businessLocation) {
        // For buyers, always remove businessLocation
        if (user.role === 'buyer') {
          updates.$unset = updates.$unset || {};
          updates.$unset.businessLocation = 1;
          needsUpdate = true;
          console.log(`Removing businessLocation for buyer: ${user.email}`);
        } else if (user.businessLocation.coordinates) {
          const coords = user.businessLocation.coordinates;
          // Check if coordinates are incomplete (missing the actual array)
          if (coords.type === 'Point' && (!coords.coordinates || coords.coordinates.length === 0)) {
            // For sellers, set default coordinates
            updates.$set = updates.$set || {};
            updates.$set['businessLocation.coordinates.coordinates'] = [32.5825, 0.3476]; // Kampala default
            needsUpdate = true;
            console.log(`Fixing businessLocation for seller: ${user.email}`);
          }
        }
      }

      // Check deliveryAddress
      if (user.deliveryAddress && user.deliveryAddress.coordinates) {
        const coords = user.deliveryAddress.coordinates;
        // Check various malformed cases
        if (!coords.type || coords.type !== 'Point' || !coords.coordinates || coords.coordinates.length !== 2) {
          updates.$set = updates.$set || {};
          // Set proper GeoJSON format
          updates.$set['deliveryAddress.coordinates'] = {
            type: 'Point',
            coordinates: coords.coordinates && coords.coordinates.length === 2 
              ? coords.coordinates 
              : [32.5825, 0.3476] // Kampala default
          };
          needsUpdate = true;
          console.log(`Fixing deliveryAddress for ${user.role}: ${user.email}`);
        }
      }

      if (needsUpdate) {
        try {
          await User.updateOne({ _id: user._id }, updates);
          fixed++;
        } catch (updateError) {
          console.error(`Failed to update user ${user.email}:`, updateError.message);
        }
      }
    }

    console.log(`\nFixed ${fixed} users with incomplete location data`);

    await mongoose.connection.close();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

cleanupLocations();
