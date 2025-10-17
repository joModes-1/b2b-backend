const express = require('express');
const router = express.Router();
const DeliveryPerson = require('../../models/DeliveryPerson');
const Order = require('../../models/Order');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// TEST MODE: Temporary middleware to bypass authentication
const TEST_MODE = process.env.DELIVERY_TEST_MODE === 'true';
const TEST_DRIVER_ID = '507f1f77bcf86cd799439011'; // Valid MongoDB ObjectId

// Middleware to handle test mode
const handleTestMode = async (req, res, next) => {
  if (TEST_MODE) {
    // In test mode, use a default test driver ID if none provided
    if (req.params.driverId === 'test' || !req.params.driverId) {
      req.params.driverId = TEST_DRIVER_ID;
    }
    if (req.body.driverId === 'test' || !req.body.driverId) {
      req.body.driverId = TEST_DRIVER_ID;
    }
    
    // Ensure test driver exists
    try {
      let testDriver = await DeliveryPerson.findById(TEST_DRIVER_ID);
      if (!testDriver) {
        testDriver = new DeliveryPerson({
          _id: TEST_DRIVER_ID,
          name: 'Test Driver',
          phoneNumber: '+256701234567',
          email: 'testdriver@example.com',
          isActive: true,
          isVerified: true,
          vehicleType: 'motorcycle',
          licenseNumber: 'TEST123',
          cashManagement: {
            currentCashBalance: 0,
            cashLimit: 500000,
            totalCollected: 0,
            totalDeposited: 0
          },
          activeDeliveries: []
        });
        await testDriver.save();
        console.log('Test driver created for delivery testing');
      }
    } catch (error) {
      console.error('Error creating test driver:', error);
    }
  }
  next();
};

// Simple health check to verify mount
router.get('/_health', (req, res) => {
  res.json({ ok: true, service: 'driver', time: new Date().toISOString() });
});

// Test mode status endpoint
router.get('/test-mode-status', (req, res) => {
  res.json({
    testMode: TEST_MODE,
    testDriverId: TEST_MODE ? TEST_DRIVER_ID : null,
    message: TEST_MODE ? 'Test mode is ENABLED - authentication bypassed' : 'Test mode is disabled'
  });
});

// Configure multer for deposit receipt uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../uploads/deposits');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, `deposit-${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, jpg, png, gif) and PDF are allowed'));
    }
  }
});

// TEST MODE: Bypass authentication
router.post('/auth/test-login', (req, res) => {
  if (!TEST_MODE) {
    return res.status(404).json({ error: 'Test mode not enabled' });
  }
  
  res.json({
    success: true,
    message: 'Test login successful',
    token: 'test-token-123',
    driver: {
      id: TEST_DRIVER_ID,
      name: 'Test Driver',
      phoneNumber: '+256701234567',
      isVerified: true,
      vehicleType: 'motorcycle',
      cashBalance: 0,
      cashLimit: 500000
    }
  });
});

// Driver login with OTP
router.post('/auth/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    const driver = await DeliveryPerson.findOne({ phoneNumber });
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    if (!driver.isActive) {
      return res.status(403).json({ error: 'Driver account is inactive' });
    }
    
    // Generate and save OTP
    const otp = driver.generateOTP();
    await driver.save();
    
    // In production, send SMS with actual service
    // For MVP, log the OTP
    console.log(`OTP for ${phoneNumber}: ${otp}`);
    
    // TODO: Integrate with SMS service (Africa's Talking, Twilio, etc.)
    // await sendSMS(phoneNumber, `Your OTP is: ${otp}`);
    
    res.json({
      success: true,
      message: 'OTP sent successfully',
      // Remove in production - only for testing
      testOTP: process.env.NODE_ENV === 'development' ? otp : undefined
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify OTP and login
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    
    const driver = await DeliveryPerson.findOne({ phoneNumber });
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const isValid = driver.verifyOTP(otp);
    if (!isValid) {
      await driver.save(); // Save attempt count
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
    
    // Update last login
    driver.lastLogin = new Date();
    await driver.save();
    
    // Generate session token (in production, use JWT)
    const token = require('crypto').randomBytes(32).toString('hex');
    
    res.json({
      success: true,
      token,
      driver: {
        id: driver._id,
        name: driver.name,
        phoneNumber: driver.phoneNumber,
        isVerified: driver.isVerified,
        vehicleType: driver.vehicleType,
        cashBalance: driver.cashManagement.currentCashBalance,
        cashLimit: driver.cashManagement.cashLimit
      }
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Get assigned deliveries
router.get('/deliveries/:driverId', handleTestMode, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status } = req.query;
    
    const driver = await DeliveryPerson.findById(driverId)
      .populate('activeDeliveries.orderId');
    
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    let deliveries = driver.activeDeliveries;
    
    // Filter by status if provided
    if (status) {
      deliveries = deliveries.filter(d => d.status === status);
    }
    
    // Get full order details for each delivery
    const detailedDeliveries = await Promise.all(
      deliveries.map(async (delivery) => {
        const order = await Order.findById(delivery.orderId)
          .populate('user', 'name phoneNumber')
          .populate('items.product', 'name')
          .populate('items.sellerId', 'name businessLocation');
        
        return {
          deliveryId: delivery._id,
          orderId: order._id,
          orderNumber: order.orderId,
          status: delivery.status,
          assignedAt: delivery.assignedAt,
          customer: {
            name: order.shippingInfo.fullName,
            phone: order.shippingInfo.phone,
            address: order.shippingInfo.address,
            coordinates: order.shippingInfo.coordinates
          },
          sellers: [...new Set(order.items.map(item => ({
            id: item.sellerId._id,
            name: item.sellerId.name,
            location: item.sellerId.businessLocation
          })))],
          totalAmount: order.totalAmount,
          paymentType: order.paymentInfo.type,
          isPaid: order.isPaid,
          cashToCollect: order.paymentInfo.type === 'cod' && !order.isPaid ? order.totalAmount : 0,
          cashCollected: delivery.cashCollected || 0,
          notes: delivery.notes
        };
      })
    );
    
    res.json({
      success: true,
      deliveries: detailedDeliveries,
      stats: {
        total: deliveries.length,
        assigned: deliveries.filter(d => d.status === 'assigned').length,
        inTransit: deliveries.filter(d => d.status === 'in_transit').length,
        delivered: deliveries.filter(d => d.status === 'delivered').length
      }
    });
  } catch (error) {
    console.error('Error fetching deliveries:', error);
    res.status(500).json({ error: 'Failed to fetch deliveries' });
  }
});

// Scan QR code and confirm pickup
router.post('/scan-qr', handleTestMode, async (req, res) => {
  try {
    const { driverId, qrData, location } = req.body;
    
    // Parse QR data
    let qrInfo;
    try {
      qrInfo = JSON.parse(qrData);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid QR code data' });
    }
    
    const { orderId } = qrInfo;
    
    // Find order
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Check if the driver is in test mode
    // Use a valid MongoDB ObjectId format (24 hex characters)
    const testDriverId = '507f1f77bcf86cd799439011';
    const driver = await DeliveryPerson.findOne({ _id: testDriverId }).catch(() => null);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const delivery = driver.activeDeliveries.find(
      d => d.orderId.toString() === order._id.toString()
    );
    
    if (!delivery) {
      return res.status(403).json({ error: 'You are not assigned to this order' });
    }
    
    // Update delivery status
    delivery.status = 'pickup_confirmed';
    delivery.pickupConfirmedAt = new Date();
    
    // Add pickup event to order
    order.driverEvents.push({
      eventType: 'pickup_confirmed',
      location: {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      },
      notes: `Pickup confirmed by ${driver.name}`
    });
    
    // Update order status
    order.status = 'processing';
    
    // Update driver location
    driver.currentLocation = {
      type: 'Point',
      coordinates: [location.longitude, location.latitude],
      lastUpdated: new Date()
    };
    
    await driver.save();
    await order.save();
    
    res.json({
      success: true,
      message: 'Pickup confirmed successfully',
      order: {
        orderId: order.orderId,
        amount: order.totalAmount,
        paymentType: order.paymentInfo.type,
        customer: {
          name: order.shippingInfo.fullName,
          phone: order.shippingInfo.phone
        }
      }
    });
  } catch (error) {
    console.error('Error scanning QR:', error);
    res.status(500).json({ error: 'Failed to process QR code' });
  }
});

// Update delivery status
router.put('/delivery-status', handleTestMode, async (req, res) => {
  try {
    const { driverId, orderId, status, location, notes } = req.body;
    
    const driver = await DeliveryPerson.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const delivery = driver.activeDeliveries.find(
      d => d.orderId.toString() === orderId
    );
    
    if (!delivery) {
      return res.status(403).json({ error: 'Delivery not found' });
    }
    
    // Update delivery status
    delivery.status = status;
    if (status === 'delivered') {
      delivery.deliveredAt = new Date();
      order.isDelivered = true;
      order.deliveredAt = new Date();
      order.status = 'delivered';
    }
    
    if (notes) {
      delivery.notes = notes;
    }
    
    // Add event to order
    order.driverEvents.push({
      eventType: status,
      location: location ? {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      } : undefined,
      notes
    });
    
    // Update driver location
    if (location) {
      driver.currentLocation = {
        type: 'Point',
        coordinates: [location.longitude, location.latitude],
        lastUpdated: new Date()
      };
    }
    
    await driver.save();
    await order.save();
    
    res.json({
      success: true,
      message: `Delivery status updated to ${status}`,
      delivery
    });
  } catch (error) {
    console.error('Error updating delivery status:', error);
    res.status(500).json({ error: 'Failed to update delivery status' });
  }
});

// Collect cash from customer
router.post('/collect-cash', handleTestMode, async (req, res) => {
  try {
    const { driverId, orderId, amount, location } = req.body;
    
    const driver = await DeliveryPerson.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    // Check cash limit
    if (!driver.canCollectCash(amount)) {
      return res.status(400).json({ 
        error: 'Cash limit exceeded',
        currentBalance: driver.cashManagement.currentCashBalance,
        limit: driver.cashManagement.cashLimit,
        availableSpace: driver.cashManagement.cashLimit - driver.cashManagement.currentCashBalance
      });
    }
    
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Verify amount matches order total
    if (Math.abs(amount - order.totalAmount) > 100) { // Allow 100 UGX tolerance
      return res.status(400).json({ 
        error: 'Amount mismatch',
        expected: order.totalAmount,
        received: amount
      });
    }
    
    // Record cash collection
    driver.recordCashCollection(amount, orderId);
    
    // Update order payment status
    order.isPaid = true;
    order.paidAt = new Date();
    order.paymentInfo.status = 'completed';
    
    // Add cash collection event
    order.driverEvents.push({
      eventType: 'cash_collected',
      location: location ? {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      } : undefined,
      notes: `Cash collected: ${amount} UGX`
    });
    
    await driver.save();
    await order.save();
    
    res.json({
      success: true,
      message: 'Cash collected successfully',
      cashBalance: driver.cashManagement.currentCashBalance,
      remainingCapacity: driver.cashManagement.cashLimit - driver.cashManagement.currentCashBalance
    });
  } catch (error) {
    console.error('Error collecting cash:', error);
    res.status(500).json({ error: 'Failed to record cash collection' });
  }
});

// Record deposit at mobile money agent
router.post('/deposit', handleTestMode, upload.single('receipt'), async (req, res) => {
  try {
    const { 
      driverId, 
      amount, 
      agentName, 
      agentPhone, 
      provider, 
      transactionReference,
      location 
    } = req.body;
    
    const driver = await DeliveryPerson.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    // Verify driver has enough cash to deposit
    if (amount > driver.cashManagement.currentCashBalance) {
      return res.status(400).json({ 
        error: 'Insufficient cash balance',
        currentBalance: driver.cashManagement.currentCashBalance,
        requestedDeposit: amount
      });
    }
    
    const depositData = {
      amount: Number(amount),
      depositedAt: new Date(),
      location: location ? {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      } : undefined,
      agentDetails: {
        name: agentName,
        phone: agentPhone,
        provider
      },
      receiptPhotoUrl: req.file ? `/uploads/deposits/${req.file.filename}` : undefined,
      transactionReference,
      verificationStatus: 'pending'
    };
    
    driver.recordDeposit(depositData);
    await driver.save();
    
    // TODO: Notify admin for verification
    
    res.json({
      success: true,
      message: 'Deposit recorded successfully',
      deposit: depositData,
      newBalance: driver.cashManagement.currentCashBalance
    });
  } catch (error) {
    console.error('Error recording deposit:', error);
    res.status(500).json({ error: 'Failed to record deposit' });
  }
});

// Get cash management summary
router.get('/cash-summary/:driverId', handleTestMode, async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const driver = await DeliveryPerson.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const pendingDeposits = driver.cashManagement.deposits.filter(
      d => d.verificationStatus === 'pending'
    );
    
    const verifiedDeposits = driver.cashManagement.deposits.filter(
      d => d.verificationStatus === 'verified'
    );
    
    res.json({
      success: true,
      cashManagement: {
        currentBalance: driver.cashManagement.currentCashBalance,
        cashLimit: driver.cashManagement.cashLimit,
        availableCapacity: driver.cashManagement.cashLimit - driver.cashManagement.currentCashBalance,
        totalCollected: driver.cashManagement.totalCollected,
        totalDeposited: driver.cashManagement.totalDeposited,
        lastDepositAt: driver.cashManagement.lastDepositAt,
        pendingDeposits: pendingDeposits.length,
        verifiedDeposits: verifiedDeposits.length,
        recentDeposits: driver.cashManagement.deposits.slice(-5)
      }
    });
  } catch (error) {
    console.error('Error fetching cash summary:', error);
    res.status(500).json({ error: 'Failed to fetch cash summary' });
  }
});

// Sync offline data
router.post('/sync-offline-data', async (req, res) => {
  try {
    const { driverId, offlineEvents } = req.body;
    
    const driver = await DeliveryPerson.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const syncResults = [];
    
    for (const event of offlineEvents) {
      try {
        switch (event.eventType) {
          case 'location_update':
            driver.currentLocation = {
              type: 'Point',
              coordinates: [event.data.longitude, event.data.latitude],
              lastUpdated: new Date(event.timestamp)
            };
            break;
            
          case 'delivery_status':
            const delivery = driver.activeDeliveries.find(
              d => d.orderId.toString() === event.data.orderId
            );
            if (delivery) {
              delivery.status = event.data.status;
              if (event.data.status === 'delivered') {
                delivery.deliveredAt = new Date(event.timestamp);
              }
            }
            break;
            
          case 'cash_collection':
            driver.recordCashCollection(event.data.amount, event.data.orderId);
            break;
        }
        
        syncResults.push({
          eventId: event.id,
          success: true
        });
      } catch (error) {
        syncResults.push({
          eventId: event.id,
          success: false,
          error: error.message
        });
      }
    }
    
    driver.offlineData.lastSyncAt = new Date();
    await driver.save();
    
    res.json({
      success: true,
      syncedEvents: syncResults.filter(r => r.success).length,
      failedEvents: syncResults.filter(r => !r.success).length,
      results: syncResults
    });
  } catch (error) {
    console.error('Error syncing offline data:', error);
    res.status(500).json({ error: 'Failed to sync offline data' });
  }
});

// Get available orders for delivery
router.get('/available-orders', async (req, res) => {
  try {
    // Find orders that are ready for delivery but not yet assigned
    const availableOrders = await Order.find({
      status: { $in: ['confirmed', 'processing', 'ready_for_delivery'] },
      assignedDriver: { $exists: false }
    })
    .populate('buyer', 'name phoneNumber')
    .populate('seller', 'name businessLocation')
    .select('orderNumber totalAmount shippingInfo paymentMethod status createdAt estimatedDeliveryDate')
    .sort({ createdAt: -1 })
    .limit(50);

    // Format orders for map display
    const formattedOrders = availableOrders.map(order => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      buyerName: order.buyer?.name || 'Unknown Customer',
      totalAmount: order.totalAmount,
      deliveryAddress: order.shippingInfo?.address || 'Address not provided',
      coordinates: order.shippingInfo?.coordinates ? {
        lat: order.shippingInfo.coordinates[1], // latitude
        lng: order.shippingInfo.coordinates[0]  // longitude
      } : {
        lat: 0.3476 + (Math.random() - 0.5) * 0.1, // Random around Kampala for demo
        lng: 32.5825 + (Math.random() - 0.5) * 0.1
      },
      status: order.status,
      paymentMethod: order.paymentMethod,
      estimatedDeliveryDate: order.estimatedDeliveryDate,
      createdAt: order.createdAt
    }));

    res.json({
      success: true,
      orders: formattedOrders,
      count: formattedOrders.length
    });
  } catch (error) {
    console.error('Error fetching available orders:', error);
    res.status(500).json({ error: 'Failed to fetch available orders' });
  }
});

// Accept delivery assignment
router.post('/accept-delivery', handleTestMode, async (req, res) => {
  try {
    const { driverId, orderId } = req.body;
    
    const driver = await DeliveryPerson.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Check if order is ready for delivery
    if (!['confirmed', 'processing', 'ready_for_delivery'].includes(order.status)) {
      return res.status(400).json({ 
        error: 'Order is not ready for delivery',
        currentStatus: order.status
      });
    }
    
    // Add delivery to driver's active deliveries
    const delivery = {
      orderId: order._id,
      status: 'assigned',
      assignedAt: new Date(),
      estimatedDeliveryTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      cashToCollect: order.paymentMethod === 'cod' && !order.isPaid ? order.totalAmount : 0
    };
    
    driver.activeDeliveries.push(delivery);
    
    // Update order status
    order.status = 'assigned_to_driver';
    order.assignedDriver = driverId;
    order.assignedAt = new Date();
    
    // Add driver event to order
    order.driverEvents = order.driverEvents || [];
    order.driverEvents.push({
      eventType: 'delivery_accepted',
      driverId: driverId,
      timestamp: new Date(),
      notes: `Delivery accepted by ${driver.name}`
    });
    
    await driver.save();
    await order.save();
    
    res.json({
      success: true,
      message: 'Delivery accepted successfully',
      delivery: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        customer: {
          name: order.shippingInfo?.fullName,
          phone: order.shippingInfo?.phone,
          address: order.shippingInfo?.address
        },
        amount: order.totalAmount,
        cashToCollect: delivery.cashToCollect,
        estimatedTime: delivery.estimatedDeliveryTime
      }
    });
  } catch (error) {
    console.error('Error accepting delivery:', error);
    res.status(500).json({ error: 'Failed to accept delivery' });
  }
});

// Update driver location
router.put('/location/:driverId', handleTestMode, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { latitude, longitude, address } = req.body;
    
    const driver = await DeliveryPerson.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    
    driver.currentLocation = {
      type: 'Point',
      coordinates: [longitude, latitude],
      address,
      lastUpdated: new Date()
    };
    
    await driver.save();
    
    res.json({
      success: true,
      message: 'Location updated successfully',
      location: driver.currentLocation
    });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

module.exports = router;
