const express = require('express');
const router = express.Router();
const RFQ = require('../models/RFQ');
const { auth, checkRole } = require('../middleware/auth');

// Create new RFQ (buyer only)
router.post('/', auth, checkRole('buyer'), async (req, res) => {
  try {
    const rfq = new RFQ({
      ...req.body,
      buyerId: req.user._id
    });
    await rfq.save();
    res.status(201).json(rfq);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get specific RFQ
router.get('/:id', auth, async (req, res) => {
  try {
    const rfq = await RFQ.findById(req.params.id);
    if (!rfq) {
      return res.status(404).json({ message: 'RFQ not found' });
    }
    
    // Check if user has permission to view this RFQ
    if (req.user.role !== 'admin' && req.user.role !== 'vendor' && 
        rfq.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    res.json(rfq);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get RFQs by user
router.get('/user/:userId', auth, async (req, res) => {
  try {
    // Check if user is requesting their own RFQs or is admin/vendor
    if (req.user.role !== 'admin' && req.user.role !== 'vendor' && 
        req.params.userId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const rfqs = await RFQ.find({ buyerId: req.params.userId })
      .sort({ createdAt: -1 });
    res.json(rfqs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all RFQs (admin/vendor only)
router.get('/', auth, checkRole(['admin', 'vendor']), async (req, res) => {
  try {
    const { status, category } = req.query;
    let query = {};
    
    if (status) query.status = status;
    if (category) query.category = category;
    
    const rfqs = await RFQ.find(query)
      .sort({ createdAt: -1 })
      .populate('buyerId', 'name email');
    res.json(rfqs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update RFQ status (admin/vendor only)
router.patch('/:id/status', auth, checkRole(['admin', 'vendor']), async (req, res) => {
  try {
    const { status } = req.body;
    const rfq = await RFQ.findById(req.params.id);
    
    if (!rfq) {
      return res.status(404).json({ message: 'RFQ not found' });
    }
    
    rfq.status = status;
    await rfq.save();
    res.json(rfq);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router; 