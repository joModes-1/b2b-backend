const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');

// Calculate distance using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Calculate transport cost based on distance
const calculateTransportCost = (distance, weight = 1, baseRate = 5000, ratePerKm = 1000) => {
  // Base rate + distance rate + weight multiplier
  const weightMultiplier = 1 + (weight - 1) * 0.1; // 10% increase per kg over 1kg
  return Math.round((baseRate + (distance * ratePerKm)) * weightMultiplier);
};

// Update seller business location
router.put('/seller/location', async (req, res) => {
  try {
    const { userId, address, city, state, country, postalCode, coordinates, placeId, formattedAddress } = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== 'seller') {
      return res.status(403).json({ message: 'User is not a seller' });
    }

    // Update business location with GeoJSON format
    user.businessLocation = {
      address,
      city,
      state,
      country,
      postalCode,
      coordinates: {
        type: 'Point',
        coordinates: [coordinates.lng, coordinates.lat] // MongoDB expects [longitude, latitude]
      },
      placeId,
      formattedAddress
    };
    user.locationVerified = true;

    await user.save();
    res.json({ message: 'Business location updated successfully', user });
  } catch (error) {
    console.error('Error updating seller location:', error);
    res.status(500).json({ message: 'Error updating location', error: error.message });
  }
});

// Update buyer delivery address
router.put('/buyer/location', async (req, res) => {
  try {
    const { userId, address, city, state, country, postalCode, coordinates, placeId, formattedAddress, isDefault } = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== 'buyer') {
      return res.status(403).json({ message: 'User is not a buyer' });
    }

    // Update delivery address with GeoJSON format
    user.deliveryAddress = {
      address,
      city,
      state,
      country,
      postalCode,
      coordinates: {
        type: 'Point',
        coordinates: [coordinates.lng, coordinates.lat]
      },
      placeId,
      formattedAddress,
      isDefault: isDefault !== false
    };

    await user.save();
    res.json({ message: 'Delivery address updated successfully', user });
  } catch (error) {
    console.error('Error updating buyer location:', error);
    res.status(500).json({ message: 'Error updating location', error: error.message });
  }
});

// Add additional delivery address for buyer
router.post('/buyer/additional-address', async (req, res) => {
  try {
    const { userId, nickname, address, city, state, country, postalCode, coordinates, placeId, formattedAddress, setAsDefault } = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== 'buyer') {
      return res.status(403).json({ message: 'User is not a buyer' });
    }

    // If setting as default, update all other addresses
    if (setAsDefault) {
      user.deliveryAddress.isDefault = false;
      user.additionalAddresses.forEach(addr => {
        addr.isDefault = false;
      });
    }

    const newAddress = {
      nickname,
      address,
      city,
      state,
      country,
      postalCode,
      coordinates: {
        type: 'Point',
        coordinates: [coordinates.lng, coordinates.lat]
      },
      placeId,
      formattedAddress,
      isDefault: setAsDefault || false
    };

    user.additionalAddresses.push(newAddress);
    await user.save();

    res.json({ message: 'Additional address added successfully', user });
  } catch (error) {
    console.error('Error adding additional address:', error);
    res.status(500).json({ message: 'Error adding address', error: error.message });
  }
});

// Get nearby sellers based on buyer location
router.get('/nearby-sellers', async (req, res) => {
  try {
    const { buyerId, maxDistance = 50 } = req.query; // maxDistance in kilometers

    const buyer = await User.findById(buyerId);
    if (!buyer || !buyer.deliveryAddress?.coordinates?.coordinates) {
      return res.status(400).json({ message: 'Buyer location not found' });
    }

    const [longitude, latitude] = buyer.deliveryAddress.coordinates.coordinates;

    // Find sellers within the specified distance
    const sellers = await User.find({
      role: 'seller',
      'businessLocation.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: maxDistance * 1000 // Convert km to meters
        }
      }
    }).select('name businessLocation email phoneNumber');

    // Calculate exact distances
    const sellersWithDistance = sellers.map(seller => {
      const [sellerLng, sellerLat] = seller.businessLocation.coordinates.coordinates;
      const distance = calculateDistance(latitude, longitude, sellerLat, sellerLng);
      return {
        ...seller.toObject(),
        distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
      };
    });

    res.json({ 
      sellers: sellersWithDistance,
      buyerLocation: buyer.deliveryAddress.formattedAddress || buyer.deliveryAddress.address
    });
  } catch (error) {
    console.error('Error finding nearby sellers:', error);
    res.status(500).json({ message: 'Error finding nearby sellers', error: error.message });
  }
});

// Get products from nearby sellers
router.get('/nearby-products', async (req, res) => {
  try {
    const { buyerId, maxDistance = 50, category, minPrice, maxPrice, limit = 20, offset = 0 } = req.query;

    const buyer = await User.findById(buyerId);
    if (!buyer || !buyer.deliveryAddress?.coordinates?.coordinates) {
      return res.status(400).json({ message: 'Buyer location not found' });
    }

    const [longitude, latitude] = buyer.deliveryAddress.coordinates.coordinates;

    // Find nearby sellers first
    const nearbySellers = await User.find({
      role: 'seller',
      'businessLocation.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: maxDistance * 1000
        }
      }
    }).select('_id businessLocation');

    const sellerIds = nearbySellers.map(seller => seller._id);

    // Build product query
    let productQuery = {
      seller: { $in: sellerIds },
      status: 'active'
    };

    if (category) productQuery.category = category;
    if (minPrice || maxPrice) {
      productQuery.price = {};
      if (minPrice) productQuery.price.$gte = Number(minPrice);
      if (maxPrice) productQuery.price.$lte = Number(maxPrice);
    }

    // Find products from nearby sellers
    const products = await Product.find(productQuery)
      .populate('seller', 'name businessLocation')
      .limit(Number(limit))
      .skip(Number(offset))
      .sort('-createdAt');

    // Add distance and transport cost to each product
    const productsWithDistance = products.map(product => {
      const [sellerLng, sellerLat] = product.seller.businessLocation.coordinates.coordinates;
      const distance = calculateDistance(latitude, longitude, sellerLat, sellerLng);
      const transportCost = calculateTransportCost(distance);
      
      return {
        ...product.toObject(),
        distance: Math.round(distance * 100) / 100,
        estimatedTransportCost: transportCost
      };
    });

    // Sort by distance
    productsWithDistance.sort((a, b) => a.distance - b.distance);

    res.json({ 
      products: productsWithDistance,
      total: productsWithDistance.length,
      buyerLocation: buyer.deliveryAddress.formattedAddress || buyer.deliveryAddress.address
    });
  } catch (error) {
    console.error('Error finding nearby products:', error);
    res.status(500).json({ message: 'Error finding nearby products', error: error.message });
  }
});

// Calculate transport cost for multiple locations
router.post('/calculate-transport-cost', async (req, res) => {
  try {
    const { buyerId, sellerIds, items = [] } = req.body;

    const buyer = await User.findById(buyerId);
    if (!buyer || !buyer.deliveryAddress?.coordinates?.coordinates) {
      return res.status(400).json({ message: 'Buyer location not found' });
    }

    const [buyerLng, buyerLat] = buyer.deliveryAddress.coordinates.coordinates;

    // Get all sellers
    const sellers = await User.find({
      _id: { $in: sellerIds },
      role: 'seller'
    }).select('businessLocation name');

    let totalCost = 0;
    const costBreakdown = [];
    let multiLocationFee = 0;

    // Calculate cost for each seller location
    for (const seller of sellers) {
      if (!seller.businessLocation?.coordinates?.coordinates) continue;
      
      const [sellerLng, sellerLat] = seller.businessLocation.coordinates.coordinates;
      const distance = calculateDistance(buyerLat, buyerLng, sellerLat, sellerLng);
      
      // Calculate total weight for items from this seller
      const sellerItems = items.filter(item => item.sellerId === seller._id.toString());
      const totalWeight = sellerItems.reduce((sum, item) => sum + (item.weight || 1) * item.quantity, 0);
      
      const transportCost = calculateTransportCost(distance, totalWeight);
      totalCost += transportCost;

      costBreakdown.push({
        sellerId: seller._id,
        sellerName: seller.name,
        distance: Math.round(distance * 100) / 100,
        weight: totalWeight,
        cost: transportCost,
        location: seller.businessLocation.formattedAddress || seller.businessLocation.address
      });
    }

    // Add multi-location fee if ordering from multiple sellers
    if (sellers.length > 1) {
      multiLocationFee = 3000 * (sellers.length - 1); // 3000 UGX per additional location
      totalCost += multiLocationFee;
    }

    res.json({
      totalTransportCost: totalCost,
      multiLocationFee,
      numberOfLocations: sellers.length,
      costBreakdown,
      warning: sellers.length > 1 ? 
        `Ordering from ${sellers.length} different locations will incur additional transport fees` : null
    });
  } catch (error) {
    console.error('Error calculating transport cost:', error);
    res.status(500).json({ message: 'Error calculating transport cost', error: error.message });
  }
});

// Validate location coordinates
router.post('/validate-location', async (req, res) => {
  try {
    const { coordinates, address } = req.body;

    if (!coordinates || typeof coordinates.lat !== 'number' || typeof coordinates.lng !== 'number') {
      return res.status(400).json({ 
        valid: false, 
        message: 'Invalid coordinates format' 
      });
    }

    // Check if coordinates are within valid range
    if (Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lng) > 180) {
      return res.status(400).json({ 
        valid: false, 
        message: 'Coordinates out of valid range' 
      });
    }

    // Additional validation for Uganda region (approximate bounds)
    const ugandaBounds = {
      north: 4.234,
      south: -1.478,
      east: 35.036,
      west: 29.573
    };

    const isInUganda = coordinates.lat >= ugandaBounds.south && 
                       coordinates.lat <= ugandaBounds.north &&
                       coordinates.lng >= ugandaBounds.west && 
                       coordinates.lng <= ugandaBounds.east;

    res.json({
      valid: true,
      isInUganda,
      coordinates,
      address,
      message: isInUganda ? 'Location validated successfully' : 'Location is outside Uganda'
    });
  } catch (error) {
    console.error('Error validating location:', error);
    res.status(500).json({ message: 'Error validating location', error: error.message });
  }
});

module.exports = router;
