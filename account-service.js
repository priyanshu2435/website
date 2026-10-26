
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_MAX_AGE = 5 * 60 * 1000;
const PRICE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_BYTES = 72;

const databasePath = path.resolve(
  process.env.DATABASE_PATH ||
  path.join(__dirname, 'data', 'pricematch.sqlite')
);

let engineDb;
let db;
let sessionSecret;
let mailTransporter;
let transactionDepth = 0;

function persistDatabase() {
  if (transactionDepth > 0 || !engineDb) return;

  const temporaryPath = `${databasePath}.${process.pid}.tmp`;

  fs.writeFileSync(temporaryPath, Buffer.from(engineDb.export()));
  engineDb.run('PRAGMA foreign_keys = ON');
  fs.renameSync(temporaryPath, databasePath);
}

function createDatabaseAdapter() {
  const makeStatement = (sql) => ({
    get(...params) {
      const statement = engineDb.prepare(sql);
      statement.bind(params);

      try {
        return statement.step() ? statement.getAsObject() : undefined;
      } finally {
        statement.free();
      }
    },

    all(...params) {
      const statement = engineDb.prepare(sql);
      statement.bind(params);
      const rows = [];

      try {
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
      } finally {
        statement.free();
      }
    },

    run(...params) {
      const statement = engineDb.prepare(sql);
      statement.bind(params);

      try {
        while (statement.step()) {
          // Consume any RETURNING rows before releasing the statement.
        }

        const changes = engineDb.getRowsModified();
        const lastInsertRowid =
          engineDb.exec('SELECT last_insert_rowid() AS id')[0]
            ?.values[0]?.[0] || 0;

        return { changes, lastInsertRowid };
      } finally {
        statement.free();
        persistDatabase();
      }
    }
  });

  return {
    prepare: makeStatement,

    exec(sql) {
      engineDb.exec(sql);
      persistDatabase();
    },

    transaction(callback) {
      return (...args) => {
        engineDb.run('BEGIN');
        transactionDepth += 1;

        try {
          const result = callback(...args);
          engineDb.run('COMMIT');
          return result;
        } catch (error) {
          engineDb.run('ROLLBACK');
          throw error;
        } finally {
          transactionDepth -= 1;
          persistDatabase();
        }
      };
    }
  };
}

async function initializeAccountDatabase() {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
  });

  const existingDatabase = fs.existsSync(databasePath)
    ? new Uint8Array(fs.readFileSync(databasePath))
    : undefined;

  engineDb = new SQL.Database(existingDatabase);
  engineDb.run('PRAGMA foreign_keys = ON');
  db = createDatabaseAdapter();

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expiry_idx
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      current_price REAL NOT NULL CHECK(current_price > 0),
      product_url TEXT NOT NULL,
      image_url TEXT NOT NULL,
      last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_name, platform)
    );

    CREATE INDEX IF NOT EXISTS price_alerts_user_idx
      ON price_alerts(user_id, created_at);
  `);

  const existingSecret = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('session_secret');

  sessionSecret =
    process.env.SESSION_SECRET ||
    existingSecret?.value ||
    crypto.randomBytes(48).toString('hex');

  if (!existingSecret) {
    db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?)'
    ).run('session_secret', sessionSecret);
  }
}

class SqliteSessionStore extends session.Store {
  constructor() {
    super();

    this.getSession = db.prepare(
      'SELECT sess, expires_at FROM sessions WHERE sid = ?'
    );

    this.setSession = db.prepare(`
      INSERT INTO sessions (sid, sess, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        sess = excluded.sess,
        expires_at = excluded.expires_at
    `);

    this.deleteSession = db.prepare(
      'DELETE FROM sessions WHERE sid = ?'
    );

    this.expireSessions = db.prepare(
      'DELETE FROM sessions WHERE expires_at <= ?'
    );
  }

  get(sid, callback) {
    try {
      const record = this.getSession.get(sid);

      if (!record) return callback(null, null);

      if (record.expires_at <= Date.now()) {
        this.deleteSession.run(sid);
        return callback(null, null);
      }

      return callback(null, JSON.parse(record.sess));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, value, callback) {
    try {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + SESSION_MAX_AGE;

      this.setSession.run(sid, JSON.stringify(value), expiresAt);

      if (callback) callback(null);
    } catch (error) {
      if (callback) return callback(error);
      throw error;
    }
  }

  destroy(sid, callback) {
    try {
      this.deleteSession.run(sid);

      if (callback) callback(null);
    } catch (error) {
      if (callback) return callback(error);
      throw error;
    }
  }

  touch(sid, value, callback) {
    try {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + SESSION_MAX_AGE;

      db.prepare(
        'UPDATE sessions SET expires_at = ? WHERE sid = ?'
      ).run(expiresAt, sid);

      if (callback) callback(null);
    } catch (error) {
      if (callback) return callback(error);
      throw error;
    }
  }
}

const mailSettings = () => {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const from = String(
    process.env.SMTP_FROM || process.env.SMTP_USER || ''
  ).trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';

  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !from ||
    !user ||
    !pass
  ) {
    return null;
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    from,
    user,
    pass
  };
};

const isEmailConfigured = () => mailSettings() !== null;

async function sendEmail({ to, subject, text, html }) {
  const settings = mailSettings();

  if (!settings) {
    throw new Error(
      'SMTP is not fully configured. Set SMTP_HOST, SMTP_FROM, SMTP_PORT, SMTP_USER, and SMTP_PASS.'
    );
  }

  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: !settings.secure && settings.port === 587,
      auth: {
        user: settings.user,
        pass: settings.pass
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000
    });
  }

  await mailTransporter.sendMail({
    from: settings.from,
    to,
    subject,
    text,
    html
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function makeVerificationToken(userId) {
  const otp = crypto.randomInt(100000, 1000000).toString();

  const tokenHash = crypto
    .createHash('sha256')
    .update(`${userId}:${otp}`)
    .digest('hex');

  const transaction = db.transaction(() => {
    db.prepare(
      'DELETE FROM email_verification_tokens WHERE user_id = ?'
    ).run(userId);

    db.prepare(`
      INSERT INTO email_verification_tokens
        (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(tokenHash, userId, Date.now() + VERIFICATION_MAX_AGE);
  });

  transaction();
  return otp;
}

async function sendVerificationEmail(email, otp) {
  await sendEmail({
    to: email,
    subject: 'Your PriceMatch email verification code',
    text: `Your PriceMatch verification code is ${otp}. It expires in 5 minutes. Do not share this code with anyone.`,
    html: `
      <div style="font-family:Arial,sans-serif;padding:24px">
        <h2>Verify your email</h2>
        <p>Your 6-digit verification code is:</p>
        <h1 style="letter-spacing:8px">${otp}</h1>
        <p>This code expires in 5 minutes.</p>
        <p>Do not share this code with anyone.</p>
      </div>
    `
  });
}

async function sendPriceDropEmail(alert, email, price) {
  const productLink = escapeHtml(alert.product_url);
  const productName = escapeHtml(alert.product_name);
  const platform = escapeHtml(alert.platform);

  const oldPrice = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(alert.current_price);

  const newPrice = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(price);

  await sendEmail({
    to: email,
    subject: `Price drop: ${alert.product_name} on ${alert.platform}`,
    text: `${alert.product_name} on ${alert.platform} dropped from ${oldPrice} to ${newPrice}.\nView the latest offer: ${alert.product_url}`,
    html: `<p>The price of <strong>${productName}</strong> on <strong>${platform}</strong> just dropped.</p><p><del>${escapeHtml(oldPrice)}</del> &rarr; <strong>${escapeHtml(newPrice)}</strong></p><p><a href="${productLink}">View the latest offer</a></p><p>You receive this email because you saved this price alert on PriceMatch.</p>`
  });
}

const requireAuthentication = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({
      error: 'Please sign in to continue.'
    });
  }

  next();
};

const publicBaseUrl = (req) =>
  process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

// Supported platforms used by the price-alert routes.
const PLATFORM_DOMAINS = {
  Amazon: 'amazon.in',
  Flipkart: 'flipkart.com',
  Myntra: 'myntra.com',
  Meesho: 'meesho.com',
  Blinkit: 'blinkit.com',
  BigBasket: 'bigbasket.com',
  Zepto: 'zepto.com'
};

function cleanText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function registerAccountRoutes(app, { fetchLiveItems, officialProductUrl }) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);

  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    const origin = req.get('origin');
    const requestOrigin = `${req.protocol}://${req.get('host')}`;

    if (
      (origin && origin !== requestOrigin) ||
      req.get('sec-fetch-site') === 'cross-site'
    ) {
      return res.status(403).json({
        error: 'Cross-origin requests are not allowed.'
      });
    }

    next();
  });

  app.use(session({
    name: 'pricematch.sid',
    secret: sessionSecret,
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE
    }
  }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: 'Too many sign-in attempts. Please try again in 15 minutes.'
    }
  });

  app.post('/api/auth/register', authLimiter, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';

      const password = typeof req.body?.password === 'string'
        ? req.body.password
        : '';

      if (
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return res.status(400).json({
          error: 'Enter a valid email address.'
        });
      }

      if (
        [...password].length < PASSWORD_MIN_LENGTH ||
        Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES
      ) {
        return res.status(400).json({
          error: `Use a password with at least ${PASSWORD_MIN_LENGTH} characters (maximum ${PASSWORD_MAX_BYTES} UTF-8 bytes).`
        });
      }

      if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        return res.status(409).json({
          error: 'An account with this email already exists. Sign in instead.'
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const result = db.prepare(`
        INSERT OR IGNORE INTO users (email, password_hash)
        VALUES (?, ?)
      `).run(email, passwordHash);

      if (!result.changes) {
        return res.status(409).json({
          error: 'An account with this email already exists. Sign in instead.'
        });
      }

      const userId = Number(result.lastInsertRowid);

      await new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      req.session.userId = userId;

      let verificationEmail = 'not_configured';

      if (isEmailConfigured()) {
        const otp = makeVerificationToken(userId);

        try {
          await sendVerificationEmail(email, otp);
          verificationEmail = 'sent';
        } catch (error) {
          console.error(
            '[PriceMatch] Verification email could not be sent:',
            error.message
          );
          verificationEmail = 'failed';
        }
      }

      return res.status(201).json({
        user: {
          id: userId,
          email,
          emailVerified: false
        },
        emailConfigured: isEmailConfigured(),
        verificationEmail
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';

      const password = typeof req.body?.password === 'string'
        ? req.body.password
        : '';

      const user = db.prepare(`
        SELECT id, email, password_hash, email_verified_at
        FROM users
        WHERE email = ?
      `).get(email);

      const validPassword =
        user && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES
          ? await bcrypt.compare(password, user.password_hash)
          : false;

      if (!user || !validPassword) {
        return res.status(401).json({
          error: 'Email or password is incorrect.'
        });
      }

      if (!user.email_verified_at) {
        return res.status(403).json({
          error: 'Please verify your email before signing in.',
          emailVerified: false
        });
      }

      await new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      req.session.userId = user.id;

      return res.json({
        user: {
          id: user.id,
          email: user.email,
          emailVerified: Boolean(user.email_verified_at)
        },
        emailConfigured: isEmailConfigured()
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/logout', requireAuthentication, async (req, res, next) => {
    try {
      await new Promise((resolve, reject) => {
        req.session.destroy((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      res.clearCookie('pricematch.sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.session.userId) {
      return res.json({
        user: null,
        emailConfigured: isEmailConfigured()
      });
    }

    const user = db.prepare(`
      SELECT id, email, email_verified_at
      FROM users
      WHERE id = ?
    `).get(req.session.userId);

    if (!user) {
      return req.session.destroy((error) => {
        if (error) {
          return res.status(500).json({
            error: 'Could not verify the current session.'
          });
        }

        return res.json({
          user: null,
          emailConfigured: isEmailConfigured()
        });
      });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: Boolean(user.email_verified_at)
      },
      emailConfigured: isEmailConfigured()
    });
  });

  app.post(
    '/api/auth/verification/resend',
    requireAuthentication,
    authLimiter,
    async (req, res, next) => {
      try {
        const user = db.prepare(`
          SELECT id, email, email_verified_at
          FROM users
          WHERE id = ?
        `).get(req.session.userId);

        if (!user) {
          return res.status(401).json({
            error: 'Please sign in again.'
          });
        }

        if (user.email_verified_at) {
          return res.status(409).json({
            error: 'This email address is already verified.'
          });
        }

        if (!isEmailConfigured()) {
          return res.status(503).json({
            error: 'Email delivery is not configured. Set SMTP settings in the server environment first.'
          });
        }

        const otp = makeVerificationToken(user.id);
        await sendVerificationEmail(user.email, otp);

        return res.json({ ok: true });
      } catch (error) {
        return next(error);
      }
    }
  );

  app.post('/api/auth/verify', authLimiter, (req, res) => {
    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

    const otp = typeof req.body?.otp === 'string'
      ? req.body.otp.trim()
      : '';

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\d{6}$/.test(otp)
    ) {
      return res.status(400).json({
        error: 'Enter a valid email address and 6-digit OTP.'
      });
    }

    const user = db.prepare(`
      SELECT id, email_verified_at
      FROM users
      WHERE email = ?
    `).get(email);

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired OTP. Request a new code.'
      });
    }

    if (user.email_verified_at) {
      return res.json({
        ok: true,
        emailVerified: true
      });
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(`${user.id}:${otp}`)
      .digest('hex');

    const verification = db.prepare(`
      SELECT token_hash, expires_at
      FROM email_verification_tokens
      WHERE token_hash = ? AND user_id = ?
    `).get(tokenHash, user.id);

    if (!verification || verification.expires_at <= Date.now()) {
      if (verification) {
        db.prepare(`
          DELETE FROM email_verification_tokens
          WHERE token_hash = ?
        `).run(tokenHash);
      }

      return res.status(400).json({
        error: 'Invalid or expired OTP. Request a new code.'
      });
    }

    const markVerified = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET email_verified_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(user.id);

      db.prepare(`
        DELETE FROM email_verification_tokens
        WHERE user_id = ?
      `).run(user.id);
    });

    markVerified();

    return res.json({
      ok: true,
      emailVerified: true
    });
  });


    app.get('/api/alerts', requireAuthentication, (req, res) => {
    const alerts = db.prepare(`
      SELECT
        id,
        product_name AS productName,
        platform,
        current_price AS currentPrice,
        product_url AS productUrl,
        image_url AS image,
        last_checked_at AS lastCheckedAt,
        created_at AS createdAt
      FROM price_alerts
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(req.session.userId);

    return res.json({
      alerts,
      emailConfigured: isEmailConfigured()
    });
  });

  app.post('/api/alerts', requireAuthentication, async (req, res, next) => {
    try {
      const user = db.prepare(`
        SELECT email_verified_at
        FROM users
        WHERE id = ?
      `).get(req.session.userId);

      if (!user?.email_verified_at) {
        return res.status(403).json({
          error: 'Verify your email address before creating price alerts.'
        });
      }

      if (!isEmailConfigured()) {
        return res.status(503).json({
          error: 'Email delivery is not configured. Set SMTP settings before creating a price alert.'
        });
      }

      const productName =
        typeof req.body?.productName === 'string'
          ? cleanText(req.body.productName).slice(0, 250)
          : '';

      const platform =
        typeof req.body?.platform === 'string'
          ? req.body.platform
          : '';

      const allowedPlatforms = new Set(Object.keys(PLATFORM_DOMAINS));

      if (!productName || !allowedPlatforms.has(platform)) {
        return res.status(400).json({
          error: 'Select a product from a supported store.'
        });
      }

      if (!String(process.env.SERPAPI_KEY || '').trim()) {
        return res.status(503).json({
          error: 'Live product search is not configured. Set SERPAPI_KEY before creating price alerts.'
        });
      }

      const liveItems = await fetchLiveItems(productName);
      const matchingItems = liveItems.filter(
        (item) => item.platform === platform
      );

      const matchedItem = findMatchingProduct(
        matchingItems,
        productName
      );

      if (!matchedItem) {
        return res.status(404).json({
          error: `Could not verify a current ${platform} price for this product. Search again and retry.`
        });
      }

      const insert = db.prepare(`
        INSERT OR IGNORE INTO price_alerts
          (user_id, product_name, platform, current_price, product_url, image_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        req.session.userId,
        matchedItem.name,
        matchedItem.platform,
        matchedItem.price,
        officialProductUrl(
          matchedItem.platform,
          productName,
          matchedItem.name
        ),
        matchedItem.image
      );

      const alert = db.prepare(`
        SELECT
          id,
          product_name AS productName,
          platform,
          current_price AS currentPrice
        FROM price_alerts
        WHERE user_id = ? AND product_name = ? AND platform = ?
      `).get(
        req.session.userId,
        matchedItem.name,
        matchedItem.platform
      );

      return res
        .status(insert.changes ? 201 : 200)
        .json({
          alert,
          alreadyWatching: !insert.changes
        });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/alerts/:id', requireAuthentication, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'Invalid alert.'
      });
    }

    const result = db.prepare(`
      DELETE FROM price_alerts
      WHERE id = ? AND user_id = ?
    `).run(id, req.session.userId);

    if (!result.changes) {
      return res.status(404).json({
        error: 'Alert not found.'
      });
    }

    return res.json({ ok: true });
  });

  db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .run(Date.now());

  db.prepare(
    'DELETE FROM email_verification_tokens WHERE expires_at <= ?'
  ).run(Date.now());

  setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(Date.now());

    db.prepare(
      'DELETE FROM email_verification_tokens WHERE expires_at <= ?'
    ).run(Date.now());
  }, 60 * 60 * 1000).unref();
}

function normalizeProductName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findMatchingProduct(items, productName) {
  const target = normalizeProductName(productName);

  let bestMatch;
  let bestScore = 0;

  for (const item of items) {
    const candidate = normalizeProductName(item.name);

    if (
      candidate === target ||
      candidate.includes(target) ||
      target.includes(candidate)
    ) {
      return item;
    }

    const targetWords = new Set(
      target.split(/\s+/).filter(Boolean)
    );

    const candidateWords = new Set(
      candidate.split(/\s+/).filter(Boolean)
    );

    const overlap = [...targetWords].filter(
      (word) => candidateWords.has(word)
    ).length;

    const score =
      overlap /
      Math.max(targetWords.size, candidateWords.size, 1);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestScore >= 0.55 ? bestMatch : null;
}

async function checkSavedPriceAlerts(
  fetchLiveItems,
  officialProductUrl
) {
  if (!isEmailConfigured()) return;

  if (!String(process.env.SERPAPI_KEY || '').trim()) {
    console.warn(
      '[PriceMatch] Price alerts are paused because SERPAPI_KEY is not configured.'
    );
    return;
  }

  const alerts = db.prepare(`
    SELECT a.*, u.email
    FROM price_alerts a
    JOIN users u ON u.id = a.user_id
    WHERE u.email_verified_at IS NOT NULL
    ORDER BY a.id
  `).all();

  for (const alert of alerts) {
    try {
      const liveItems = await fetchLiveItems(alert.product_name);

      const match = findMatchingProduct(
        liveItems.filter(
          (item) => item.platform === alert.platform
        ),
        alert.product_name
      );

      if (!match) {
        console.warn(
          `[PriceMatch] No matching live offer found for price alert ${alert.id}.`
        );
        continue;
      }

      if (match.price < alert.current_price) {
        await sendPriceDropEmail(
          alert,
          alert.email,
          match.price
        );
      }

      db.prepare(`
        UPDATE price_alerts
        SET
          current_price = ?,
          product_url = ?,
          image_url = ?,
          last_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        match.price,
        officialProductUrl(
          match.platform,
          alert.product_name,
          match.name
        ),
        match.image,
        alert.id
      );
    } catch (error) {
      console.error(
        `[PriceMatch] Price check for alert ${alert.id} failed:`,
        error.message
      );
    }
  }
}

function startPriceAlertMonitor(
  fetchLiveItems,
  officialProductUrl
) {
  setInterval(() => {
    checkSavedPriceAlerts(
      fetchLiveItems,
      officialProductUrl
    ).catch((error) => {
      console.error(
        '[PriceMatch] Price alert run failed:',
        error.message
      );
    });
  }, PRICE_CHECK_INTERVAL).unref();
}

module.exports = {
  initializeAccountDatabase,
  registerAccountRoutes,
  startPriceAlertMonitor,
  isEmailConfigured,
  PRICE_CHECK_INTERVAL
};