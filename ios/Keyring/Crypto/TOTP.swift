import Foundation
import CryptoKit

/// RFC 6238 TOTP — same algorithm as web src/lib/totp.ts
enum TOTP {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

    static func base32Decode(_ input: String) throws -> Data {
        let clean = input.uppercased().filter { $0 != "=" && !$0.isWhitespace }
        var bits = 0
        var value = 0
        var out = [UInt8]()
        for ch in clean {
            guard let idx = alphabet.firstIndex(of: ch) else {
                throw NSError(domain: "TOTP", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid base32"])
            }
            let i = alphabet.distance(from: alphabet.startIndex, to: idx)
            value = (value << 5) | i
            bits += 5
            if bits >= 8 {
                out.append(UInt8((value >> (bits - 8)) & 0xff))
                bits -= 8
            }
        }
        return Data(out)
    }

    static func extractSecret(_ raw: String) -> String {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.lowercased().hasPrefix("otpauth://"), let url = URL(string: t),
           let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let secret = items.first(where: { $0.name == "secret" })?.value {
            return secret.uppercased()
        }
        return t.uppercased()
    }

    static func code(secret: String, digits: Int = 6, period: Int = 30, at date: Date = Date()) throws -> (code: String, secondsRemaining: Int) {
        let keyData = try base32Decode(extractSecret(secret))
        let counter = UInt64(date.timeIntervalSince1970) / UInt64(period)
        var msg = [UInt8](repeating: 0, count: 8)
        var c = counter
        for i in (0..<8).reversed() {
            msg[i] = UInt8(c & 0xff)
            c >>= 8
        }

        let key = SymmetricKey(data: keyData)
        let sig = HMAC<Insecure.SHA1>.authenticationCode(for: Data(msg), using: key)
        let bytes = Data(sig)
        let offset = Int(bytes[bytes.count - 1] & 0x0f)
        let binCode =
            (Int(bytes[offset] & 0x7f) << 24) |
            (Int(bytes[offset + 1]) << 16) |
            (Int(bytes[offset + 2]) << 8) |
            Int(bytes[offset + 3])
        let mod = Int(pow(10.0, Double(digits)))
        let code = String(format: "%0\(digits)d", binCode % mod)
        let elapsed = Int(date.timeIntervalSince1970) % period
        return (code, period - elapsed)
    }
}
