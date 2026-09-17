import Foundation
import SwiftUI
import CryptoKit

/// Global app session: auth tokens, app user, vault DEKs, items.
@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published var accessToken: String?
    @Published var refreshToken: String?
    @Published var user: AppUser?
    @Published var hasVault = false
    @Published var unlocked = false
    @Published var personalDEK: Data?
    @Published var orgDEK: Data?
    @Published var hasOrgKey = false
    @Published var personalItems: [VaultItem] = []
    @Published var orgItems: [VaultItem] = []
    @Published var allowedCategories: [String] = []
    @Published var errorMessage: String?
    @Published var busy = false
    @Published var autoLockMinutes: Int = 15

    private var idleTask: Task<Void, Never>?

    private init() {
        loadTokensFromKeychain()
        APIClient.shared.accessToken = accessToken
    }

    // MARK: - Auth

    func signIn(email: String, password: String) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let session = try await AuthService.signIn(email: email, password: password)
            storeTokens(session)
            APIClient.shared.accessToken = session.accessToken
            let me = try await APIClient.shared.me()
            user = me.user
            hasVault = me.hasVault
            allowedCategories = me.user.allowedCategories ?? []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signUp(email: String, password: String) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let session = try await AuthService.signUp(email: email, password: password)
            storeTokens(session)
            APIClient.shared.accessToken = session.accessToken
            let me = try await APIClient.shared.me()
            user = me.user
            hasVault = me.hasVault
            allowedCategories = me.user.allowedCategories ?? []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() {
        lockVault()
        clearTokens()
        APIClient.shared.accessToken = nil
        user = nil
        hasVault = false
        accessToken = nil
        refreshToken = nil
    }

    // MARK: - Vault

    func setupVault(masterPassword: String) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let (profile, dek) = try VaultCrypto.setupVault(masterPassword: masterPassword)
            _ = try await APIClient.shared.saveVaultProfile(profile)
            personalDEK = dek
            hasVault = true
            unlocked = true
            personalItems = []
            resetIdleTimer()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func unlock(masterPassword: String) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let resp = try await APIClient.shared.vaultProfile()
            guard let profile = resp.profile else {
                hasVault = false
                return
            }
            let dek = try VaultCrypto.unlock(masterPassword: masterPassword, profile: profile)
            personalDEK = dek
            unlocked = true
            resetIdleTimer()
            await reloadItems()
            await tryLoadOrgKey(dekPassword: masterPassword, profile: profile)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func tryLoadOrgKey(dekPassword: String, profile: VaultProfile) async {
        // Org unlock uses a separate wrap (PRF on web). On iOS v1 we only
        // surface Team if server already has a wrap we cannot open without
        // more key material — keep personal vault fully working first.
        // Full team key unwrap can be added by storing org DEK wrap under
        // the same master KEK (server PUT /api/org/key).
        if let raw = try? await APIClient.shared.orgKey(), raw.hasOrgKey {
            hasOrgKey = true
            // Attempt: if we previously stored org wrap under master password
            // locally in Keychain, load it. Otherwise Team list may be empty.
            if let stored = KeychainStore.read(key: "org_dek") {
                orgDEK = stored
                await reloadOrgItems()
            }
        } else {
            hasOrgKey = false
        }
        _ = dekPassword
        _ = profile
    }

    func reloadItems() async {
        guard let dek = personalDEK else { return }
        do {
            let resp = try await APIClient.shared.personalItems()
            var out: [VaultItem] = []
            for row in resp.items {
                let data = try VaultCrypto.decryptItem(
                    dek: dek,
                    ciphertext: row.ciphertext,
                    iv: row.iv,
                    as: ItemPayload.self
                )
                out.append(
                    VaultItem(
                        id: row.id,
                        name: data.name,
                        username: data.username,
                        password: data.password,
                        url: data.url,
                        notes: data.notes,
                        totp: data.totp,
                        favorite: data.favorite ?? false,
                        category: row.category ?? data.category ?? "other",
                        updatedAt: row.updatedAt ?? "",
                        scope: "personal"
                    )
                )
            }
            personalItems = out
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func reloadOrgItems() async {
        guard let dek = orgDEK else { return }
        do {
            let resp = try await APIClient.shared.orgItems()
            var out: [VaultItem] = []
            for row in resp.items {
                let data = try VaultCrypto.decryptItem(
                    dek: dek,
                    ciphertext: row.ciphertext,
                    iv: row.iv,
                    as: ItemPayload.self
                )
                out.append(
                    VaultItem(
                        id: row.id,
                        name: data.name,
                        username: data.username,
                        password: data.password,
                        url: data.url,
                        notes: data.notes,
                        totp: data.totp,
                        favorite: data.favorite ?? false,
                        category: row.category ?? data.category ?? "other",
                        updatedAt: row.updatedAt ?? "",
                        scope: "org"
                    )
                )
            }
            orgItems = out
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func saveItem(_ item: VaultItem, scope: String) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        guard let dek = scope == "org" ? orgDEK : personalDEK else {
            errorMessage = "Vault is locked."
            return
        }
        do {
            let payload = ItemPayload(
                type: "login",
                name: item.name,
                username: item.username,
                password: item.password,
                url: item.url,
                notes: item.notes,
                totp: item.totp,
                favorite: item.favorite,
                category: item.category
            )
            let enc = try VaultCrypto.encryptItemEncodable(dek: dek, value: payload)
            if item.id.isEmpty {
                if scope == "org" {
                    _ = try await APIClient.shared.createOrgItem(
                        ciphertext: enc.ciphertext,
                        iv: enc.iv,
                        category: item.category
                    )
                } else {
                    _ = try await APIClient.shared.createPersonalItem(
                        ciphertext: enc.ciphertext,
                        iv: enc.iv,
                        category: item.category
                    )
                }
            } else {
                if scope == "org" {
                    try await APIClient.shared.updateOrgItem(
                        id: item.id,
                        ciphertext: enc.ciphertext,
                        iv: enc.iv,
                        category: item.category
                    )
                } else {
                    try await APIClient.shared.updatePersonalItem(
                        id: item.id,
                        ciphertext: enc.ciphertext,
                        iv: enc.iv,
                        category: item.category
                    )
                }
            }
            if scope == "org" { await reloadOrgItems() } else { await reloadItems() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteItem(_ item: VaultItem) async {
        do {
            if item.scope == "org" {
                try await APIClient.shared.deleteOrgItem(id: item.id)
                await reloadOrgItems()
            } else {
                try await APIClient.shared.deletePersonalItem(id: item.id)
                await reloadItems()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func lockVault() {
        unlocked = false
        personalDEK = nil
        orgDEK = nil
        personalItems = []
        orgItems = []
        idleTask?.cancel()
    }

    func refreshProfile() async {
        guard let me = try? await APIClient.shared.me() else { return }
        user = me.user
        hasVault = me.hasVault
        allowedCategories = me.user.allowedCategories ?? []
    }

    func resetIdleTimer() {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            guard let self else { return }
            let nanos = UInt64(self.autoLockMinutes) * 60 * 1_000_000_000
            try? await Task.sleep(nanoseconds: nanos)
            if !Task.isCancelled {
                await MainActor.run { self.lockVault() }
            }
        }
    }

    func touchIdle() {
        if unlocked { resetIdleTimer() }
    }

    // MARK: - Token persistence (Keychain)

    private func storeTokens(_ session: AuthService.Session) {
        accessToken = session.accessToken
        refreshToken = session.refreshToken
        KeychainStore.save(key: "sb_access", value: session.accessToken)
        KeychainStore.save(key: "sb_refresh", value: session.refreshToken)
    }

    private func loadTokensFromKeychain() {
        accessToken = KeychainStore.readString(key: "sb_access")
        refreshToken = KeychainStore.readString(key: "sb_refresh")
    }

    private func clearTokens() {
        KeychainStore.delete(key: "sb_access")
        KeychainStore.delete(key: "sb_refresh")
    }
}

struct ItemPayload: Codable {
    var type: String?
    var name: String
    var username: String?
    var password: String?
    var url: String?
    var notes: String?
    var totp: String?
    var favorite: Bool?
    var category: String?
}

enum KeychainStore {
    static func save(key: String, value: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: value,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    static func save(key: String, value: String) {
        save(key: key, value: Data(value.utf8))
    }

    static func readData(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { return nil }
        return item as? Data
    }

    static func readString(key: String) -> String? {
        readData(key: key).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func read(key: String) -> Data? {
        readData(key: key)
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
