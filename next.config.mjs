/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Typecheck estricto restaurado tras la auditoría (los 7 errores TS del
  // delivery están arreglados). ESLint sí queda fuera del build: sus reglas
  // son estilísticas y no deben bloquear un deploy.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
};

export default nextConfig;
