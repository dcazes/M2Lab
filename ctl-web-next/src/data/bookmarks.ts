export interface Bookmark {
  name: string
  url: string
  icon?: string
}

export const bookmarks: Bookmark[] = [
  { name: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { name: 'Docker Hub', url: 'https://hub.docker.com', icon: '🐳' },
  { name: 'npm', url: 'https://www.npmjs.com', icon: '📦' },
  { name: 'MDN', url: 'https://developer.mozilla.org', icon: '📚' },
  { name: 'Tailwind CSS', url: 'https://tailwindcss.com', icon: '🎨' },
  { name: 'React', url: 'https://react.dev', icon: '⚛️' },
  { name: 'TypeScript', url: 'https://www.typescriptlang.org', icon: '📘' },
  { name: 'Vite', url: 'https://vitejs.dev', icon: '⚡' },
  { name: 'Tailscale', url: 'https://tailscale.com', icon: '🔐' },
  { name: 'Portainer', url: 'http://localhost:9090', icon: '🐳' },
  { name: 'Homepage', url: 'http://localhost:8083', icon: '🏠' },
  { name: 'Beszel', url: 'http://localhost:8090', icon: '📈' },
]