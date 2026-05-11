# Tavla

Online iki kişilik klasik tavla (backgammon). Node + Socket.io + HTML5 Canvas.

## Özellikler

- Oda kodu ile iki oyuncu eşleşmesi
- Avatar + nick seçimi
- Hamle süresi sınırı (oda kuran ayarlar: yok / 30s / 60s / 2dk)
- Sürükle-bırak pul hareketi
- Tek sürüklemede kombine hamle (3+5 = 8 hamle tek pulla)
- Sıradaki oyuncu kartında yeşil canlı kenar
- Glass Twilight tasarım — koyu lacivert, glassmorphism, electric cyan vurgu

## Lokal Çalıştırma

```bash
npm install
npm start
# → http://localhost:3000
```

## Deploy (Railway)

`PORT` env değişkenini otomatik kullanır. Start komutu: `npm start`.

## Stack

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** Vanilla JS + HTML5 Canvas
- **Tipografi:** Space Grotesk + Inter + JetBrains Mono
