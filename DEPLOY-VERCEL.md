# Deploy Vercel

1. Faça login na Vercel (https://vercel.com/) com sua conta GitHub.
2. Clique em "Add New Project" e selecione o repositório `camera-chess`.
3. Configure:
   - Framework: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Root Directory: deixe em branco ou `.`
4. Clique em "Deploy".

A Vercel irá instalar as dependências, buildar e publicar automaticamente.

Se quiser rodar localmente antes:

```sh
npm install
npm run build
npm run preview
```

O arquivo `vercel.json` já está configurado para SPA.
