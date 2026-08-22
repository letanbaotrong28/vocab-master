import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, closeDb, getOne } from './db.js';
import authRoutes from './authRoutes.js';
import setsRoutes from './setsRoutes.js';
import { authenticateToken } from './authMiddleware.js';

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '../dist');

const allowedOrigins = [
  process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://localhost:4173'
];

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  xContentTypeOptions: true,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cookieParser());

// CORS with whitelist (Item 13 Fix)
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// Item 29 Fix: CSRF Validation Header Check for Mutating API Endpoints
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.path.startsWith('/api/')) {
    const hasHeader = req.headers['authorization'] || req.headers['content-type'] || req.headers['x-requested-with'];
    if (!hasHeader) {
      return res.status(403).json({ error: 'Yêu cầu bị từ chối do thiếu CSRF Validation Header.' });
    }
  }
  next();
});

// Item 30 Fix: Simple In-Memory Rate Limiter for Mutating Endpoints
const rateLimitMap = new Map();
const rateLimiter = (maxRequests = 100, windowMs = 60000) => (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count += 1;
  }

  rateLimitMap.set(ip, record);

  if (record.count > maxRequests) {
    return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.' });
  }
  next();
};

app.use('/api/sets/word-stats', rateLimiter(120, 60000));
app.use('/api/sets/reset-progress', rateLimiter(10, 60000));
app.use('/api/sets/sync-batch', rateLimiter(20, 60000));

// Item 59 Fix: Structured Request Logging & Request ID Response Header
app.use((req, res, next) => {
  const requestId = Math.random().toString(36).substring(2, 9);
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });

  next();
});

// Item 28 Fix: Health Check with Active Database Ping
app.get('/api/health', async (req, res) => {
  try {
    await getOne('SELECT 1 as alive');
    res.json({
      status: 'ok',
      db: 'connected',
      service: 'VocabMaster Backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Item 58, 127 & P0 Fix (11, 12): Database Backup Download Endpoint with Admin Authorization & PostgreSQL Check
app.get('/api/admin/backup', authenticateToken, async (req, res) => {
  try {
    if (!req.user.is_admin && req.user.username !== (process.env.ADMIN_USERNAME || 'admin')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập endpoint quản trị.' });
    }

    if (process.env.DATABASE_URL) {
      return res.status(400).json({ error: 'Tính năng backup file SQLite không khả dụng khi đang sử dụng Cloud PostgreSQL.' });
    }

    const dbPath = path.join(__dirname, 'database.db');
    const backupPath = path.join(__dirname, `vocabmaster_backup_${Date.now()}.db`);

    if (fs.existsSync(dbPath)) {
      try {
        await run(`VACUUM INTO ?`, [backupPath]);
        res.download(backupPath, path.basename(backupPath), () => {
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        });
      } catch (vErr) {
        res.download(dbPath, `vocabmaster_backup_${Date.now()}.db`);
      }
    } else {
      res.status(404).json({ error: 'Không tìm thấy file CSDL SQLite cục bộ.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ khi xuất file backup.' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sets', setsRoutes);

// Item 60 Fix: Standard JSON 404 handler for unmatched API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint API không tồn tại.',
    code: 'NOT_FOUND',
    path: req.originalUrl
  });
});

// Static serving for production dist build
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  // Item 61 Fix: Only serve index.html for page routes (return 404 for missing static assets with extensions)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (path.extname(req.path)) {
      return res.status(404).send('Static asset not found');
    }
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) next();
    });
  });
} else {
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>VocabMaster API Server</title>
          <meta charset="utf-8">
        </head>
        <body style="font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 90vh; background: #0f172a; color: #f8fafc; text-align: center; margin: 0;">
          <div style="background: #1e293b; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 480px;">
            <h1 style="color: #6366f1; margin-top: 0;">🚀 Backend Server Đang Chạy!</h1>
            <p style="color: #94a3b8; font-size: 1.05rem;">Đây là cổng API Backend (Port 5000). Giao diện ứng dụng chính chạy tại <b>Port 5173</b>.</p>
            <a href="http://localhost:5173" style="display: inline-block; margin-top: 1.2rem; padding: 12px 28px; background: linear-gradient(135deg, #4f46e5, #6366f1); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 1.1rem; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
              👉 Bấm Vào Đây Để Mở Web App (Port 5173)
            </a>
          </div>
        </body>
      </html>
    `);
  });
}

// Init DB and start server with Graceful Shutdown (Item 25, 26, 27 Fix)
let server = null;

initDb()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`🚀 VocabMaster Backend server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1); // Item 25 Fix: Clean process exit on DB init failure
  });

const gracefulShutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down server gracefully...`);
  try {
    await closeDb(); // Item 26 & 27 Fix: Unified DB pool drain / close
  } catch (e) {
    console.error('Error closing DB:', e.message);
  }

  if (server) {
    server.close(() => {
      console.log('HTTP Server closed cleanly.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
