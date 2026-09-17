import Foundation

#if canImport(CryptoKit)
import CryptoKit
#endif
import CommonCrypto

// MARK: - Base64 helpers (match web toB64 / fromB64)

enum B64 {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
    }

    static func decode(_ s: String) -> Data? {
        Data(base64Encoded: s)
    }
}

// MARK: - PBKDF2 (SHA-256) — same as web deriveKek

enum PBKDF2 {
    static func deriveKey(password: String, salt: Data, iterations: Int) -> Data {
        let passwordBytes = [UInt8](password.utf8)
        let saltBytes = [UInt8](salt)
        var derived = Data(count: 32)
        derived.withUnsafeMutableBytes { derivedBytes in
            let dest = derivedBytes.bindMemory(to: UInt8.self).baseAddress!
            CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2),
                passwordBytes,
                passwordBytes.count,
                saltBytes,
                saltBytes.count,
                CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                UInt32(iterations),
                dest,
                32
            )
        }
        return derived
    }
}

// MARK: - AES-GCM (CryptoKit) matching WebCrypto layout

enum AESGCM {
    /// Encrypt → WebCrypto style: iv (12) || ciphertext || tag (16) as single buffer,
    /// then packed as base64(iv) + "." + base64(ct||tag) for wrapped keys.
    static func seal(_ plaintext: Data, key: Data, iv: Data) throws -> Data {
        let symmetric = try SymmetricKey(data: key)
        let nonce = try AES.GCM.Nonce(data: iv)
        let box = try AES.GCM.seal(plaintext, using: symmetric, nonce: nonce)
        // CryptoKit stores ciphertext without tag separately; combined = ciphertext + tag
        var out = Data()
        out.append(box.ciphertext)
        out.append(box.tag)
        return out
    }

    static func open(_ sealed: Data, key: Data, iv: Data) throws -> Data {
        let symmetric = try SymmetricKey(data: key)
        let nonce = try AES.GCM.Nonce(data: iv)
        guard sealed.count >= 16 else { throw VaultCryptoError.corruptPayload }
        let ciphertext = sealed.prefix(sealed.count - 16)
        let tag = sealed.suffix(16)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        return try AES.GCM.open(box, using: symmetric)
    }
}

enum VaultCryptoError: LocalizedError {
    case corruptPayload
    case wrongPassword
    case unsupported

    var errorDescription: String? {
        switch self {
        case .corruptPayload: return "Corrupt encrypted payload."
        case .wrongPassword: return "Incorrect master password."
        case .unsupported: return "Crypto operation failed."
        }
    }
}

// MARK: - Vault setup / unlock (same hierarchy as web)

struct VaultProfile: Codable {
    var kdfSalt: String
    var wrappedDek: String
    var verifier: String
    var wrappedDekPasskey: String?
    var passkeyPrfSalt: String?
    var kdfIterations: Int?
}

enum VaultCrypto {
    static let pbkdf2Iterations = 310_000
    private static let verifierText = "keyring-vault-verifier-v1"

    static func randomBytes(_ n: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
        return Data(bytes)
    }

    private static func pack(_ iv: Data, _ ctWithTag: Data) -> String {
        "\(B64.encode(iv)).\(B64.encode(ctWithTag))"
    }

    private static func unpack(_ packed: String) throws -> (iv: Data, ct: Data) {
        let parts = packed.split(separator: ".")
        guard parts.count == 2,
              let iv = B64.decode(String(parts[0])),
              let ct = B64.decode(String(parts[1]))
        else { throw VaultCryptoError.corruptPayload }
        return (iv, ct)
    }

    /// Create vault profile + raw DEK bytes (32).
    static func setupVault(masterPassword: String) throws -> (profile: VaultProfile, dek: Data) {
        let salt = randomBytes(16)
        let kekRaw = PBKDF2.deriveKey(password: masterPassword, salt: salt, iterations: pbkdf2Iterations)
        let dek = randomBytes(32)
        let iv = randomBytes(12)
        let sealed = try AESGCM.seal(dek, key: kekRaw, iv: iv)
        let wrapped = pack(iv, sealed)

        let verIv = randomBytes(12)
        let verSealed = try AESGCM.seal(Data(verifierText.utf8), key: kekRaw, iv: verIv)
        let verifier = pack(verIv, verSealed)

        let profile = VaultProfile(
            kdfSalt: B64.encode(salt),
            wrappedDek: wrapped,
            verifier: verifier,
            kdfIterations: pbkdf2Iterations
        )
        return (profile, dek)
    }

    static func unlock(masterPassword: String, profile: VaultProfile) throws -> Data {
        guard let salt = B64.decode(profile.kdfSalt) else {
            throw VaultCryptoError.corruptPayload
        }
        let iterations = profile.kdfIterations ?? pbkdf2Iterations
        let kek = PBKDF2.deriveKey(password: masterPassword, salt: salt, iterations: iterations)

        do {
            let (vIv, vCt) = try unpack(profile.verifier)
            let plain = try AESGCM.open(vCt, key: kek, iv: vIv)
            guard String(data: plain, encoding: .utf8) == verifierText else {
                throw VaultCryptoError.wrongPassword
            }
        } catch {
            throw VaultCryptoError.wrongPassword
        }

        let (iv, ct) = try unpack(profile.wrappedDek)
        return try AESGCM.open(ct, key: kek, iv: iv)
    }

    static func encryptItem(dek: Data, object: [String: Any]) throws -> (ciphertext: String, iv: String) {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let iv = randomBytes(12)
        let sealed = try AESGCM.seal(data, key: dek, iv: iv)
        return (B64.encode(sealed), B64.encode(iv))
    }

    static func decryptItem<T: Decodable>(dek: Data, ciphertext: String, iv: String, as type: T.Type) throws -> T {
        guard let ivData = B64.decode(iv), let ctData = B64.decode(ciphertext) else {
            throw VaultCryptoError.corruptPayload
        }
        let plain = try AESGCM.open(ctData, key: dek, iv: ivData)
        return try JSONDecoder().decode(T.self, from: plain)
    }

    /// Encrypt with sortedKeys — must match web JSON.stringify key order for verifier only;
    /// items use explicit encode.
    static func encryptItemEncodable<T: Encodable>(dek: Data, value: T) throws -> (ciphertext: String, iv: String) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        let iv = randomBytes(12)
        let sealed = try AESGCM.seal(data, key: dek, iv: iv)
        return (B64.encode(sealed), B64.encode(iv))
    }
}
