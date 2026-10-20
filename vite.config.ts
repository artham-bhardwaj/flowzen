import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // React Flow (and the React runtime it pulls in) gets its own long-cached chunk, keeping the app chunk small.
      output: { manualChunks: { flow: ['@xyflow/react'] } },
    },
  },
});
