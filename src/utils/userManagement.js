const admin = require('../config/firebaseAdmin');

// Set user roles using custom claims
exports.setUserRole = async (uid, roles) => {
  try {
    await admin.auth().setCustomUserClaims(uid, { roles });
    return true;
  } catch (error) {
    console.error('Error setting user role:', error);
    throw error;
  }
};

// Get user roles from custom claims
exports.getUserRoles = async (uid) => {
  try {
    const userRecord = await admin.auth().getUser(uid);
    return userRecord.customClaims?.roles || [];
  } catch (error) {
    console.error('Error getting user roles:', error);
    throw error;
  }
};

// Update user profile
exports.updateUserProfile = async (uid, profileData) => {
  try {
    const updateData = {
      displayName: profileData.name,
      // Add other profile fields as needed
    };

    await admin.auth().updateUser(uid, updateData);
    return true;
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
};

// Delete user
exports.deleteUser = async (uid) => {
  try {
    await admin.auth().deleteUser(uid);
    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
}; 