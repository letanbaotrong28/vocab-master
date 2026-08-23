export const createMemoryRateLimiter = ({
  maxRequests,
  windowMs,
  key = (req) => req.ip || 'unknown',
  message = 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'
}) => {
  const records = new Map();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [recordKey, record] of records.entries()) {
      if (now >= record.resetTime) records.delete(recordKey);
    }
  }, Math.max(windowMs, 60000));
  cleanupTimer.unref?.();

  return (req, res, next) => {
    const recordKey = String(key(req));
    const now = Date.now();
    let record = records.get(recordKey);

    if (!record || now >= record.resetTime) {
      record = { count: 0, resetTime: now + windowMs };
    }
    record.count += 1;
    records.set(recordKey, record);

    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - record.count)));
    res.setHeader('RateLimit-Reset', String(retryAfterSeconds));

    if (record.count > maxRequests) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    }

    return next();
  };
};

export const createConcurrencyLimiter = ({
  maxConcurrent,
  maxPerKey = 1,
  key = (req) => req.ip || 'unknown'
}) => {
  let activeCount = 0;
  const activeByKey = new Map();

  return (req, res, next) => {
    const requestKey = String(key(req));
    const keyCount = activeByKey.get(requestKey) || 0;
    if (keyCount >= maxPerKey) {
      return res.status(409).json({
        error: 'Một lần đồng bộ khác của tài khoản đang được xử lý.',
        code: 'MUTATION_BUSY',
        retryable: true
      });
    }
    if (activeCount >= maxConcurrent) {
      res.setHeader('Retry-After', '2');
      return res.status(503).json({
        error: 'Máy chủ đang xử lý nhiều lần đồng bộ. Vui lòng thử lại sau.',
        code: 'SERVER_BUSY',
        retryable: true
      });
    }

    activeCount += 1;
    activeByKey.set(requestKey, keyCount + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeCount = Math.max(0, activeCount - 1);
      const remaining = (activeByKey.get(requestKey) || 1) - 1;
      if (remaining <= 0) activeByKey.delete(requestKey);
      else activeByKey.set(requestKey, remaining);
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
};
