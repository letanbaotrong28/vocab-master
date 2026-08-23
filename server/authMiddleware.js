import jwt from 'jsonwebtoken';
import { getOne } from './db.js';

const configuredJwtSecret = process.env.JWT_SECRET?.trim();
if (!configuredJwtSecret) {
  throw new Error('JWT_SECRET is required. Refusing to start with a public fallback secret.');
}
if (Buffer.byteLength(configuredJwtSecret, 'utf8') < 32) {
  throw new Error('JWT_SECRET must contain at least 32 bytes.');
}

export const JWT_SECRET = configuredJwtSecret;

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Định dạng Bearer Token không hợp lệ.', code: 'INVALID_AUTH_HEADER' });
  }

  const bearerToken = authHeader?.slice(7).trim();
  const token = bearerToken || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.', code: 'AUTH_REQUIRED' });
  }

  jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'VocabMaster',
    audience: 'VocabMasterUser'
  }, async (err, decodedUser) => {
    if (err) {
      return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.', code: 'INVALID_SESSION' });
    }

    try {
      // Check token version against database for server-side token revocation (Item 42 fix)
      const userDb = await getOne('SELECT id, username, token_version, is_admin FROM users WHERE id = ?', [decodedUser.id]);
      if (!userDb || userDb.token_version !== decodedUser.tokenVersion) {
        return res.status(401).json({ error: 'Phiên đăng nhập đã bị thu hồi (Đã đăng xuất). Vui lòng đăng nhập lại.', code: 'SESSION_REVOKED' });
      }

      req.user = {
        id: userDb.id,
        username: userDb.username,
        tokenVersion: userDb.token_version,
        isAdmin: userDb.is_admin === true || userDb.is_admin === 1
      };
      next();
    } catch (dbErr) {
      console.error('Authentication database error:', dbErr.message);
      return res.status(500).json({ error: 'Lỗi máy chủ khi xác thực phiên.' });
    }
  });
};
