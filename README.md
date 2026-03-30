# Image Enlargement & Enhancement

A browser-based image enlargement and enhancement tool with AI models running locally.

## Features

- 📤 Drag & drop or click to upload images
- 🔍 Upscale images by 2x or 4x
- ✨ Enhancement options: Denoise, Sharpen, Color Enhancement
- 🔒 Privacy-first: Images are processed locally in your browser
- 💾 No server uploads - everything stays on your device

## Tech Stack

- **Framework**: Next.js 15
- **Styling**: Tailwind CSS
- **Deployment**: Vercel (Static Export)

## Getting Started

### Install dependencies

```bash
npm install
```

### Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Build for production

```bash
npm run build
```

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── components/
├── public/
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## Privacy

This tool processes all images entirely within your browser using the Canvas API and CSS filters. **No images are ever uploaded to any server.** Your images remain on your device throughout the entire process.

## License

MIT
