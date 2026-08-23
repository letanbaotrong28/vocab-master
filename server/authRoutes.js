import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getOne, isPg, run, withTransaction } from './db.js';
import { JWT_SECRET, authenticateToken } from './authMiddleware.js';
import { createMemoryRateLimiter } from './rateLimit.js';
import { getStreakSnapshot, validateClientDate } from './streak.js';

const router = express.Router();

const authLimiterOptions = {
  maxRequests: 10,
  windowMs: 60000,
  key: (req) => req.ip || 'unknown',
  message: 'Quá nhiều yêu cầu xác thực. Vui lòng thử lại sau 1 phút.'
};
// Separate stores prevent registration traffic from consuming login attempts.
const registerRateLimiter = createMemoryRateLimiter(authLimiterOptions);
const loginRateLimiter = createMemoryRateLimiter(authLimiterOptions);

// Item 69, 70, 81 Fix: Secure Cookie Setter & JWT Issuer/Audience Signer
const authCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
});

const setAuthTokenCookie = (res, token) => {
  res.cookie('token', token, authCookieOptions());
};

const clearAuthTokenCookie = (res) => {
  const clearOptions = authCookieOptions();
  delete clearOptions.maxAge;
  res.clearCookie('token', clearOptions);
};

const signToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
    issuer: 'VocabMaster',
    audience: 'VocabMasterUser',
    algorithm: 'HS256'
  });
};

const resolveLocalDate = (value) => validateClientDate(value);

const serializeStreak = (user, localDate) => getStreakSnapshot(
  user.streak_count,
  user.last_study_date,
  localDate
);

const serializeUser = (user, streak) => ({
  id: user.id,
  username: user.username,
  ...(user.created_at !== undefined ? { created_at: user.created_at } : {}),
  streak
});

// Register new account
router.post('/register', registerRateLimiter, async (req, res) => {
  try {
    const { username, password, localDate } = req.body || {};

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
    if (bcrypt.truncates(password)) {
      return res.status(400).json({
        error: 'Mật khẩu không được vượt quá 72 byte UTF-8.',
        code: 'PASSWORD_TOO_LONG'
      });
    }

    const dateResult = resolveLocalDate(localDate);
    if (dateResult.error) {
      return res.status(400).json({ error: dateResult.error, code: 'INVALID_LOCAL_DATE' });
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

      const streak = { count: 0, lastStudyDate: null };
      return res.status(201).json({
        message: 'Đăng ký tài khoản thành công!',
        user: serializeUser({ id: userId, username: cleanUsername }, streak),
        streak
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
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { username, password, localDate } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Tên tài khoản và mật khẩu phải là chuỗi văn bản.' });
    }

    const cleanUsername = String(username).normalize('NFC').trim().toLowerCase();

    if (!cleanUsername || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập tên tài khoản và mật khẩu.' });
    }

    const dateResult = resolveLocalDate(localDate);
    if (dateResult.error) {
      return res.status(400).json({ error: dateResult.error, code: 'INVALID_LOCAL_DATE' });
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

    const streak = serializeStreak(user, dateResult.date);
    const passwordNeedsUpgrade = bcrypt.truncates(password);

    return res.json({
      message: 'Đăng nhập thành công!',
      user: serializeUser(user, streak),
      streak,
      passwordNeedsUpgrade
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đăng nhập.' });
  }
});

// Get current user info from token
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const dateResult = resolveLocalDate(req.query.localDate);
    if (dateResult.error) {
      return res.status(400).json({ error: dateResult.error, code: 'INVALID_LOCAL_DATE' });
    }

    const user = await getOne(
      'SELECT id, username, streak_count, last_study_date, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    const streak = serializeStreak(user, dateResult.date);
    return res.json({ user: serializeUser(user, streak), streak });
  } catch (err) {
    console.error('Get current user error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ.' });
  }
});

// Item 77 Fix: Change Password Endpoint issuing fresh token
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Dữ liệu mật khẩu không hợp lệ.' });
    }
    if (oldPassword.length > 100) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại không hợp lệ.' });
    }

    if (newPassword.length < 6 || newPassword.length > 100) {
      return res.status(400).json({ error: 'Mật khẩu mới phải từ 6 đến 100 ký tự.' });
    }
    if (bcrypt.truncates(newPassword)) {
      return res.status(400).json({
        error: 'Mật khẩu mới không được vượt quá 72 byte UTF-8.',
        code: 'PASSWORD_TOO_LONG'
      });
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
    const oldVersion = user.token_version || 1;
    const newVersion = oldVersion + 1;
    const updateResult = await run(
      `UPDATE users SET password_hash = ?, token_version = ?
       WHERE id = ? AND password_hash = ? AND token_version = ?`,
      [newHash, newVersion, req.user.id, user.password_hash, oldVersion]
    );
    if (updateResult.changes !== 1) {
      return res.status(409).json({
        error: 'Tài khoản vừa được thay đổi ở một phiên khác. Vui lòng đăng nhập lại.',
        code: 'PASSWORD_CHANGE_CONFLICT'
      });
    }

    const newToken = signToken({ id: user.id, username: user.username, tokenVersion: newVersion });
    setAuthTokenCookie(res, newToken);

    return res.json({ message: 'Đổi mật khẩu thành công! Mật khẩu đã được cập nhật.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đổi mật khẩu.' });
  }
});

// Logout All Devices Endpoint
router.post('/logout-all', authenticateToken, async (req, res) => {
  try {
    await run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]);
    clearAuthTokenCookie(res);
    return res.json({ message: 'Đã đăng xuất thành công khỏi tất cả thiết bị!' });
  } catch (err) {
    console.error('Logout all devices error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi đăng xuất tất cả thiết bị.' });
  }
});

// Cookie logout is intentionally idempotent, including when the cookie expired.
router.post('/logout', (req, res) => {
  clearAuthTokenCookie(res);
  return res.json({ message: 'Đã đăng xuất thành công.' });
});

// Item 150 Fix: Complete Account & Data Deletion Endpoint
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await withTransaction(async (tx) => {
      await tx.getOne(`SELECT id FROM users WHERE id = ?${isPg ? ' FOR UPDATE' : ''}`, [userId]);
      await tx.query(`SELECT id FROM vocab_sets WHERE user_id = ?${isPg ? ' FOR UPDATE' : ''}`, [userId]);
      // Explicit cleanup also protects installations created before cascade
      // constraints were normalized by the current migration.
      await tx.run('DELETE FROM card_progress WHERE user_id = ?', [userId]);
      await tx.run('DELETE FROM cards WHERE set_id IN (SELECT id FROM vocab_sets WHERE user_id = ?)', [userId]);
      await tx.run('DELETE FROM vocab_sets WHERE user_id = ?', [userId]);
      await tx.run('DELETE FROM users WHERE id = ?', [userId]);
    });

    clearAuthTokenCookie(res);
    return res.json({ message: 'Đã xóa toàn bộ tài khoản và dữ liệu cá nhân thành công.' });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Lỗi máy chủ khi xóa tài khoản.' });
  }
});

export default router;
