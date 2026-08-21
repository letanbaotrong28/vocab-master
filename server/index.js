import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
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

// CORS with whitelist
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Item 126 Fix: Structured Request Logging & Request ID Middleware
app.use((req, res, next) => {
  const requestId = Math.random().toString(36).substring(2, 9);
  req.requestId = requestId;
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });

  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VocabMaster Backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Item 127 Fix: Database Backup Download Endpoint
app.get('/api/admin/backup', authenticateToken, (req, res) => {
  const dbPath = path.join(__dirname, 'database.db');
  if (fs.existsSync(dbPath)) {
    res.download(dbPath, `vocabmaster_backup_${Date.now()}.db`);
  } else {
    res.status(404).json({ error: 'Không tìm thấy file CSDL SQLite cục bộ (Đang dùng Cloud PostgreSQL).' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sets', setsRoutes);

// Static serving for production dist build
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
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

// Init DB and start server with Graceful Shutdown (Item 128 Fix)
let server = null;

initDb()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`🚀 VocabMaster Backend server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err);
  });

const gracefulShutdown = (signal) => {
  console.log(`Received ${signal}. Shutting down server gracefully...`);
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
