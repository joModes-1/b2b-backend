# B2B Platform Backend

This is the backend server for the B2B Platform, built with Node.js and Express.js.

## Project Structure

```
b2b-backend/
├── models/              # Database models (Mongoose schemas)
├── routes/              # API routes
├── src/                 # Source code
│   ├── controllers/     # Request handlers
│   ├── middleware/      # Custom middleware
│   ├── models/          # Additional models
│   ├── routes/          # Main route files
│   ├── services/        # Business logic services
│   ├── utils/          # Utility functions
│   └── server.js       # Main server file
├── public/              # Static files
└── uploads/            # User uploaded files
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and update the environment variables

3. Start the server:
   ```bash
   npm run dev
   ```

## Environment Variables

Create a `.env` file with the following variables:

```env
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/b2b_platform
JWT_SECRET=your_jwt_secret_key_here
```
