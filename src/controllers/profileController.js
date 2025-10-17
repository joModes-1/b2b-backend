const User = require('../models/User');
const fs = require('fs').promises;
const path = require('path');
const admin = require('../config/firebaseAdmin');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');

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
    const { name, phoneNumber, businessLocation, deliveryAddress, businessInfo } = req.body;
    const updateData = {};

    // Helper to convert client location object to GeoJSON-compatible schema
    const toGeoLocation = (loc) => {
      if (!loc) return undefined;
      const lat = (loc?.coordinates && typeof loc.coordinates.lat === 'number') ? loc.coordinates.lat
                : (typeof loc?.lat === 'number' ? loc.lat : undefined);
      const lng = (loc?.coordinates && typeof loc.coordinates.lng === 'number') ? loc.coordinates.lng
                : (typeof loc?.lng === 'number' ? loc.lng
                  : (typeof loc?.lon === 'number' ? loc.lon : undefined));
      const formatted = (loc.formattedAddress || loc.display_name || '').trim();
      const addressStr = (loc.address && String(loc.address).trim()) || formatted || 'Unknown Address';
      const cityStr = (loc.city && String(loc.city).trim())
                   || (loc.town && String(loc.town).trim())
                   || (loc.village && String(loc.village).trim())
                   || (loc.state && String(loc.state).trim())
                   || 'Unknown';
      const countryStr = (loc.country && String(loc.country).trim()) || 'Uganda';
      return {
        address: addressStr,
        city: cityStr,
        state: loc.state || '',
        country: countryStr,
        postalCode: loc.postalCode || '',
        coordinates: {
          type: 'Point',
          coordinates: [
            (typeof lng === 'number' ? lng : 32.5825),
            (typeof lat === 'number' ? lat : 0.3476)
          ]
        },
        placeId: loc.placeId || '',
        formattedAddress: formatted
      };
    };

    // Build the update object with top-level fields
    if (name) updateData.name = name;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (businessInfo) updateData.businessInfo = businessInfo;

    // If a businessLocation is provided, convert and also mirror to deliveryAddress
    if (businessLocation) {
      const geo = toGeoLocation(businessLocation);
      updateData.businessLocation = geo;
      updateData.deliveryAddress = geo; // mirror for consistency across app
    }

    // If a deliveryAddress is provided directly, convert and set it
    if (deliveryAddress) {
      updateData.deliveryAddress = toGeoLocation(deliveryAddress);
    }

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

    res.json({ user: updatedUser });

  } catch (error) {
    console.error('Error in updateProfile:', error);
    // Check for Mongoose validation error
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation failed', errors: error.errors });
    }
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
};

// Helper to extract Cloudinary public_id from a secure URL
function extractCloudinaryPublicId(url) {
  try {
    // Example: https://res.cloudinary.com/<cloud>/image/upload/v1699999999/b2b-platform/uploads/abc123.jpg
    // We want: b2b-platform/uploads/abc123
    const uploadIndex = url.indexOf('/upload/');
    if (uploadIndex === -1) return null;
    // Slice after '/upload/' and version segment
    const afterUpload = url.substring(uploadIndex + 8); // after '/upload/'
    // Remove leading version segment like v1234567890/
    const parts = afterUpload.split('/');
    if (parts.length < 2) return null;
    const maybeVersion = parts[0];
    const pathParts = maybeVersion.startsWith('v') ? parts.slice(1) : parts; // drop version if present
    const last = pathParts[pathParts.length - 1];
    const withoutExt = last.includes('.') ? last.substring(0, last.lastIndexOf('.')) : last;
    const folder = pathParts.slice(0, -1).join('/');
    return folder ? `${folder}/${withoutExt}` : withoutExt;
  } catch {
    return null;
  }
}

// Upload profile picture
exports.uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Upload to Cloudinary
    const result = await uploadToCloudinary(req.file.path, { folder: 'b2b-platform/profile-pictures' });
    const fileUrl = result.secure_url;

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
      // If user doesn't exist in our DB, delete the temp file and Cloudinary resource.
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      const publicId = extractCloudinaryPublicId(fileUrl);
      if (publicId) {
        await deleteFromCloudinary(publicId).catch(() => {});
      }
      return res.status(404).json({ message: 'User not found in our system.' });
    }

    // Remove local temp file after successful upload
    if (req.file) await fs.unlink(req.file.path).catch(() => {});

    res.json({
      message: 'Profile picture uploaded successfully',
      user
    });
  } catch (error) {
    // Ensure local temp file is removed on error
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
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

    // If Cloudinary URL, delete from Cloudinary. Otherwise attempt local deletion for legacy paths.
    if (typeof user.profilePicture === 'string' && user.profilePicture.includes('res.cloudinary.com')) {
      const publicId = extractCloudinaryPublicId(user.profilePicture);
      if (publicId) {
        await deleteFromCloudinary(publicId).catch(err => console.warn('Cloudinary delete warning:', err?.message));
      }
    } else {
      const relativePath = user.profilePicture.startsWith('/')
        ? user.profilePicture.substring(1)
        : user.profilePicture;
      const filePath = path.join(__dirname, '..', '..', 'public', relativePath);
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') {
          throw unlinkError;
        }
        console.warn(`File not found during deletion, but proceeding to update DB: ${filePath}`);
      }
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