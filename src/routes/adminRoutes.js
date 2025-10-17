const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
// const { verifyToken } = require('../middleware/auth');
// const { isAdmin } = require('../middleware/adminAuth');
const {
  getDashboardData,
  getStats,
  getUsers,
  getListings,
  getPendingApprovals,
  updateVendorStatus,
  updateProductStatus,
  updateUserStatus,
  updateListingStatus,
  exportToCsv,
  exportToPdf
} = require('../controllers/adminController');

// Apply authentication middleware to all admin routes - DISABLED FOR TESTING
// router.use(verifyToken);
// router.use(isAdmin);

// Dashboard
router.get('/dashboard', getDashboardData);
router.get('/stats', getStats);

// User management
router.get('/users', getUsers);
router.patch('/users/:id/status', updateUserStatus);

// Pending approvals
router.get('/pending', getPendingApprovals);
router.patch('/vendors/:id/status', updateVendorStatus);
router.patch('/products/:id/status', updateProductStatus);
router.patch('/sellers/:id/status', updateVendorStatus); // Add alias for sellers

// Product management
router.get('/listings', getListings);
router.patch('/listings/:id/status', updateListingStatus);

// Data export
router.get('/export/csv', exportToCsv);
router.get('/export/pdf', exportToPdf);

// Delivery Personnel Management
// Get all delivery personnel
router.get('/delivery-personnel', async (req, res) => {
  try {
    const deliveryPersonnel = await User.find({ role: 'delivery' })
      .select('-password -firebaseUid')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      deliveryPersonnel
    });
  } catch (error) {
    console.error('Error fetching delivery personnel:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch delivery personnel' 
    });
  }
});

// Create new delivery personnel
router.post('/delivery-personnel', async (req, res) => {
  try {
    const { name, email, password, phoneNumber, vehicleType, vehicleNumber, licenseNumber, zone } = req.body;

    // Validate required fields
    if (!name || !email || !password || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, and phone number are required'
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new delivery personnel
    const deliveryPerson = new User({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phoneNumber,
      role: 'delivery',
      emailVerified: true,
      verified: true,
      phoneVerified: true,
      deliveryInfo: {
        vehicleType: vehicleType || 'motorcycle',
        vehicleNumber: vehicleNumber || '',
        licenseNumber: licenseNumber || '',
        zone: zone || 'Not Assigned',
        rating: 0,
        completedDeliveries: 0,
        isAvailable: true
      }
    });

    await deliveryPerson.save();

    // Remove sensitive data before sending response
    const responseData = deliveryPerson.toObject();
    delete responseData.password;
    delete responseData.firebaseUid;

    res.status(201).json({
      success: true,
      message: 'Delivery personnel created successfully',
      deliveryPerson: responseData
    });
  } catch (error) {
    console.error('Error creating delivery personnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create delivery personnel',
      error: error.message
    });
  }
});

// Update delivery personnel
router.put('/delivery-personnel/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Don't allow role change through this endpoint
    delete updates.role;
    
    // Hash password if it's being updated
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    const deliveryPerson = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -firebaseUid');

    if (!deliveryPerson) {
      return res.status(404).json({
        success: false,
        message: 'Delivery personnel not found'
      });
    }

    res.json({
      success: true,
      message: 'Delivery personnel updated successfully',
      deliveryPerson
    });
  } catch (error) {
    console.error('Error updating delivery personnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update delivery personnel'
    });
  }
});

// Delete delivery personnel
router.delete('/delivery-personnel/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deliveryPerson = await User.findOneAndDelete({
      _id: id,
      role: 'delivery'
    });

    if (!deliveryPerson) {
      return res.status(404).json({
        success: false,
        message: 'Delivery personnel not found'
      });
    }

    res.json({
      success: true,
      message: 'Delivery personnel deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting delivery personnel:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete delivery personnel'
    });
  }
});

// Toggle delivery personnel availability
router.patch('/delivery-personnel/:id/toggle-availability', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deliveryPerson = await User.findById(id);
    if (!deliveryPerson || deliveryPerson.role !== 'delivery') {
      return res.status(404).json({
        success: false,
        message: 'Delivery personnel not found'
      });
    }

    deliveryPerson.deliveryInfo = deliveryPerson.deliveryInfo || {};
    deliveryPerson.deliveryInfo.isAvailable = !deliveryPerson.deliveryInfo.isAvailable;
    await deliveryPerson.save();

    res.json({
      success: true,
      message: `Delivery personnel ${deliveryPerson.deliveryInfo.isAvailable ? 'activated' : 'deactivated'} successfully`,
      isAvailable: deliveryPerson.deliveryInfo.isAvailable
    });
  } catch (error) {
    console.error('Error toggling availability:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle availability'
    });
  }
});

module.exports = router; 