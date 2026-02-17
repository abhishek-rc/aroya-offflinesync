import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig) => {
  // Important: always return the modified config
  return mergeConfig(config, {
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    server: {
      // Allow ngrok hosts for remote access to admin panel
      // This is needed when accessing Strapi admin via ngrok tunnel
      allowedHosts: [
        '.ngrok.io',
        '.ngrok-free.app',
        '.ngrok-free.dev',
        'localhost',
        '127.0.0.1',
      ],
      // Alternative: Allow all hosts (less secure, use only for development)
      // host: '0.0.0.0',
    },
  });
};
