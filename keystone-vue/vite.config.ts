import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080'

// 本机 5173 已被其他项目占用，本脚手架默认使用 5180，可通过 VITE_PORT 覆盖。
const serverPort = Number(process.env.VITE_PORT || 5180)
const previewPort = Number(process.env.VITE_PREVIEW_PORT || 4180)

// 局域网访问用的额外 Host 白名单，逗号分隔。Vite 默认已放行 IPv4 字面量与
// localhost，因此用 http://192.168.x.x:5180 访问无需任何配置；只有当同事用
// 计算机名访问（如 http://DESKTOP-ABC:5180）时才需要在此声明对应主机名。
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 监听所有网卡，使同一局域网内的同事可通过本机 IP 直接访问开发服务器；
    // /api 代理仍在本机转发到后端，后端无需对外暴露。
    host: true,
    port: serverPort,
    // 端口被占用时直接失败而非自动递增，避免同事按固定端口访问时连不上。
    strictPort: true,
    open: true,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        // 转发时附加 X-Forwarded-For / X-Forwarded-Host 等头：后端凭它记录访问者的真实 IP
        // （登录日志、操作日志）。不开启时，同事经本机代理访问，日志里只会出现代理所在机器的地址。
        xfwd: true,
      },
    },
  },
  preview: {
    // 预览构建产物时同样支持局域网访问。
    host: true,
    port: previewPort,
    strictPort: true,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
  },
})