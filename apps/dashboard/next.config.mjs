/** @type {import('next').NextConfig} */
const nextConfig = {
  // @schemap/react ships a real build (dist/) and no longer needs transpiling;
  // @schemap/core remains raw TS source, so it still does.
  transpilePackages: ["@schemap/core"],
};

export default nextConfig;
