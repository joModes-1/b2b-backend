const mongoose = require('mongoose');

// Allow string IDs as provided (e.g., "cat1", "sub1-1")
const subcategorySchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    subcategories: { type: [subcategorySchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
