# Keyring iOS (SwiftUI)

Aplikasi iOS native dengan **logika & flow sama** seperti web Keyring:
- Supabase Auth (email + password)
- Zero-knowledge vault (master password hanya di device)
- Mine / Team vault, kategori, generator, TOTP
- Panggil API Next.js yang sama (Bearer token)

## Setup

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
2. Di folder `ios/`:
   ```bash
   xcodegen generate
   open Keyring.xcodeproj
   ```
3. Di Xcode, set **Signing Team** (Apple ID).
4. Buat `ios/Keyring/Config.swift` (lihat `Config.example.swift`) — isi URL & anon key Supabase + base URL app.

```
SUPABASE_URL=https://azvszagdpakwxaacaacd.supabase.co
SUPABASE_ANON_KEY=eyJ...
API_BASE_URL=https://pass-manager-5l3g.vercel.app
```

5. Run di simulator / device (iOS 16+).

## Flow (sama dengan web)

1. **Sign up / Sign in** → Supabase Auth  
2. **Create vault** → master password (PBKDF2 310k + AES-GCM)  
3. **Unlock** → isi Mine / Team logins  
4. **Team** → kategori yang di-grant owner  
5. **Generator**, **TOTP**, auto-lock idle  

Admin/Platform panel web-only di v1 ini (bisa dibuka di Safari).

## Catatan crypto

Disamakan dengan web (`src/lib/crypto.ts`):
- PBKDF2-HMAC-SHA256, 310 000 iterasi  
- AES-256-GCM  
- Format wrap: `base64(iv).base64(ct+tag)`  
- Item: field `ciphertext` & `iv` terpisah (base64)  

Master password **tidak pernah** dikirim ke server.
