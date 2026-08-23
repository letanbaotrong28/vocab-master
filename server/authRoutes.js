import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getOne, run, withTransaction } from './db.js';
import { JWT_SECRET, authenticateToken } from './authMiddleware.js';

const router = express.Router();

// Item 80 Fix: Trust proxy IP resolution & rate limiter RAM map cleanup interval
const rateLimitMap = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 10 * 60 * 1000);

const authRateLimiter = (maxRequests = 10, windowMs = 60000) => (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const now = Date.now();
  const userRecord = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };

  if (now > userRecord.resetTime) {
    userRecord.count = 1;
    userRecord.resetTime = now + windowMs;
  } else {
    userRecord.count += 1;
  }

  rateLimitMap.set(ip, userRecord);

  if (userRecord.count > maxRequests) {
    return res.status(429).json({ error: 'Quá nhiều yêu cầu đăng nhập/đăng ký. Vui lòng thử lại sau 1 phút.' });
  }
  next();
};

// Item 69, 70, 81 Fix: Secure Cookie Setter & JWT Issuer/Audience Signer
const setAuthTokenCookie = (res, token) => {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

const signToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
    issuer: 'VocabMaster',
    audience: 'VocabMasterUser',
    algorithm: 'HS256'
  });
};

// Register new account
router.post('/register', authRateLimiter(10, 60000), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Tên tài khoản và mật khẩu phải là chuỗi văn bản.' });
    }

    // Item 78 Fix: Normalize Unicode NFC & enforce clean username policy
    const cleanUsername = String(username).normalize('NFC').trim().toLowerCase();

    if (!cleanUsername || !password) {
      return res.status(400).json({ error: 'Tên tài khoản và mật khẩu không được để trống.' });
    }

    if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Tên tài khoản chỉ được chứa chữ cái không dấu, chữ số, dấu gạch dưới, dấu gạch ngang và dấu chấm (3-30 ký tự).' });
    }

    if (password.length < 6 || password.length > 100) {
      return res.status(400).json({ error: 'Mật khẩu phải từ 6 đến 100 ký tự.' });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await run(
        'INSERT INTO users (username, password_hash, token_version) VALUES (?, ?, 1)',
        [cleanUsername, passwordHash]
      );

      const userId = result.lastID;
      const tokenVersion = 1;
      const payload = { id: userId, username: cleanUsername, tokenVersion };
      const token = signToken(payload);

      setAuthTokenCookie(res, token);

      return res.json({
        message: 'Đăng ký tài khoản thành công!',
        user: { id: userId, username: cleanUsername },
        token
      });
    } catch (dbErr) {
      if (dbErr.message && (dbErr.message.includes('UNIQUE') || dbErr.message.includes('duplicate') || dbErr.code === '23505')) {
        return res.status(400).json({ error: 'Tên tài khoản này đã được sử dụng. Vui lòng chọn tên khác.' });
      }
      throw dbErr;
    }
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đăng ký tài khoản.' });
  }
});

// Login
router.post('/login', authRateLimiter(10, 60000), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Tên tài khoản và mật khẩu phải là chuỗi văn bản.' });
    }

    const cleanUsername = String(username).normalize('NFC').trim().toLowerCase();

    if (!cleanUsername || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập tên tài khoản và mật khẩu.' });
    }

    const user = await getOne('SELECT * FROM users WHERE LOWER(username) = ?', [cleanUsername]);

    if (!user) {
      return res.status(401).json({ error: 'Tên tài khoản hoặc mật khẩu không chính xác.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Tên tài khoản hoặc mật khẩu không chính xác.' });
    }

    const tokenVersion = user.token_version || 1;
    const payload = { id: user.id, username: user.username, tokenVersion };
    const token = signToken(payload);

    setAuthTokenCookie(res, token);

    return res.json({
      message: 'Đăng nhập thành công!',
      user: { id: user.id, username: user.username },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đăng nhập.' });
  }
});

// Get current user info from token
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await getOne('SELECT id, username, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    return res.json({ user });
  } catch (err) {
    console.error('Get current user error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ.' });
  }
});

// Item 77 Fix: Change Password Endpoint issuing fresh token
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Dữ liệu mật khẩu không hợp lệ.' });
    }

    if (newPassword.length < 6 || newPassword.length > 100) {
      return res.status(400).json({ error: 'Mật khẩu mới phải từ 6 đến 100 ký tự.' });
    }

    const user = await getOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    const newVersion = (user.token_version || 1) + 1;
    await run('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?', [newHash, newVersion, req.user.id]);

    const newToken = signToken({ id: user.id, username: user.username, tokenVersion: newVersion });
    setAuthTokenCookie(res, newToken);

    return res.json({ message: 'Đổi mật khẩu thành công! Mật khẩu đã được cập nhật.', token: newToken });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đổi mật khẩu.' });
  }
});

// Logout All Devices Endpoint
router.post('/logout-all', authenticateToken, async (req, res) => {
  try {
    await run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]);
    res.clearCookie('token');
    return res.json({ message: 'Đã đăng xuất thành công khỏi tất cả thiết bị!' });
  } catch (err) {
    console.error('Logout all devices error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đăng xuất tất cả thiết bị.' });
  }
});

// Logout this browser session. Use /logout-all when every issued JWT must be revoked.
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    res.clearCookie('token');
    return res.json({ message: 'Đã đăng xuất thành công.' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đăng xuất.' });
  }
});

// Item 150 Fix: Complete Account & Data Deletion Endpoint
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await withTransaction(async (tx) => {
      await tx.run('DELETE FROM users WHERE id = ?', [userId]);
    });

    res.clearCookie('token');
    return res.json({ message: 'Đã xóa toàn bộ tài khoản và dữ liệu cá nhân thành công.' });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi xóa tài khoản.' });
  }
});

export default router;
