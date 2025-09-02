const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Determine the destination based on the file type
    let dest = 'uploads/attachments';
    if (file.fieldname === 'profilePicture') {
      dest = 'uploads';
    } else if (file.fieldname === 'image') {
      // For preset images
      dest = 'uploads';
    }
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    // Create unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Accept common image formats only
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
    req.fileValidationError = 'Only image files (jpg, jpeg, png, gif, webp, svg) are allowed!';
    return cb(new Error('Only image files (jpg, jpeg, png, gif, webp, svg) are allowed!'), false);
  }
  cb(null, true);
};

// Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

module.exports = upload; 