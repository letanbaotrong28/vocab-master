import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { initDb, closeDb, getOne, run } from './db.js';
import authRoutes from './authRoutes.js';
import setsRoutes from './setsRoutes.js';
import { authenticateToken } from './authMiddleware.js';

const app = express();
const PORT = process.env.PORT || 5000;
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';

// Trust only explicitly configured proxy networks. A numeric hop count lets a
// client that reaches Express directly spoof X-Forwarded-For and evade the
// authentication rate limit. Render's internal proxy is covered by the private
// network aliases below; other providers can supply their documented CIDRs.
const configuredProxyRanges = (process.env.TRUST_PROXY || 'loopback,linklocal,uniquelocal')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
app.set('trust proxy', configuredProxyRanges);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = process.env.DIST_PATH
  ? path.resolve(process.env.DIST_PATH)
  : path.join(__dirname, '../dist');

const configuredOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const developmentOrigins = process.env.NODE_ENV === 'production'
  ? []
  : [
      'http://localhost:5173',
      'http://localhost:5000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5000',
      'http://127.0.0.1:4173',
      'http://localhost:4173'
    ];
const allowedOrigins = new Set([...configuredOrigins, ...developmentOrigins]);
const isPrivateDevelopmentOrigin = (origin) => {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.port && !['4173', '5000', '5173'].includes(parsed.port)) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname === '::1') return true;
    if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
    const secondOctet = Number(hostname.split('.')[1]);
    if (/^172\./.test(hostname) && secondOctet >= 16 && secondOctet <= 31) return true;
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(hostname);
  } catch {
    return false;
  }
};

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  xContentTypeOptions: true,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cookieParser());

// CORS is only relevant to API calls. Applying it globally also intercepts
// same-origin ES modules, which browsers fetch in CORS mode, and can leave the
// production page blank before React has a chance to start.
const apiCors = cors({
  credentials: true,
  origin: (origin, callback) => {
    // Allow requests with no origin, such as server-to-server and mobile clients.
    if (!origin) return callback(null, true);

    if (allowedOrigins.has(origin) || isPrivateDevelopmentOrigin(origin)) {
      return callback(null, true);
    }

    const corsError = new Error('Origin is not allowed by CORS policy.');
    corsError.code = 'CORS_DENIED';
    callback(corsError);
  }
});

app.use('/api', (req, res, next) => {
  const requestOrigin = (req.get('origin') || '').replace(/\/+$/, '');
  const sameOrigin = `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');

  // Same-origin API calls do not need CORS response headers and must always work,
  // including on Render preview URLs and custom domains.
  if (!requestOrigin || requestOrigin === sameOrigin) {
    return next();
  }

  return apiCors(req, res, next);
});

app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ limit: requestBodyLimit, extended: true }));

// Item 29 Fix: CSRF Validation Header Check for Mutating API Endpoints
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.path.startsWith('/api/')) {
    const hasBearerToken = /^Bearer\s+\S+$/i.test(req.headers['authorization'] || '');
    const hasAjaxHeader = req.headers['x-requested-with'] === 'XMLHttpRequest';
    if (!hasBearerToken && !hasAjaxHeader) {
      return res.status(403).json({ error: 'Yêu cầu bị từ chối do thiếu CSRF Validation Header.' });
    }
  }
  next();
});

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
    console.error('Database health check error:', err.message);
    res.status(503).json({
      status: 'error',
      db: 'disconnected',
      error: 'Database health check failed.',
      timestamp: new Date().toISOString()
    });
  }
});

// Item 58, 127 & P0 Fix (11, 12): Database Backup Download Endpoint with Admin Authorization & PostgreSQL Check
app.get('/api/admin/backup', authenticateToken, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập endpoint quản trị.' });
    }

    if (process.env.DATABASE_URL) {
      return res.status(400).json({ error: 'Tính năng backup file SQLite không khả dụng khi đang sử dụng Cloud PostgreSQL.' });
    }

    const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, 'database.db');
    const backupDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vocabmaster-backup-'));
    const backupPath = path.join(backupDirectory, 'database.db');
    const cleanupBackup = () => fs.promises.rm(backupDirectory, { recursive: true, force: true });

    if (fs.existsSync(dbPath)) {
      try {
        await run(`VACUUM INTO ?`, [backupPath]);
        res.download(backupPath, path.basename(backupPath), (downloadErr) => {
          cleanupBackup()
            .catch((cleanupErr) => {
              console.error('Backup cleanup error:', cleanupErr.message);
            })
            .finally(() => {
              if (downloadErr) next(downloadErr);
            });
        });
      } catch (vErr) {
        await cleanupBackup().catch((cleanupErr) => {
          console.error('Backup cleanup error:', cleanupErr.message);
        });
        console.error('SQLite backup error:', vErr.message);
        return res.status(500).json({ error: 'Không thể tạo bản sao lưu SQLite nhất quán.' });
      }
    } else {
      await cleanupBackup().catch(() => {});
      res.status(404).json({ error: 'Không tìm thấy file CSDL SQLite cục bộ.' });
    }
  } catch (err) {
    console.error('Backup endpoint error:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ khi xuất file backup.' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sets', setsRoutes);

// Item 60 Fix: Standard JSON 404 handler for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Endpoint API không tồn tại.',
    code: 'NOT_FOUND',
    path: req.originalUrl
  });
});

// Static serving for production dist build
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        // Always revalidate the HTML shell so it cannot reference assets from an older deploy.
        res.setHeader('Cache-Control', 'no-store, max-age=0');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Vite asset names include a content hash and are safe to cache permanently.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // Item 61 Fix: Only serve index.html for page routes (return 404 for missing static assets with extensions)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (path.extname(req.path)) {
      return res.status(404).send('Static asset not found');
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0');
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

// Consistent JSON errors for middleware/parser failures.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 'CORS_DENIED') {
    return res.status(403).json({ error: 'Origin không được phép truy cập API.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Nội dung JSON không hợp lệ.' });
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Nội dung yêu cầu vượt quá giới hạn cho phép.', code: 'PAYLOAD_TOO_LARGE' });
  }
  if (err.type === 'charset.unsupported' || err.status === 415) {
    return res.status(415).json({ error: 'Định dạng nội dung yêu cầu không được hỗ trợ.', code: 'UNSUPPORTED_MEDIA_TYPE' });
  }

  console.error('Unhandled request error:', err);
  if (req.path.startsWith('/api')) {
    return res.status(500).json({ error: 'Lỗi máy chủ nội bộ.' });
  }
  return next(err);
});

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
  if (server) {
    await new Promise((resolve) => {
      let settled = false;
      let forceCloseTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceCloseTimer);
        console.log('HTTP Server closed cleanly.');
        resolve();
      };
      forceCloseTimer = setTimeout(() => {
        console.warn('HTTP shutdown timeout reached; closing remaining connections.');
        server.closeAllConnections?.();
        finish();
      }, 10000);

      server.close(() => {
        finish();
      });
      server.closeIdleConnections?.();
    });
  }

  try {
    await closeDb();
  } catch (e) {
    console.error('Error closing DB:', e.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
