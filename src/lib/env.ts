/** PUBLIC_BASE_URL without a trailing slash ("https://x.aiven.app/" -> "https://x.aiven.app"). */
export const publicBase = () => (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
