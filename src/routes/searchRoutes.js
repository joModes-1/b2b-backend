const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const User = require('../models/User');

// Luganda to English translation mapping (basic dictionary)
const lugandaToEnglish = {
  // Common product categories
  'emmere': 'food',
  'ennyama': 'meat',
  'ebinyeebwa': 'groundnuts',
  'omukutu': 'bread',
  'amata': 'milk',
  'obutto': 'butter',
  'omuceere': 'rice',
  'obuwunga': 'flour',
  'cassava': 'cassava',
  'lumonde': 'sweet potato',
  'matooke': 'bananas',
  'binyeebwa': 'groundnuts',
  'kasooli': 'maize',
  'sukali': 'sugar',
  'omubisi': 'juice',
  'caayi': 'tea',
  'kaawa': 'coffee',
  
  // Common terms
  'bbeeyi': 'price',
  'ntono': 'small',
  'nnene': 'big',
  'kirungi': 'good',
  'vaayo': 'cheap',
  'meka': 'how much',
  'omupiira': 'ball',
  'engoye': 'clothes',
  'engatto': 'shoes',
  'esaati': 'shirt',
  'empale': 'trousers',
  
  // Electronics
  'essimu': 'phone',
  'kompyuta': 'computer',
  'tivi': 'television',
  'ladio': 'radio'
};

// Function to translate Luganda terms to English
function translateLuganda(query) {
  let translatedQuery = query.toLowerCase();
  
  // Replace Luganda words with English equivalents
  Object.keys(lugandaToEnglish).forEach(lugandaWord => {
    const regex = new RegExp(`\\b${lugandaWord}\\b`, 'gi');
    translatedQuery = translatedQuery.replace(regex, lugandaToEnglish[lugandaWord]);
  });
  
  return translatedQuery;
}

// Fuzzy search scoring function
function fuzzyMatch(str1, str2, threshold = 0.6) {
  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();
  
  // Exact match
  if (str1 === str2) return 1;
  
  // Contains match
  if (str2.includes(str1) || str1.includes(str2)) return 0.8;
  
  // Levenshtein distance
  const matrix = [];
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;
  
  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const distance = matrix[len2][len1];
  const maxLen = Math.max(len1, len2);
  const similarity = 1 - distance / maxLen;
  
  return similarity >= threshold ? similarity : 0;
}

// Extract keywords from query
function extractKeywords(query) {
  // Remove common stop words
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from'];
  
  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));
  
  return words;
}

// Intelligent search endpoint
router.get('/products', async (req, res) => {
  try {
    const { 
      q, // query
      category,
      minPrice,
      maxPrice,
      location,
      radius = 50, // km
      seller,
      sort = 'relevance',
      limit = 20,
      offset = 0,
      lang = 'en' // Language: en, lg (Luganda)
    } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    // Translate query if in Luganda
    let searchQuery = q;
    if (lang === 'lg' || /[^\x00-\x7F]/.test(q)) {
      searchQuery = translateLuganda(q);
    }
    
    // Extract keywords
    const keywords = extractKeywords(searchQuery);
    
    // Build search pipeline
    const pipeline = [];
    
    // Text search stage
    if (keywords.length > 0) {
      pipeline.push({
        $match: {
          $or: [
            { $text: { $search: keywords.join(' ') } },
            { name: { $regex: keywords.join('|'), $options: 'i' } },
            { description: { $regex: keywords.join('|'), $options: 'i' } },
            { category: { $regex: keywords.join('|'), $options: 'i' } }
          ]
        }
      });
      
      // Add text score for relevance sorting
      pipeline.push({
        $addFields: {
          score: { $meta: 'textScore' }
        }
      });
    }
    
    // Category filter
    if (category) {
      pipeline.push({
        $match: { category: { $regex: category, $options: 'i' } }
      });
    }
    
    // Price range filter
    if (minPrice || maxPrice) {
      const priceFilter = {};
      if (minPrice) priceFilter.$gte = Number(minPrice);
      if (maxPrice) priceFilter.$lte = Number(maxPrice);
      pipeline.push({
        $match: { price: priceFilter }
      });
    }
    
    // Seller filter
    if (seller) {
      pipeline.push({
        $match: { seller: mongoose.Types.ObjectId(seller) }
      });
    }
    
    // Location-based filter
    if (location) {
      const [lat, lng] = location.split(',').map(Number);
      
      // Lookup seller information
      pipeline.push({
        $lookup: {
          from: 'users',
          localField: 'seller',
          foreignField: '_id',
          as: 'sellerInfo'
        }
      });
      
      pipeline.push({
        $unwind: '$sellerInfo'
      });
      
      // Add distance calculation
      pipeline.push({
        $addFields: {
          distance: {
            $sqrt: {
              $add: [
                {
                  $pow: [
                    { $subtract: [{ $arrayElemAt: ['$sellerInfo.businessLocation.coordinates.coordinates', 0] }, lng] },
                    2
                  ]
                },
                {
                  $pow: [
                    { $subtract: [{ $arrayElemAt: ['$sellerInfo.businessLocation.coordinates.coordinates', 1] }, lat] },
                    2
                  ]
                }
              ]
            }
          }
        }
      });
      
      // Filter by radius (convert degrees to km approximately)
      const radiusInDegrees = radius / 111; // 1 degree ≈ 111 km
      pipeline.push({
        $match: {
          distance: { $lte: radiusInDegrees }
        }
      });
    }
    
    // Sorting
    let sortStage = {};
    switch (sort) {
      case 'relevance':
        if (keywords.length > 0) {
          sortStage = { score: -1, createdAt: -1 };
        } else {
          sortStage = { createdAt: -1 };
        }
        break;
      case 'price_low':
        sortStage = { price: 1 };
        break;
      case 'price_high':
        sortStage = { price: -1 };
        break;
      case 'newest':
        sortStage = { createdAt: -1 };
        break;
      case 'distance':
        if (location) {
          sortStage = { distance: 1 };
        } else {
          sortStage = { createdAt: -1 };
        }
        break;
      default:
        sortStage = { createdAt: -1 };
    }
    
    pipeline.push({ $sort: sortStage });
    
    // Pagination
    pipeline.push({ $skip: Number(offset) });
    pipeline.push({ $limit: Number(limit) });
    
    // Execute search
    const products = await Product.aggregate(pipeline);
    
    // If no exact matches, try fuzzy search
    if (products.length === 0 && keywords.length > 0) {
      // Fallback to fuzzy search
      const allProducts = await Product.find({ status: 'active' })
        .populate('seller', 'name businessLocation')
        .limit(100);
      
      const fuzzyResults = [];
      
      for (const product of allProducts) {
        let maxScore = 0;
        
        // Check name
        for (const keyword of keywords) {
          const nameScore = fuzzyMatch(keyword, product.name);
          const categoryScore = fuzzyMatch(keyword, product.category) * 0.8;
          const descScore = fuzzyMatch(keyword, product.description || '') * 0.6;
          
          maxScore = Math.max(maxScore, nameScore, categoryScore, descScore);
        }
        
        if (maxScore > 0) {
          fuzzyResults.push({
            ...product.toObject(),
            relevanceScore: maxScore
          });
        }
      }
      
      // Sort by relevance score
      fuzzyResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      // Apply filters
      let filtered = fuzzyResults;
      
      if (category) {
        filtered = filtered.filter(p => p.category.toLowerCase().includes(category.toLowerCase()));
      }
      
      if (minPrice || maxPrice) {
        filtered = filtered.filter(p => {
          if (minPrice && p.price < Number(minPrice)) return false;
          if (maxPrice && p.price > Number(maxPrice)) return false;
          return true;
        });
      }
      
      // Pagination
      const paginatedResults = filtered.slice(Number(offset), Number(offset) + Number(limit));
      
      return res.json({
        success: true,
        searchType: 'fuzzy',
        query: q,
        translatedQuery: searchQuery !== q ? searchQuery : undefined,
        keywords,
        results: paginatedResults,
        total: filtered.length,
        suggestions: fuzzyResults.length > 0 ? 
          `Did you mean: ${fuzzyResults[0].name}?` : 
          'Try different keywords or check spelling'
      });
    }
    
    res.json({
      success: true,
      searchType: 'exact',
      query: q,
      translatedQuery: searchQuery !== q ? searchQuery : undefined,
      keywords,
      results: products,
      total: products.length
    });
    
  } catch (error) {
    console.error('Error in intelligent search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Autocomplete suggestions
router.get('/suggestions', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }
    
    // Translate if needed
    const searchQuery = translateLuganda(q);
    
    // Get product name suggestions
    const products = await Product.find({
      $or: [
        { name: { $regex: `^${searchQuery}`, $options: 'i' } },
        { category: { $regex: `^${searchQuery}`, $options: 'i' } }
      ],
      status: 'active'
    })
    .select('name category')
    .limit(Number(limit));
    
    // Get unique suggestions
    const suggestions = [];
    const seen = new Set();
    
    products.forEach(product => {
      // Add product names
      if (!seen.has(product.name.toLowerCase())) {
        suggestions.push({
          text: product.name,
          type: 'product'
        });
        seen.add(product.name.toLowerCase());
      }
      
      // Add categories
      if (!seen.has(product.category.toLowerCase())) {
        suggestions.push({
          text: product.category,
          type: 'category'
        });
        seen.add(product.category.toLowerCase());
      }
    });
    
    res.json({
      success: true,
      query: q,
      translatedQuery: searchQuery !== q ? searchQuery : undefined,
      suggestions: suggestions.slice(0, Number(limit))
    });
    
  } catch (error) {
    console.error('Error getting suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Popular searches
router.get('/popular', async (req, res) => {
  try {
    // In production, track actual searches in database
    const popularSearches = [
      { term: 'rice', count: 1250, category: 'food' },
      { term: 'sugar', count: 980, category: 'food' },
      { term: 'cooking oil', count: 875, category: 'food' },
      { term: 'flour', count: 750, category: 'food' },
      { term: 'soap', count: 650, category: 'household' },
      { term: 'matooke', count: 600, category: 'food' },
      { term: 'beans', count: 550, category: 'food' },
      { term: 'groundnuts', count: 500, category: 'food' }
    ];
    
    res.json({
      success: true,
      popularSearches
    });
  } catch (error) {
    console.error('Error getting popular searches:', error);
    res.status(500).json({ error: 'Failed to get popular searches' });
  }
});

module.exports = router;
