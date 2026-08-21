import jwt from 'jsonwebtoken';
import { getOne } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'vocabmaster_default_fallback_secret_key_2026';

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Chưa đăng nhập hoặc định dạng Bearer Token không hợp lệ.' });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, async (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    }

    try {
      // Check token version against database for server-side token revocation (Item 42 fix)
      const userDb = await getOne('SELECT id, username, token_version FROM users WHERE id = ?', [decodedUser.id]);
      if (!userDb || userDb.token_version !== decodedUser.tokenVersion) {
        return res.status(401).json({ error: 'Phiên đăng nhập đã bị thu hồi (Đã đăng xuất). Vui lòng đăng nhập lại.' });
      }

      req.user = { id: userDb.id, username: userDb.username, tokenVersion: userDb.token_version };
      next();
    } catch (dbErr) {
      return res.status(500).json({ error: 'Lỗi máy chủ khi xác thực phiên.' });
    }
  });
};
