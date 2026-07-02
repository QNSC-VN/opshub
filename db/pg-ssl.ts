/**
 * Strips `sslmode` from the connection URL and returns explicit ssl options.
 *
 * pg-connection-string v3 treats sslmode=require as verify-full, which fails
 * on Alpine (no Amazon RDS CA bundle). Passing ssl separately via the Pool
 * constructor opts out of that behaviour while still enabling TLS.
 */
export function pgOptions(url: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: false };
} {
  const needsSsl = /sslmode=(require|verify)/.test(url);
  if (!needsSsl) return { connectionString: url };
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
  } catch {
    return { connectionString: url, ssl: { rejectUnauthorized: false } };
  }
}
