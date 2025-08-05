const User = require('../models/User');
const fs = require('fs').promises;
const path = require('path');
const admin = require('../config/firebaseAdmin');

// Get the currently authenticated user's profile
exports.getMe = (req, res) => {
  // The `verifyToken` middleware has already fetched the user profile and attached it to `req.user`.
  // We can simply send it back. This is the preferred endpoint for fetching the current user's data.
  res.json(req.user);
};

// Get user profile (legacy support)
exports.getProfile = (req, res) => {
  // This function is now redundant because `verifyToken` already attaches the full user profile.
  // It's kept for compatibility but mirrors the behavior of `getMe`.
  res.json(req.user);
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    const updateData = {};

    // Build the update object with top-level fields
    if (name) updateData.name = name;

    // Find the user by Firebase UID and update their profile
    // Using { new: true } returns the modified document
    const updatedUser = await User.findOneAndUpdate(
      { firebaseUid: req.user.firebaseUid },
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found in our system.' });
    }

    res.json(updatedUser);

  } catch (error) {
    console.error('Error in updateProfile:', error);
    // Check for Mongoose validation error
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation failed', errors: error.errors });
    }
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
};

// Upload profile picture
exports.uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Create URL for the uploaded file
    const fileUrl = `/uploads/${req.file.filename}`;

    // Update user profile with new picture URL
    const user = await User.findOneAndUpdate(
      { firebaseUid: req.user.firebaseUid },
      { 
        $set: { 
          profilePicture: fileUrl,
          updatedAt: new Date()
        }
      },
      { new: true }
    ).select('-password');

    if (!user) {
      // If user doesn't exist in our DB, delete the orphaned file.
      if (req.file) {
        await fs.unlink(req.file.path).catch(err => console.error('Error deleting orphaned file:', err));
      }
      return res.status(404).json({ message: 'User not found in our system.' });
    }

    res.json({
      message: 'Profile picture uploaded successfully',
      user
    });
  } catch (error) {
    // Delete uploaded file if there's an error
    if (req.file) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    console.error('Error in uploadProfilePicture:', error);
    res.status(500).json({ message: 'Error uploading profile picture', error: error.message });
  }
};

// Delete profile picture
exports.deleteProfilePicture = async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.firebaseUid }).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found in our system.' });
    }

    if (!user.profilePicture) {
      return res.status(400).json({ message: 'No profile picture to delete' });
    }

    // The profilePicture URL is stored as '/uploads/filename.ext'.
    // We need to build the absolute path to the file for deletion.
    // This assumes the 'uploads' folder is inside a 'public' directory
    // at the root of the backend project structure (backend/public/uploads).
    const relativePath = user.profilePicture.startsWith('/')
      ? user.profilePicture.substring(1)
      : user.profilePicture;
    const filePath = path.join(__dirname, '..', '..', 'public', relativePath);

    try {
      await fs.unlink(filePath);
    } catch (unlinkError) {
      // If the file doesn't exist (e.g., already deleted), we can ignore
      // the error and proceed to remove the reference from the user document.
      if (unlinkError.code !== 'ENOENT') {
        throw unlinkError; // Re-throw other filesystem errors.
      }
      console.warn(`File not found during deletion, but proceeding to update DB: ${filePath}`);
    }

    // Update user document
    user.profilePicture = undefined;
    const updatedUser = await user.save();

    res.json({ 
      message: 'Profile picture deleted successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error in deleteProfilePicture:', error);
    res.status(500).json({ message: 'Error deleting profile picture', error: error.message });
  }
}; 